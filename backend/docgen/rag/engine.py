"""RAG engine for ChromaDB ingest, retrieval, and chunking."""
from __future__ import annotations

import logging
import math
import os
import re
import uuid
from pathlib import Path
from typing import Optional

import chromadb
from chromadb.config import Settings as ChromaSettings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import (
    CSVLoader,
    TextLoader,
    UnstructuredWordDocumentLoader,
)
from langchain_community.document_loaders import PyPDFLoader

from docgen.config import settings

logger = logging.getLogger(__name__)

STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "create", "document", "for",
    "from", "how", "i", "in", "is", "it", "of", "on", "or", "please", "that", "the",
    "this", "to", "we", "with", "write",
}

# ---------------------------------------------------------------------------
# ChromaDB client (persistent)
# ---------------------------------------------------------------------------

_chroma_client: Optional[chromadb.ClientAPI] = None
_chroma_unavailable: bool = False


def get_chroma_client() -> Optional[chromadb.ClientAPI]:
    """Return a ChromaDB client, or None if unavailable (e.g. Python 3.14 Rust bindings issue)."""
    global _chroma_client, _chroma_unavailable
    if _chroma_unavailable:
        return None
    if _chroma_client is None:
        try:
            _chroma_client = chromadb.PersistentClient(
                path=settings.vectorstore_dir,
                settings=ChromaSettings(anonymized_telemetry=False),
            )
            logger.info("[RAG] ChromaDB PersistentClient initialised at %s", settings.vectorstore_dir)
        except Exception as exc:
            logger.warning(
                "[RAG] ChromaDB PersistentClient unavailable (%s). RAG retrieval disabled — "
                "documents will be generated without knowledge-base context.",
                exc,
            )
            _chroma_unavailable = True
            return None
    return _chroma_client


# ---------------------------------------------------------------------------
# Text splitter
# ---------------------------------------------------------------------------

def get_splitter() -> RecursiveCharacterTextSplitter:
    return RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        separators=["\n\n", "\n", " ", ""],
    )


# ---------------------------------------------------------------------------
# Loader helpers
# ---------------------------------------------------------------------------

def load_file(file_path: str) -> list[str]:
    """Load a file and return raw text chunks."""
    path = Path(file_path)
    suffix = path.suffix.lower()

    try:
        if suffix == ".pdf":
            loader = PyPDFLoader(str(path))
        elif suffix in (".docx", ".doc"):
            loader = UnstructuredWordDocumentLoader(str(path))
        elif suffix in (".txt", ".md"):
            loader = TextLoader(str(path), encoding="utf-8")
        elif suffix == ".csv":
            loader = CSVLoader(str(path))
        else:
            # Fallback: try plain text
            loader = TextLoader(str(path), encoding="utf-8")

        documents = loader.load()
        splitter = get_splitter()
        chunks = splitter.split_documents(documents)
        return [c.page_content for c in chunks if c.page_content.strip()]
    except Exception as e:
        logger.error("Failed to load file %s: %s", file_path, e)
        raise


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------

def ingest_file(file_path: str, collection_name: str = "default") -> int:
    """Ingest a file into ChromaDB. Returns number of chunks added."""
    chunks = load_file(file_path)
    if not chunks:
        return 0

    client = get_chroma_client()
    if client is None:
        logger.warning("[RAG] Skipping ingest_file — ChromaDB unavailable.")
        return 0
    collection = client.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"},
    )

    ids = [str(uuid.uuid4()) for _ in chunks]
    metadatas = [{"source": file_path, "chunk_index": i} for i, _ in enumerate(chunks)]

    # ChromaDB batches large inserts automatically; split to be safe
    batch_size = 100
    for start in range(0, len(chunks), batch_size):
        end = start + batch_size
        collection.add(
            ids=ids[start:end],
            documents=chunks[start:end],
            metadatas=metadatas[start:end],
        )

    logger.info("Ingested %d chunks from %s into collection '%s'", len(chunks), file_path, collection_name)
    return len(chunks)


def ingest_text(text: str, collection_name: str = "default", source: str = "manual") -> int:
    """Ingest raw text into ChromaDB."""
    splitter = get_splitter()
    chunks = splitter.split_text(text)
    chunks = [c for c in chunks if c.strip()]

    if not chunks:
        return 0

    client = get_chroma_client()
    if client is None:
        logger.warning("[RAG] Skipping ingest_text — ChromaDB unavailable.")
        return 0
    collection = client.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine"},
    )

    ids = [str(uuid.uuid4()) for _ in chunks]
    metadatas = [{"source": source, "chunk_index": i} for i, _ in enumerate(chunks)]

    collection.add(ids=ids, documents=chunks, metadatas=metadatas)
    return len(chunks)


