"""
DocGen Router — integrated as /api prefix under the main A2A backend.

All routes from the original DocGen service are preserved here so the frontend
can point VITE_DOCGEN_URL to http://localhost:8000 without any changes to API paths.
"""
from __future__ import annotations

import asyncio
import io
import logging
import threading
import uuid
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from docgen.config import settings as docgen_settings
from docgen.models import (
    BundleGenerateRequest,
    BundleJobDetail,
    BundleStatusResponse,
    CollectionInfo,
    EditRequest,
    EditResponse,
    GenerateRequest,
    GenerateResponse,
    HealthResponse,
    JobStatusResponse,
    RAGUploadResponse,
    SessionDocumentInfo,
)
from docgen.rag.engine import (
    delete_collection,
    ingest_file,
    list_collections,
    search_collection,
)
from docgen.agents.pipeline import run_pipeline

# Share job/bundle stores with docsuite_agent so both views are consistent
from agents.docsuite_agent import JOBS, BUNDLES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["DocGen"])

_BUNDLE_DOC_TYPES = ["BRD", "TSD", "Product Note", "Circular"]

_BUNDLE_DEFAULT_TITLES = {
    "BRD": "Business Requirements Document",
    "TSD": "Technical Specification Document",
    "Product Note": "Product Note",
    "Circular": "Circular",
}

STATUS_PROGRESS = {
    "pending": 0,
    "retrieving": 10,
    "planning": 30,
    "generating_diagrams": 50,
    "writing": 70,
    "reviewing": 82,
    "assembling": 90,
    "completed": 100,
    "failed": 0,
    "FAILED": 0,
}

STATUS_STEP = {
    "pending": "Queued",
    "retrieving": "Retrieving context from knowledge base",
    "planning": "Planning document structure",
    "generating_diagrams": "Generating UML diagrams",
    "writing": "Writing section content",
    "reviewing": "Reviewing document structure and content",
    "assembling": "Assembling final document",
    "completed": "Document ready",
    "failed": "Generation failed",
    "FAILED": "Generation failed",
}


def _try_reconstruct_bundle(bundle_id: str) -> bool:
    """
    After a server restart BUNDLES and JOBS are empty.
    Scan the session store for the persisted bundle_jobs, then rebuild
    in-memory stubs so all existing endpoints keep working.
    """
    try:
        from memory.session_store import store as _store
        for session_id in _store.list_sessions():
            session = _store.get(session_id)
            if session.bundle_id != bundle_id or not session.bundle_jobs:
                continue

            # Rebuild BUNDLES entry
            BUNDLES[bundle_id] = {"job_ids": dict(session.bundle_jobs)}

            # Rebuild stub JOBS entries pointing at on-disk artefacts
            session_dir = Path(docgen_settings.output_dir) / "sessions" / session_id
            for doc_type, job_id in session.bundle_jobs.items():
                if job_id in JOBS:
                    continue  # already live
                doc_slug = doc_type.replace(" ", "_").lower()
                candidate = session_dir / f"{doc_slug}_{job_id[:8]}.docx"
                if candidate.exists():
                    status, output_path = "completed", str(candidate)
                else:
                    status, output_path = "failed", None
                JOBS[job_id] = {
                    "status": status,
                    "progress": 100 if status == "completed" else 0,
                    "current_step": STATUS_STEP.get(status, status),
                    "error": None,
                    "output_path": output_path,
                    "doc_type": doc_type,
                    "bundle_id": bundle_id,
                    "prompt": "",
                }
            logger.info("Reconstructed bundle %s from session %s", bundle_id, session_id)
            return True
    except Exception as exc:
        logger.warning("Bundle reconstruction failed: %s", exc)
    return False


def _update_job(job_id: str, state: dict):
    status = state.get("status", "pending")
    JOBS[job_id]["status"] = status
    JOBS[job_id]["progress"] = STATUS_PROGRESS.get(status, 0)
    JOBS[job_id]["current_step"] = STATUS_STEP.get(status, status)
    JOBS[job_id]["error"] = state.get("error")
    JOBS[job_id]["output_path"] = state.get("output_path")


