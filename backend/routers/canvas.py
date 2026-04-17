import asyncio
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from memory.session_store import store
from schemas.models import (
    CanvasGenerateRequest,
    CanvasRegenerateSectionRequest,
    CanvasSectionUpdate,
    CanvasStateResponse,
    ProductCanvas,
    CanvasSection,
    ExportFormat,
)
from agents.canvas_agent import (
    generate_product_canvas,
    regenerate_canvas_section,
    update_canvas_section_manually,
    export_docx,
    export_pdf,
    CANVAS_SECTION_KEYS,
)

router = APIRouter(prefix="/canvas", tags=["Canvas Agent"])


def _build_canvas_response(session_id: str, state: dict) -> CanvasStateResponse:
    current_v = state.get("current_version", 1)
    sections_dict = state.get("sections", {})
    section_versions = state.get("section_versions", {})

    canvas_sections = [
        CanvasSection(
            key=k,
            title=state.get("_title_map", {}).get(k, k.replace("_", " ").title()),
            content=sections_dict.get(k, ""),
            version=section_versions.get(k, 1),
        )
        for k in CANVAS_SECTION_KEYS
        if k in sections_dict
    ]

    canvas = ProductCanvas(version=current_v, sections=canvas_sections) if canvas_sections else None

    return CanvasStateResponse(
        session_id=session_id,
        status=state.get("status", "ready"),
        canvas=canvas,
        versions=[cv["version"] for cv in state.get("canvas_versions", [])],
    )


@router.post("/generate", response_model=CanvasStateResponse)
async def generate(req: CanvasGenerateRequest):
    if not store.exists(req.session_id):
        raise HTTPException(status_code=404, detail="Session not found")

    session = store.get(req.session_id)

    if not session.research.reports:
        raise HTTPException(status_code=400, detail="Research report not generated yet")

    # Get the latest research report
    current_v = session.research.current_version
    research_report = next(
        (r for r in session.research.reports if r["version"] == current_v),
        session.research.reports[-1],
    )
    requirement_output = session.requirement.structured_output or {}

    session.canvas.status = "generating"
    state = await asyncio.to_thread(generate_product_canvas, req.session_id, research_report, requirement_output)

    session.canvas.status = state.get("status", "ready")
    session.canvas.current_version = state.get("current_version", 1)
    session.canvas.canvases = state.get("canvas_versions", [])
    store.save(req.session_id)

    return _build_canvas_response(req.session_id, state)


@router.post("/regenerate-section", response_model=CanvasStateResponse)
async def regen_section(req: CanvasRegenerateSectionRequest):
    if not store.exists(req.session_id):
        raise HTTPException(status_code=404, detail="Session not found")

    if req.section_key not in CANVAS_SECTION_KEYS:
        raise HTTPException(status_code=400, detail=f"Invalid section key: {req.section_key}")

    state = await asyncio.to_thread(regenerate_canvas_section, req.session_id, req.section_key, req.instructions)

    session = store.get(req.session_id)
    session.canvas.status = state.get("status", "ready")
    session.canvas.current_version = state.get("current_version", 1)
    session.canvas.canvases = state.get("canvas_versions", [])
    store.save(req.session_id)

    return _build_canvas_response(req.session_id, state)


@router.patch("/section", response_model=CanvasStateResponse)
async def update_section(req: CanvasSectionUpdate):
    if not store.exists(req.session_id):
        raise HTTPException(status_code=404, detail="Session not found")

    if req.section_key not in CANVAS_SECTION_KEYS:
        raise HTTPException(status_code=400, detail=f"Invalid section key: {req.section_key}")

    state = await asyncio.to_thread(update_canvas_section_manually, req.session_id, req.section_key, req.content)

    session = store.get(req.session_id)
    session.canvas.status = state.get("status", "ready")
    session.canvas.current_version = state.get("current_version", 1)
    session.canvas.canvases = state.get("canvas_versions", [])
    store.save(req.session_id)

    return _build_canvas_response(req.session_id, state)


@router.get("/{session_id}", response_model=CanvasStateResponse)
async def get_state(session_id: str):
    if not store.exists(session_id):
        raise HTTPException(status_code=404, detail="Session not found")

    session = store.get(session_id)
    canvas = session.canvas

    if not canvas.canvases:
        return CanvasStateResponse(
            session_id=session_id,
            status=canvas.status,
            canvas=None,
            versions=[],
        )

    current_v = canvas.current_version
    cv = next((c for c in canvas.canvases if c["version"] == current_v), canvas.canvases[-1])
    sections = [
        CanvasSection(
            key=s["key"],
            title=s["title"],
            content=s["content"],
            version=s.get("version", 1),
        )
        for s in cv.get("sections", [])
    ]
    return CanvasStateResponse(
        session_id=session_id,
        status=canvas.status,
        canvas=ProductCanvas(version=current_v, sections=sections),
        versions=[c["version"] for c in canvas.canvases],
    )


@router.get("/{session_id}/export")
async def export_canvas(session_id: str, format: ExportFormat = ExportFormat.docx):
    if not store.exists(session_id):
        raise HTTPException(status_code=404, detail="Session not found")

    session = store.get(session_id)
    if not session.canvas.canvases:
        raise HTTPException(status_code=400, detail="Canvas not generated yet")

    current_v = session.canvas.current_version
    cv = next((c for c in session.canvas.canvases if c["version"] == current_v), session.canvas.canvases[-1])
    sections_dict = {s["key"]: s["content"] for s in cv.get("sections", [])}
    feature_title = session.requirement.feature_request[:60] if session.requirement.feature_request else ""

    if format == ExportFormat.docx:
        file_bytes = await asyncio.to_thread(export_docx, sections_dict, feature_title)
        return Response(
            content=file_bytes,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f"attachment; filename=product_canvas_{session_id}.docx"},
        )
    else:
        file_bytes = await asyncio.to_thread(export_pdf, sections_dict, feature_title)
        return Response(
            content=file_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=product_canvas_{session_id}.pdf"},
        )
