from pydantic import BaseModel, Field
from typing import Optional, Any
from enum import Enum


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

class SessionCreateResponse(BaseModel):
    session_id: str


# ---------------------------------------------------------------------------
# RAG
# ---------------------------------------------------------------------------

class RAGQueryRequest(BaseModel):
    query: str
    context: Optional[str] = None
    top_k: Optional[int] = 6
    knowledge_type: Optional[str] = None  # filter hint


class RAGQueryResponse(BaseModel):
    results: list[dict]
    enriched_context: str


# ---------------------------------------------------------------------------
# Agent 1 — Requirement Gathering
# ---------------------------------------------------------------------------

class RequirementStartRequest(BaseModel):
    session_id: str
    feature_request: str = Field(..., description="Initial feature/change proposal from user")


class RequirementRespondRequest(BaseModel):
    session_id: str
    answer: str = Field(..., description="User answer to clarification question")


class AgentMessage(BaseModel):
    role: str           # "agent" | "user"
    content: str


class RequirementStateResponse(BaseModel):
    session_id: str
    status: str         # "clarifying" | "complete"
    messages: list[AgentMessage]
    questions_asked: int
    structured_output: Optional[dict] = None


# ---------------------------------------------------------------------------
# Agent 2 — Deep Research
# ---------------------------------------------------------------------------

class ResearchGenerateRequest(BaseModel):
    session_id: str


class ResearchFeedbackRequest(BaseModel):
    session_id: str
    feedback: str
    sections_to_regenerate: Optional[list[str]] = None  # None = full regen


class ResearchSection(BaseModel):
    title: str
    content: str
    sources: list[str] = []


class ResearchReport(BaseModel):
    version: int
    sections: list[ResearchSection]
    summary: str


class ResearchStateResponse(BaseModel):
    session_id: str
    status: str         # "generating" | "ready" | "regenerating"
    current_report: Optional[ResearchReport] = None
    versions: list[int] = []


# ---------------------------------------------------------------------------
# Agent 3 — Product Canvas
# ---------------------------------------------------------------------------

class CanvasGenerateRequest(BaseModel):
    session_id: str


class CanvasRegenerateSectionRequest(BaseModel):
    session_id: str
    section_key: str
    instructions: Optional[str] = None


class CanvasSectionUpdate(BaseModel):
    session_id: str
    section_key: str
    content: str        # User manually edited content


class CanvasSection(BaseModel):
    key: str
    title: str
    content: str
    version: int = 1


class ProductCanvas(BaseModel):
    version: int
    sections: list[CanvasSection]


class CanvasStateResponse(BaseModel):
    session_id: str
    status: str         # "generating" | "ready"
    canvas: Optional[ProductCanvas] = None
    versions: list[int] = []


class ExportFormat(str, Enum):
    docx = "docx"
    pdf = "pdf"


# ---------------------------------------------------------------------------
# Agent 5 — Prototype Generation
# ---------------------------------------------------------------------------

class PrototypeGenerateRequest(BaseModel):
    session_id: str
    brd_content: str = Field(..., description="Full BRD markdown content to build prototype from")
    feature_name: Optional[str] = ""


class PrototypeStateResponse(BaseModel):
    session_id: str
    status: str                         # "idle" | "generating" | "ready" | "failed"
    prototype_html: Optional[str] = None
    feature_name: Optional[str] = None
    screen_count: Optional[int] = None
    error: Optional[str] = None
