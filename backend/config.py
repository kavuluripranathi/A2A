import os
from dotenv import load_dotenv

load_dotenv()

# Model configuration
MODEL_PROVIDER = os.getenv("MODEL_PROVIDER", "openai")
MODEL_NAME = os.getenv("MODEL_NAME", "gpt-4o")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# Tavily web search
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")

# RAG configuration
RAG_MODE = os.getenv("RAG_MODE", "local")          # "local" or "remote"
RAG_ENDPOINT = os.getenv("RAG_ENDPOINT", "http://localhost:8000/rag/query")
DOCUMENTS_DIR = os.getenv("DOCUMENTS_DIR", "../documents")
CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "./chroma_db")
CHROMA_COLLECTION = os.getenv("CHROMA_COLLECTION", "upi_knowledge")

# BM25
BM25_TOP_K = int(os.getenv("BM25_TOP_K", "10"))
DENSE_TOP_K = int(os.getenv("DENSE_TOP_K", "10"))
FINAL_TOP_K = int(os.getenv("FINAL_TOP_K", "6"))

# Embeddings
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")

# Prototype generation model
# Set PROTOTYPE_MODEL_NAME=gpt-4.1 (or gpt-5.3 when available) in .env to override
PROTOTYPE_MODEL_NAME = os.getenv("PROTOTYPE_MODEL_NAME", "gpt-4.1")

# CORS origins
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:5174").split(",")
