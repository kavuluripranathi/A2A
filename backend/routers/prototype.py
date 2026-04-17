import asyncio
import logging

from fastapi import APIRouter, HTTPException

from memory.session_store import store
from schemas.models import PrototypeGenerateRequest, PrototypeStateResponse
from agents.prototype_agent import generate_prototype

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/prototype", tags=["Prototype Agent"])


def _to_response(session_id: str) -> PrototypeStateResponse:
    session = store.get(session_id)
    p = session.prototype
    return PrototypeStateResponse(
        session_id=session_id,
        status=p.status,
        prototype_html=p.prototype_html,
        feature_name=p.feature_name,
        screen_count=p.screen_count,
        error=p.error,
    )


@router.post("/generate", response_model=PrototypeStateResponse)
async def generate(req: PrototypeGenerateRequest):
    if not store.exists(req.session_id):
        raise HTTPException(status_code=404, detail="Session not found")

    if not req.brd_content or len(req.brd_content.strip()) < 50:
        raise HTTPException(status_code=400, detail="BRD content is required to generate a prototype")

    session = store.get(req.session_id)
    session.prototype.status = "generating"
    session.prototype.error = None

    try:
        result = await asyncio.to_thread(
            generate_prototype,
            req.session_id,
            req.brd_content,
            req.feature_name or session.requirement.feature_request[:80],
        )

        session.prototype.status = result["status"]
        session.prototype.prototype_html = result["prototype_html"]
        session.prototype.feature_name = result["feature_name"]
        session.prototype.screen_count = result["screen_count"]
        session.prototype.error = result.get("error")
        store.save(req.session_id)

    except Exception as exc:
        logger.exception("Prototype generation failed for session %s", req.session_id)
        session.prototype.status = "failed"
        session.prototype.error = str(exc)
        store.save(req.session_id)
        raise HTTPException(status_code=500, detail=f"Prototype generation failed: {exc}") from exc

    return _to_response(req.session_id)


@router.get("/{session_id}", response_model=PrototypeStateResponse)
async def get_state(session_id: str):
    if not store.exists(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    return _to_response(session_id)
