"""
RAG Client Agent.
Abstracts whether retrieval is local (HybridRetriever) or remote (POST /rag/query).
All agents call this module — never hit ChromaDB/BM25 directly.
"""
import logging
import httpx
from typing import Optional

import config

logger = logging.getLogger(__name__)

# These are set at app startup via init_rag_client()
_retriever = None


def init_rag_client(retriever):
    """Called once at FastAPI startup with the HybridRetriever instance."""
    global _retriever
    _retriever = retriever
    logger.info(f"RAG client initialized in '{config.RAG_MODE}' mode")


def query_rag_sync(
    query: str,
    context: Optional[str] = None,
    top_k: int = 6,
    knowledge_type: Optional[str] = None,
) -> dict:
    """Sync version of query_rag for use in sync LangGraph nodes."""
    return _local_query(query, top_k, knowledge_type)


async def query_rag(
    query: str,
    context: Optional[str] = None,
    top_k: int = 6,
    knowledge_type: Optional[str] = None,
) -> dict:
    """
    Unified RAG query interface.
    Returns: {"results": [...], "enriched_context": "..."}
    """
    if config.RAG_MODE == "remote":
        return await _remote_query(query, context, top_k, knowledge_type)
    return _local_query(query, top_k, knowledge_type)


def _local_query(query: str, top_k: int, knowledge_type: Optional[str]) -> dict:
    if _retriever is None:
        # RAG index is still being built in the background — return empty context
        # so agents can continue with LLM-only generation.
        logger.warning("RAG client not yet ready — returning empty context for query: %s", query)
        return {"results": [], "enriched_context": ""}
    results = _retriever.retrieve(query, top_k=top_k, knowledge_type=knowledge_type)
    enriched_context = _retriever.build_context_string(results)
    return {"results": results, "enriched_context": enriched_context}


async def _remote_query(
    query: str,
    context: Optional[str],
    top_k: int,
    knowledge_type: Optional[str],
) -> dict:
    payload = {"query": query, "context": context, "top_k": top_k, "knowledge_type": knowledge_type}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(config.RAG_ENDPOINT, json=payload)
        resp.raise_for_status()
        return resp.json()
    
def call_rag_clarify(
    feature_description: str,
    canvas_sections: list = None,
    research_report: dict = None,
    rag_session_id: str = None,
) -> dict:
    """
    Call rag_system /clarify to get taxonomy + proposals + questions.
    Pass rag_session_id to reuse a previous clarify session (avoids re-running LLM calls).
    Returns full clarify response or empty dict on failure.
    """
    import httpx
    import config

    product_canvas = ""
    if canvas_sections:
        product_canvas = "\n".join(
            f"{s.get('title','')}: {s.get('content','')}"
            for s in canvas_sections if s.get("content")
        )

    research_summary = ""
    if research_report:
        research_summary = research_report.get("summary", "")

    payload = {
        "feature_description": feature_description,
        "product_canvas": product_canvas,
        "research_summary": research_summary,
        "document_type": "TSD",
    }

    try:
        resp = httpx.post(
            f"{config.RAG_SYSTEM_URL}/clarify",
            json=payload,
            timeout=180,
        )
        resp.raise_for_status()
        data = resp.json()
        logger.info(
            "[rag_clarify] taxonomy=%s proposals_apis=%d questions=%d blocking_gaps=%d",
            data.get("taxonomy", {}).get("primary_category", "unknown"),
            len((data.get("proposed_skeleton") or {}).get("apis", [])),
            len(data.get("questions", [])),
            len(data.get("blocking_gaps", [])),
        )
        return data
    except Exception as e:
        logger.error("[rag_clarify] RAG /clarify FAILED: %s", e, exc_info=True)
        return {}