def _run_pipeline_background(job_id: str, initial_state: dict):
    try:
        JOBS[job_id]["status"] = "retrieving"
        final_state = run_pipeline(initial_state)
        _update_job(job_id, final_state)
    except Exception as e:
        logger.error("Pipeline error for job %s: %s", job_id, e, exc_info=True)
        JOBS[job_id]["status"] = "failed"
        JOBS[job_id]["error"] = str(e)
        JOBS[job_id]["progress"] = 0
        JOBS[job_id]["current_step"] = "Generation failed"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=GenerateResponse)
async def generate_document(request: GenerateRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())

    JOBS[job_id] = {
        "status": "pending",
        "progress": 0,
        "current_step": "Queued",
        "error": None,
        "output_path": None,
        "prompt": request.prompt,
    }

    initial_state = {
        "job_id": job_id,
        "prompt": request.prompt,
        "doc_type": request.doc_type,
        "document_title": request.document_title,
        "version_number": request.version_number,
        "classification": request.classification,
        "collection_name": request.collection_name,
        "reference_structure": None,
        "use_rag": request.use_rag,
        "include_diagrams": request.include_diagrams,
        "audience": request.audience,
        "desired_outcome": request.desired_outcome,
        "format_constraints": request.format_constraints,
        "organization_name": request.organization_name,
        "reference_code": request.reference_code,
        "issue_date": request.issue_date,
        "recipient_line": request.recipient_line,
        "subject_line": request.subject_line,
        "signatory_name": request.signatory_name,
        "signatory_title": request.signatory_title,
        "signatory_department": request.signatory_department,
        "additional_context": request.additional_context,
        "session_id": request.session_id,
        "rag_context": "",
        "rag_chunks": [],
        "document_plan": None,
        "diagram_specs": [],
        "generated_diagrams": {},
        "generated_sections": [],
        "output_path": None,
        "status": "pending",
        "error": None,
    }

    background_tasks.add_task(_run_pipeline_background, job_id, initial_state)

    return GenerateResponse(
        job_id=job_id,
        status="pending",
        message="Document generation started.",
    )


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")
    job = JOBS[job_id]
    return JobStatusResponse(
        job_id=job_id,
        status=job.get("status", "pending"),
        progress=job.get("progress", 0),
        current_step=job.get("current_step", ""),
        error=job.get("error"),
        output_path=job.get("output_path"),
    )


