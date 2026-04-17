"""
Agent 4 — DocSuite Agent
Wraps the DocGen LangGraph pipeline to generate BRD, TSD, Product Note, and Circular
from a Product Canvas + Research Report.

Called via asyncio.to_thread() from the router (sync execution, no async deadlock).
"""
import logging
import threading
import uuid
from pathlib import Path
from typing import Optional
from agents.rag_client import call_rag_clarify


logger = logging.getLogger(__name__)

DOC_TYPES = ["BRD", "TSD", "Product Note", "Circular"]

_DEFAULT_TITLES = {
    "BRD": "Business Requirements Document",
    "TSD": "Technical Specification Document",
    "Product Note": "Product Note",
    "Circular": "Operational Circular",
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

# ---------------------------------------------------------------------------
# Module-level job + bundle stores (shared with the docgen router)
# ---------------------------------------------------------------------------

JOBS: dict[str, dict] = {}
BUNDLES: dict[str, dict] = {}


def _build_prompt(
    canvas_sections: list[dict],
    research_report: dict,
    feature_request: str,
) -> str:
    """Build a rich prompt from the canvas and research data."""
    lines = []

    if feature_request:
        lines.append(f"Feature: {feature_request}\n")

    # Canvas sections
    if canvas_sections:
        lines.append("## Product Canvas\n")
        for sec in canvas_sections:
            title = sec.get("title", sec.get("key", ""))
            content = sec.get("content", "")
            if content:
                lines.append(f"### {title}\n{content}\n")

    # Research report summary + key sections
    if research_report:
        summary = research_report.get("summary", "")
        if summary:
            lines.append(f"## Research Summary\n{summary}\n")

        for sec in research_report.get("sections", [])[:4]:
            title = sec.get("title", "")
            content = sec.get("content", "")
            if title and content:
                lines.append(f"### {title}\n{content[:1000]}\n")

    return "\n".join(lines)


def _run_single_doc(job_id: str, initial_state: dict) -> None:
    """Run DocGen pipeline for one document type in the background."""
    from docgen.agents.pipeline import run_pipeline

    try:
        JOBS[job_id]["status"] = "retrieving"
        JOBS[job_id]["current_step"] = STATUS_STEP["retrieving"]
        JOBS[job_id]["progress"] = STATUS_PROGRESS["retrieving"]

        final_state = run_pipeline(initial_state)

        status = final_state.get("status", "failed")
        JOBS[job_id]["status"] = status
        JOBS[job_id]["progress"] = STATUS_PROGRESS.get(status, 0)
        JOBS[job_id]["current_step"] = STATUS_STEP.get(status, status)
        JOBS[job_id]["error"] = final_state.get("error")
        JOBS[job_id]["output_path"] = final_state.get("output_path")
        logger.info("[docsuite] job=%s doc_type=%s status=%s", job_id, initial_state.get("doc_type"), status)

    except Exception as e:
        logger.error("[docsuite] job=%s error: %s", job_id, e, exc_info=True)
        JOBS[job_id]["status"] = "failed"
        JOBS[job_id]["error"] = str(e)
        JOBS[job_id]["progress"] = 0
        JOBS[job_id]["current_step"] = "Generation failed"


def generate_docsuite(
    session_id: str,
    canvas_sections: list[dict],
    research_report: dict,
    feature_request: str = "",
    collection_name: str = "upi_knowledge",
    include_diagrams: bool = True,
    organization_name: str = "NPCI",
) -> dict:
    """
    Launch all 4 document generation pipelines in parallel threads.
    Returns immediately with a bundle_id + per-doc job_ids for polling.

    Called via asyncio.to_thread() from the router.
    """
    bundle_id = str(uuid.uuid4())
    prompt = _build_prompt(canvas_sections, research_report, feature_request)

    # Call RAG /clarify once — shared intelligence for all 4 doc types
    rag_intelligence = call_rag_clarify(feature_request, canvas_sections, research_report)
    proposals = rag_intelligence.get("proposed_skeleton") or {}
    taxonomy = rag_intelligence.get("taxonomy") or {}
    if rag_intelligence.get("blocking_gaps"):
        logger.warning(
            "[docsuite] Blocking gaps detected before generation: %s",
            rag_intelligence["blocking_gaps"],
        )


    job_ids: dict[str, str] = {}

    for doc_type in DOC_TYPES:
        job_id = str(uuid.uuid4())
        job_ids[doc_type] = job_id

        JOBS[job_id] = {
            "status": "pending",
            "progress": 0,
            "current_step": "Queued",
            "error": None,
            "output_path": None,
            "prompt": prompt,
            "doc_type": doc_type,
            "bundle_id": bundle_id,
            "session_id": session_id,
        }

        initial_state = {
            "job_id": job_id,
            "prompt": prompt,
            "doc_type": doc_type,
            "document_title": _DEFAULT_TITLES[doc_type],
            "version_number": "1.0",
            "classification": "Internal",
            "collection_name": collection_name,
            "reference_structure": None,
            "use_rag": True,
            "include_diagrams": include_diagrams and doc_type != "Circular",
            "audience": "Product, Engineering, Compliance teams",
            "desired_outcome": f"Professional {doc_type} for UPI feature",
            "format_constraints": None,
            "organization_name": organization_name,
            "reference_code": None,
            "issue_date": None,
            "recipient_line": None,
            "subject_line": None,
            "signatory_name": "Chief Product Officer",
            "signatory_title": "Chief Product Officer",
            "signatory_department": "Product Management",
            "additional_context": None,
            "session_id": session_id,
            "rag_context": "",
            "rag_chunks": [],
            "document_plan": None,
            "diagram_specs": [],
            "generated_diagrams": {},
            "generated_sections": [],
            "output_path": None,
            "status": "pending",
            "error": None,
            "proposals": proposals,
            "taxonomy": taxonomy,

        }

        t = threading.Thread(
            target=_run_single_doc,
            args=(job_id, initial_state),
            daemon=True,
            name=f"docsuite-{doc_type.lower().replace(' ', '_')}-{job_id[:8]}",
        )
        t.start()

    BUNDLES[bundle_id] = {
        "job_ids": job_ids,
        "session_id": session_id,
    }

    logger.info("[docsuite] bundle=%s session=%s jobs=%s", bundle_id, session_id, job_ids)
    return {"bundle_id": bundle_id, "job_ids": job_ids, "status": "running"}


def get_bundle_status(bundle_id: str) -> Optional[dict]:
    """Return aggregated bundle status. Returns None if bundle not found."""
    if bundle_id not in BUNDLES:
        return None

    job_ids = BUNDLES[bundle_id]["job_ids"]
    jobs_detail = []
    statuses = []

    for doc_type, job_id in job_ids.items():
        job = JOBS.get(job_id, {})
        status = job.get("status", "pending")
        statuses.append(status)
        jobs_detail.append({
            "doc_type": doc_type,
            "job_id": job_id,
            "status": status,
            "progress": job.get("progress", 0),
            "current_step": job.get("current_step", ""),
            "error": job.get("error"),
            "output_path": job.get("output_path"),
        })

    terminal = {"completed", "failed", "FAILED"}
    if all(s == "completed" for s in statuses):
        overall = "completed"
    elif all(s in terminal for s in statuses):
        overall = "partial"
    elif any(s in terminal for s in statuses):
        overall = "running"
    else:
        overall = "running" if any(s != "pending" for s in statuses) else "pending"

    return {
        "bundle_id": bundle_id,
        "overall_status": overall,
        "jobs": jobs_detail,
        "session_id": BUNDLES[bundle_id].get("session_id"),
    }
