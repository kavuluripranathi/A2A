"""
Change Orchestration Platform — FastAPI Backend
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import config
from rag.ingest import ingest_pipeline
from rag.retriever import HybridRetriever
from agents.rag_client import init_rag_client
from routers import session, requirement, research, canvas, rag, history
from routers import docgen as docgen_router
from routers import prototype as prototype_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ------------------------------------------------------------------ #
    # Startup: fire RAG ingestion in a daemon thread and immediately yield
    # so the server starts accepting requests without waiting for RAG.
    # ------------------------------------------------------------------ #
    import threading

    def _init_rag():
        try:
            logger.info("RAG ingestion thread started...")
            vector_store, bm25, bm25_chunks = ingest_pipeline(
                documents_dir=config.DOCUMENTS_DIR,
                force=False,
            )
            retriever = HybridRetriever(vector_store, bm25, bm25_chunks)
            init_rag_client(retriever)
            logger.info("RAG client ready.")
        except Exception as e:
            logger.error(f"RAG initialization failed in thread: {e}")

    t = threading.Thread(target=_init_rag, daemon=True, name="rag-init")
    t.start()
    logger.info("RAG ingestion started in background thread — server ready immediately.")

    yield

    # ------------------------------------------------------------------ #
    # Shutdown
    # ------------------------------------------------------------------ #
    logger.info("Shutting down.")


app = FastAPI(
    title="Change Orchestration Platform",
    description="AI-driven Product Canvas generation via multi-agent pipeline",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(session.router)
app.include_router(requirement.router)
app.include_router(research.router)
app.include_router(canvas.router)
app.include_router(rag.router)
app.include_router(history.router)
app.include_router(docgen_router.router)
app.include_router(prototype_router.router)


@app.get("/health")
async def health():
    return {"status": "ok", "rag_mode": config.RAG_MODE, "model": config.MODEL_NAME}