# ---------------------------------------------------------------------------
# Retrieval
# ---------------------------------------------------------------------------

def retrieve(
    query: str,
    collection_name: str = "default",
    top_k: Optional[int] = None,
) -> list[str]:
    """Query ChromaDB and return top-K text chunks."""
    k = top_k or settings.top_k_results

    client = get_chroma_client()
    if client is None:
        logger.debug("[RAG] Skipping retrieve — ChromaDB unavailable.")
        return []
    try:
        collection = client.get_collection(name=collection_name)
    except Exception:
        logger.warning("Collection '%s' not found, returning empty context.", collection_name)
        return []

    count = collection.count()
    if count == 0:
        return []

    actual_k = min(k, count)

    results = collection.query(
        query_texts=[query],
        n_results=actual_k,
        include=["documents", "distances"],
    )

    docs: list[str] = []
    if results and results.get("documents"):
        distances = results.get("distances") or []
        for batch_idx, doc_list in enumerate(results["documents"]):
            distance_list = distances[batch_idx] if batch_idx < len(distances) else []
            for doc_idx, doc in enumerate(doc_list):
                distance = distance_list[doc_idx] if doc_idx < len(distance_list) else None
                if _is_relevant_match(query, doc, distance):
                    docs.append(doc)

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for d in docs:
        if d not in seen:
            seen.add(d)
            unique.append(d)

    return unique


def _normalize_tokens(text: str) -> set[str]:
    tokens = re.findall(r"[a-zA-Z0-9]+", text.lower())
    return {token for token in tokens if len(token) > 2 and token not in STOP_WORDS}


def _bm25_score(query_tokens: set[str], documents: list[str]) -> list[float]:
    """Simple BM25 scoring without external dependency.

    BM25 parameters: k1=1.5, b=0.75 (standard values).
    """
    k1, b = 1.5, 0.75
    N = len(documents)
    if N == 0:
        return []

    # Tokenise all documents
    tokenised = [_normalize_tokens(d) for d in documents]
    avg_dl = sum(len(t) for t in tokenised) / N if N else 1

    scores = []
    for tokens in tokenised:
        score = 0.0
        dl = len(tokens)
        for term in query_tokens:
            tf = sum(1 for t in tokens if t == term)
            # number of docs containing the term
            df = sum(1 for t in tokenised if term in t)
            if df == 0:
                continue
            idf = math.log((N - df + 0.5) / (df + 0.5) + 1)
            tf_norm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avg_dl))
            score += idf * tf_norm
        scores.append(score)
    return scores


def _rrf_fusion(
    dense_ranked: list[str],
    bm25_ranked: list[str],
    k: int = 60,
) -> list[str]:
    """Reciprocal Rank Fusion: combine two ranked lists into one.

    RRF score for a document = sum(1 / (k + rank_i)) across all lists.
    Higher score = more relevant.
    """
    scores: dict[str, float] = {}

    for rank, doc in enumerate(dense_ranked, start=1):
        scores[doc] = scores.get(doc, 0.0) + 1.0 / (k + rank)

    for rank, doc in enumerate(bm25_ranked, start=1):
        scores[doc] = scores.get(doc, 0.0) + 1.0 / (k + rank)

    # Sort descending by RRF score
    return sorted(scores.keys(), key=lambda d: scores[d], reverse=True)


def retrieve_hybrid(
    query: str,
    collection_name: str = "default",
    top_k: Optional[int] = None,
) -> list[str]:
    """Hybrid BM25 + dense vector retrieval with RRF fusion.

    1. Dense search via ChromaDB (cosine similarity, top-200)
    2. BM25 lexical search on the same corpus
    3. Reciprocal Rank Fusion → return top_k

    Falls back to pure dense search if the collection is empty or too small.
    """
    k = top_k or settings.top_k_results
    client = get_chroma_client()
    if client is None:
        logger.debug("[RAG] Skipping hybrid retrieval — ChromaDB unavailable.")
        return []

    try:
        collection = client.get_collection(name=collection_name)
    except Exception:
        logger.warning("Collection '%s' not found for hybrid retrieval.", collection_name)
        return []

    count = collection.count()
    if count == 0:
        return []

    # ── 1. Dense search ──────────────────────────────────────────────────────
    dense_k = min(max(k * 10, 50), count)
    dense_results = collection.query(
        query_texts=[query],
        n_results=dense_k,
        include=["documents"],
    )
    dense_docs: list[str] = []
    if dense_results and dense_results.get("documents"):
        dense_docs = [d for batch in dense_results["documents"] for d in batch if d]

    # ── 2. BM25 search on the corpus returned by dense search ────────────────
    # (Using the dense candidates as the BM25 corpus keeps memory bounded)
    if len(dense_docs) > 1:
        query_tokens = _normalize_tokens(query)
        bm25_scores = _bm25_score(query_tokens, dense_docs)
        # Rank BM25 results: zip docs with scores, sort descending
        bm25_ranked = [doc for doc, _ in sorted(
            zip(dense_docs, bm25_scores),
            key=lambda x: x[1],
            reverse=True,
        )]
    else:
        bm25_ranked = dense_docs[:]

    # ── 3. RRF fusion ─────────────────────────────────────────────────────────
    fused = _rrf_fusion(dense_docs, bm25_ranked)

    # ── 4. Post-filter with relevance check ───────────────────────────────────
    relevant = [
        doc for doc in fused
        if _is_relevant_match(query, doc, distance=None)
    ] or fused  # If filter removes everything, use unfiltered fused list

    # Deduplicate while preserving order
    seen: set[str] = set()
    result: list[str] = []
    for doc in relevant:
        if doc not in seen:
            seen.add(doc)
            result.append(doc)
        if len(result) >= k:
            break

    return result


