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


class RagServiceUnavailable(RuntimeError):
    """Raised when the rag_system service cannot be reached."""


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
    
def retrieve_from_rag_system(query: str, top_k: int = 5, doc_format: str = None) -> list[str]:
    """
    Call rag_system POST /retrieve — returns chunk texts from pgvector+BM25.
    doc_format: "TSD" | "BRD" | "Product Note" | "Circular" | "XSD" | None
      When set, retrieval soft-prefers chunks from that document format.
    Raises RagServiceUnavailable if the service cannot be reached (connection/timeout).
    Returns [] only when the service responds but finds no matching chunks.
    """
    import httpx
    import config
    try:
        payload = {"query": query, "top_k": top_k}
        if doc_format:
            payload["doc_format"] = doc_format
        resp = httpx.post(
            f"{config.RAG_SYSTEM_URL}/retrieve",
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json().get("chunks", [])
    except (httpx.ConnectError, httpx.TimeoutException, httpx.ConnectTimeout) as e:
        raise RagServiceUnavailable(
            f"RAG system unreachable at {config.RAG_SYSTEM_URL} — is it running? ({e})"
        ) from e
    except Exception as e:
        logger.error("[retrieve_from_rag_system] unexpected error for query '%s': %s", query[:60], e)
        return []


def call_rag_clarify(
    feature_description: str,
    canvas_sections: list = None,
    research_report: dict = None,
    rag_session_id: str = None,
    document_type: str = "TSD",
) -> dict:
    """
    Call rag_system /clarify to get taxonomy + proposals + questions.
    If rag_session_id is provided (from a prior /pre-clarify call), load the stored
    session directly — avoids re-running the full 4-LLM clarify pipeline.
    Returns full clarify response or empty dict on failure.
    """
    import httpx
    import config

    # Fast path: reuse already-computed session from /pre-clarify
    if rag_session_id:
        try:
            resp = httpx.get(
                f"{config.RAG_SYSTEM_URL}/session/{rag_session_id}",
                timeout=30,
            )
            if resp.status_code == 200:
                data = resp.json()
                logger.info(
                    "[rag_clarify] Reused session %s — taxonomy=%s proposals_apis=%d",
                    rag_session_id,
                    data.get("taxonomy", {}).get("primary_category", "unknown"),
                    len((data.get("proposed_skeleton") or {}).get("apis", [])),
                )
                return data
            logger.warning("[rag_clarify] Session %s not found (status %d), falling back to /clarify",
                           rag_session_id, resp.status_code)
        except Exception as e:
            logger.warning("[rag_clarify] Session load failed (%s), falling back to /clarify", e)

    product_canvas = ""
    if canvas_sections:
        product_canvas = "\n".join(
            f"{s.get('title','')}: {s.get('content','')}"
            for s in canvas_sections if s.get("content")
        )

    # Prefer full research content over summary-only field
    research_summary = ""
    if research_report:
        research_summary = (
            research_report.get("content", "")
            or research_report.get("summary", "")
        )[:3000]

    payload = {
        "feature_description": feature_description,
        "product_canvas": product_canvas,
        "research_summary": research_summary,
        "document_type": document_type,
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