@router.get("/download/{job_id}")
async def download_document(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")
    job = JOBS[job_id]
    if job.get("status") != "completed":
        raise HTTPException(status_code=400, detail="Document not ready yet.")
    output_path = job.get("output_path")
    if not output_path or not Path(output_path).exists():
        raise HTTPException(status_code=404, detail="Document file not found.")
    filename = f"document_{job_id[:8]}.docx"
    return FileResponse(
        path=output_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=filename,
    )


@router.post("/edit/{job_id}", response_model=EditResponse)
async def edit_document(job_id: str, request: EditRequest):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")
    job = JOBS[job_id]
    if job.get("status") != "completed":
        raise HTTPException(status_code=400, detail="Document must be in 'completed' state before editing.")

    try:
        from docgen.tools.document_editor import edit_document_section, edit_full_document

        if request.section_heading.strip().lower() == "full":
            new_path = await asyncio.to_thread(
                edit_full_document,
                job_id=job_id,
                edit_instruction=request.edit_instruction,
            )
        else:
            new_path = await asyncio.to_thread(
                edit_document_section,
                job_id=job_id,
                section_heading=request.section_heading,
                edit_instruction=request.edit_instruction,
            )
        JOBS[job_id]["output_path"] = new_path
        return EditResponse(
            job_id=job_id,
            section_heading=request.section_heading,
            status="completed",
            output_path=new_path,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("Edit failed for job %s: %s", job_id, e, exc_info=True)
        return EditResponse(
            job_id=job_id,
            section_heading=request.section_heading,
            status="failed",
            error=str(e),
        )


@router.get("/sessions/{session_id}/documents", response_model=list[SessionDocumentInfo])
async def list_session_documents(session_id: str):
    session_dir = Path(docgen_settings.output_dir) / "sessions" / session_id
    if not session_dir.exists():
        return []

    results: list[SessionDocumentInfo] = []
    for doc_file in session_dir.glob("*.docx"):
        parts = doc_file.stem.rsplit("_", 1)
        doc_type = parts[0].replace("_", " ").title() if parts else "Unknown"
        job_id_prefix = parts[1] if len(parts) > 1 else ""
        matching_job = next(
            (jid for jid, jdata in JOBS.items() if jid.startswith(job_id_prefix)),
            job_id_prefix,
        )
        stat = doc_file.stat()
        results.append(SessionDocumentInfo(
            job_id=matching_job,
            doc_type=doc_type,
            document_title=doc_file.stem,
            output_path=str(doc_file),
            created_at=datetime.fromtimestamp(stat.st_mtime).isoformat(),
        ))

    results.sort(key=lambda x: x.created_at, reverse=True)
    return results


@router.post("/generate/bundle", response_model=BundleStatusResponse)
async def generate_bundle(request: BundleGenerateRequest, background_tasks: BackgroundTasks):
    bundle_id = str(uuid.uuid4())
    title_overrides = {
        "BRD": request.brd_title,
        "TSD": request.tsd_title,
        "Product Note": request.product_note_title,
        "Circular": request.circular_title,
    }

    job_ids: dict[str, str] = {}

    for doc_type in _BUNDLE_DOC_TYPES:
        job_id = str(uuid.uuid4())
        job_ids[doc_type] = job_id

        document_title = title_overrides.get(doc_type) or _BUNDLE_DEFAULT_TITLES[doc_type]

        JOBS[job_id] = {
            "status": "pending",
            "progress": 0,
            "current_step": "Queued",
            "error": None,
            "output_path": None,
            "prompt": request.prompt,
            "doc_type": doc_type,
            "bundle_id": bundle_id,
        }

        initial_state = {
            "job_id": job_id,
            "prompt": request.prompt,
            "doc_type": doc_type,
            "document_title": document_title,
            "version_number": request.version_number,
            "classification": request.classification,
            "collection_name": request.collection_name,
            "reference_structure": None,
            "use_rag": request.use_rag,
            "include_diagrams": request.include_diagrams and doc_type != "Circular",
            "audience": request.audience,
            "desired_outcome": request.desired_outcome,
            "format_constraints": None,
            "organization_name": request.organization_name,
            "reference_code": request.reference_code,
            "issue_date": request.issue_date,
            "recipient_line": request.recipient_line,
            "subject_line": request.subject_line,
            "signatory_name": request.signatory_name,
            "signatory_title": request.signatory_title,
            "signatory_department": request.signatory_department,
            "additional_context": request.additional_context,
            "session_id": request.session_id,
            "rag_context": "",
            "rag_chunks": [],
            "document_plan": None,
            "diagram_specs": [],
            "generated_diagrams": {},
            "generated_sections": [],
            "output_path": None,
            "status": "pending",
            "error": None,
        }

        t = threading.Thread(
            target=_run_pipeline_background,
            args=(job_id, initial_state),
            daemon=True,
        )
        t.start()

    BUNDLES[bundle_id] = {"job_ids": job_ids}

    # Persist bundle_id + job_ids in the session so history load can restore them
    try:
        from memory.session_store import store as _store
        if request.session_id and _store.exists(request.session_id):
            _sess = _store.get(request.session_id)
            _sess.bundle_id = bundle_id
            _sess.bundle_jobs = dict(job_ids)  # {doc_type: job_id}
            _store.save(request.session_id)
    except Exception:
        pass  # non-critical

    jobs_detail = [
        BundleJobDetail(
            doc_type=dt,
            job_id=jid,
            status="pending",
            progress=0,
            current_step="Queued",
        )
        for dt, jid in job_ids.items()
    ]

    return BundleStatusResponse(
        bundle_id=bundle_id,
        overall_status="pending",
        jobs=jobs_detail,
    )


@router.get("/bundles/{bundle_id}", response_model=BundleStatusResponse)
async def get_bundle_status(bundle_id: str):
    if bundle_id not in BUNDLES:
        if not _try_reconstruct_bundle(bundle_id):
            raise HTTPException(status_code=404, detail=f"Bundle {bundle_id} not found.")

    job_ids = BUNDLES[bundle_id]["job_ids"]
    jobs_detail = []
    statuses = []

    for doc_type, job_id in job_ids.items():
        job = JOBS.get(job_id, {})
        status = job.get("status", "pending")
        statuses.append(status)
        jobs_detail.append(BundleJobDetail(
            doc_type=doc_type,
            job_id=job_id,
            status=status,
            progress=job.get("progress", 0),
            current_step=job.get("current_step", ""),
            error=job.get("error"),
            output_path=job.get("output_path"),
        ))

    terminal = {"completed", "failed", "FAILED"}
    if all(s == "completed" for s in statuses):
        overall = "completed"
    elif all(s in terminal for s in statuses):
        overall = "partial"
    elif any(s in terminal for s in statuses):
        overall = "running"
    else:
        overall = "running" if any(s != "pending" for s in statuses) else "pending"

    return BundleStatusResponse(bundle_id=bundle_id, overall_status=overall, jobs=jobs_detail)


@router.get("/bundles/{bundle_id}/download")
async def download_bundle(bundle_id: str):
    if bundle_id not in BUNDLES:
        raise HTTPException(status_code=404, detail=f"Bundle {bundle_id} not found.")

    job_ids = BUNDLES[bundle_id]["job_ids"]
    ready = {
        doc_type: JOBS[job_id]
        for doc_type, job_id in job_ids.items()
        if JOBS.get(job_id, {}).get("status") == "completed"
        and JOBS.get(job_id, {}).get("output_path")
        and Path(JOBS[job_id]["output_path"]).exists()
    }

    if not ready:
        raise HTTPException(status_code=400, detail="No completed documents in this bundle yet.")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for doc_type, job in ready.items():
            safe_name = doc_type.replace(" ", "_").lower()
            zf.write(job["output_path"], arcname=f"{safe_name}.docx")
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="bundle_{bundle_id[:8]}.zip"'},
    )


@router.post("/rag/upload", response_model=RAGUploadResponse)
async def upload_rag_file(
    file: UploadFile = File(...),
    collection_name: str = Form(default="default"),
    is_reference: bool = Form(default=False),
):
    safe_name = Path(file.filename).name if file.filename else "upload.bin"
    file_id = uuid.uuid4().hex[:8]
    dest = Path(docgen_settings.upload_dir) / f"{file_id}_{safe_name}"
    dest.parent.mkdir(parents=True, exist_ok=True)

    content = await file.read()
    dest.write_bytes(content)

    chunks_added = 0
    try:
        chunks_added = await asyncio.to_thread(ingest_file, str(dest), collection_name)
    except Exception as e:
        logger.error("Ingest failed for %s: %s", dest, e)
        raise HTTPException(status_code=500, detail=f"Failed to ingest file: {e}")

    return RAGUploadResponse(
        filename=safe_name,
        collection_name=collection_name,
        chunks_added=chunks_added,
        is_reference=is_reference,
        message=f"Ingested {chunks_added} chunks into collection '{collection_name}'.",
    )


@router.get("/rag/collections", response_model=list[CollectionInfo])
async def get_collections():
    cols = list_collections()
    return [CollectionInfo(name=c["name"], count=c["count"]) for c in cols]


@router.delete("/rag/collections/{name}")
async def remove_collection(name: str):
    success = delete_collection(name)
    if not success:
        raise HTTPException(status_code=404, detail=f"Collection '{name}' not found or could not be deleted.")
    return {"message": f"Collection '{name}' deleted."}


@router.get("/rag/search")
async def search_rag(
    query: str,
    collection: str = "default",
    top_k: int = 5,
):
    if not query:
        raise HTTPException(status_code=400, detail="Query parameter required.")
    results = search_collection(query, collection_name=collection, top_k=top_k)
    return {"query": query, "collection": collection, "results": results}


@router.get("/jobs/{job_id}/content")
async def get_job_content(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")
    job = JOBS[job_id]
    if job.get("status") not in ("completed",):
        raise HTTPException(status_code=400, detail=f"Job {job_id} is not completed yet (status={job.get('status')}).")

    output_path = job.get("output_path")
    if not output_path:
        raise HTTPException(status_code=404, detail="No output path recorded for this job.")

    # Artifacts (generated_sections.json, document_plan.json) are always stored
    # under output_dir/<job_id>/ regardless of whether a session_id was used.
    from docgen.plan_store import artifact_dir
    job_dir = artifact_dir(job_id)
    sections_file = job_dir / "generated_sections.json"
    plan_file = job_dir / "document_plan.json"

    if not sections_file.exists():
        raise HTTPException(status_code=404, detail="Generated sections not found for this job.")

    import json as _json
    sections = _json.loads(sections_file.read_text(encoding="utf-8"))

    lines: list[str] = []
    if plan_file.exists():
        plan = _json.loads(plan_file.read_text(encoding="utf-8"))
        title = plan.get("title", "")
        subtitle = plan.get("subtitle", "")
        doc_type = plan.get("doc_type", "")
        meta = plan.get("document_meta", {})
        if title:
            lines.append(f"# {title}")
        if subtitle:
            lines.append(f"*{subtitle}*")
        if doc_type:
            lines.append(f"**Document Type:** {doc_type}")
        for k, v in meta.items():
            if v:
                lines.append(f"**{k.replace('_', ' ').title()}:** {v}")
        lines.append("")
        lines.append("---")
        lines.append("")

    for section in sections:
        heading = section.get("section_heading", "")
        level = section.get("level", 1)
        render_style = section.get("render_style", "body")
        prefix = "#" * min(level + 1, 4)

        if heading:
            lines.append(f"{prefix} {heading}")
            lines.append("")

        if render_style == "cover":
            for p in section.get("paragraphs", []):
                if p and p.strip():
                    lines.append(p.strip())
            lines.append("")
            continue

        for p in section.get("paragraphs", []):
            if p and p.strip():
                lines.append(p.strip())
                lines.append("")

        bullets = section.get("bullet_points", [])
        if bullets:
            for b in bullets:
                lines.append(f"- {b}")
            lines.append("")

        numbered = section.get("numbered_items", [])
        if numbered:
            for i, item in enumerate(numbered, 1):
                lines.append(f"{i}. {item}")
            lines.append("")

        table = section.get("table_data") or {}
        headers = table.get("headers", [])
        rows = table.get("rows", [])
        if headers and rows:
            lines.append("| " + " | ".join(str(h) for h in headers) + " |")
            lines.append("| " + " | ".join("---" for _ in headers) + " |")
            for row in rows:
                lines.append("| " + " | ".join(str(c) for c in row) + " |")
            lines.append("")

        for code in section.get("code_blocks", []):
            if code and code.strip():
                lines.append("```")
                lines.append(code.strip())
                lines.append("```")
                lines.append("")

    markdown = "\n".join(lines)
    return {
        "job_id": job_id,
        "doc_type": job.get("doc_type", ""),
        "output_path": output_path,
        "markdown": markdown,
    }


@router.get("/health", response_model=HealthResponse)
async def health_check():
    active = sum(1 for j in JOBS.values() if j.get("status") not in ("completed", "failed", "FAILED"))
    return HealthResponse(
        status="ok",
        model_name=docgen_settings.model_name,
        ollama_url=docgen_settings.ollama_base_url,
        active_jobs=active,
        total_jobs=len(JOBS),
    )