def _is_relevant_match(query: str, document: str, distance: Optional[float]) -> bool:
    query_tokens = _normalize_tokens(query)
    doc_tokens = _normalize_tokens(document)

    if not query_tokens or not doc_tokens:
        return distance is not None and distance <= settings.rag_distance_threshold

    overlap = len(query_tokens & doc_tokens)
    if overlap >= settings.rag_min_token_overlap:
        return True

    if distance is None:
        return False

    return distance <= settings.rag_distance_threshold and overlap >= 1


def retrieve_multi_query(
    prompt: str,
    topic: str,
    collection_name: str = "default",
    top_k: Optional[int] = None,
) -> tuple[list[str], str]:
    """Run multiple derived queries and combine results."""
    queries = [prompt]
    topic = topic.strip()
    if topic and topic.lower() != prompt.strip().lower():
        queries.append(topic)

    all_chunks: list[str] = []
    seen: set[str] = set()

    for q in queries:
        chunks = retrieve_hybrid(q, collection_name=collection_name, top_k=top_k or settings.top_k_results)
        for c in chunks:
            if c not in seen:
                seen.add(c)
                all_chunks.append(c)

    context = "\n\n---\n\n".join(all_chunks[:settings.top_k_results * 2])
    return all_chunks, context


# ---------------------------------------------------------------------------
# Reference document structure extraction
# ---------------------------------------------------------------------------

def extract_reference_structure(file_path: str) -> str:
    """Extract heading/section structure from a reference document."""
    path = Path(file_path)
    suffix = path.suffix.lower()
    structure_lines: list[str] = []

    try:
        if suffix in (".docx", ".doc"):
            from docx import Document as DocxDocument
            doc = DocxDocument(str(path))
            for para in doc.paragraphs:
                if para.style.name.startswith("Heading"):
                    level = para.style.name.replace("Heading", "").strip()
                    structure_lines.append(f"{'#' * int(level or 1)} {para.text}")
        elif suffix == ".pdf":
            from pypdf import PdfReader
            reader = PdfReader(str(path))
            for page in reader.pages:
                text = page.extract_text() or ""
                for line in text.split("\n"):
                    stripped = line.strip()
                    if stripped and len(stripped) < 100 and stripped[0].isupper():
                        structure_lines.append(f"# {stripped}")
                if len(structure_lines) > 50:
                    break
        else:
            with open(str(path), encoding="utf-8", errors="ignore") as f:
                for line in f:
                    stripped = line.strip()
                    if stripped.startswith("#"):
                        structure_lines.append(stripped)
    except Exception as e:
        logger.warning("Could not extract structure from %s: %s", file_path, e)

    return "\n".join(structure_lines[:50]) if structure_lines else ""


# ---------------------------------------------------------------------------
# Collection management
# ---------------------------------------------------------------------------

def list_collections() -> list[dict]:
    client = get_chroma_client()
    if client is None:
        return []
    collections = client.list_collections()
    result = []
    for col in collections:
        try:
            c = client.get_collection(col.name)
            result.append({"name": col.name, "count": c.count()})
        except Exception:
            result.append({"name": col.name, "count": 0})
    return result


def delete_collection(name: str) -> bool:
    client = get_chroma_client()
    if client is None:
        return False
    try:
        client.delete_collection(name)
        return True
    except Exception as e:
        logger.error("Failed to delete collection %s: %s", name, e)
        return False


def search_collection(query: str, collection_name: str = "default", top_k: int = 5) -> list[str]:
    return retrieve(query, collection_name=collection_name, top_k=top_k)
