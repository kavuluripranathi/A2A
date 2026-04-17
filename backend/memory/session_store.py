"""
Persistent session store.
Sessions are saved as JSON files under backend/sessions/ so they survive restarts.
"""
import uuid
import json
import os
from datetime import datetime
from typing import Optional
from dataclasses import dataclass, field, asdict


# ── Persistence directory ──────────────────────────────────────────────────── #
SESSIONS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sessions")
os.makedirs(SESSIONS_DIR, exist_ok=True)


# ── State dataclasses ──────────────────────────────────────────────────────── #

@dataclass
class RequirementState:
    feature_request: str = ""
    messages: list = field(default_factory=list)    # [{role, content}]
    questions_asked: int = 0
    answers: dict = field(default_factory=dict)      # question_key -> answer
    structured_output: Optional[dict] = None
    status: str = "clarifying"                       # clarifying | complete


@dataclass
class ResearchState:
    status: str = "idle"                             # idle | generating | ready
    reports: list = field(default_factory=list)      # version history
    current_version: int = 0
    feedback_history: list = field(default_factory=list)


@dataclass
class CanvasState:
    status: str = "idle"                             # idle | generating | ready
    canvases: list = field(default_factory=list)     # version history
    current_version: int = 0


@dataclass
class PrototypeState:
    status: str = "idle"                             # idle | generating | ready | failed
    prototype_html: Optional[str] = None
    feature_name: str = ""
    screen_count: int = 0
    error: Optional[str] = None


@dataclass
class Session:
    session_id: str
    created_at: datetime
    title: str = ""
    updated_at: Optional[datetime] = None
    bundle_id: Optional[str] = None          # last generated doc bundle
    bundle_jobs: dict = field(default_factory=dict)  # {doc_type: job_id}
    requirement: RequirementState = field(default_factory=RequirementState)
    research: ResearchState = field(default_factory=ResearchState)
    canvas: CanvasState = field(default_factory=CanvasState)
    prototype: PrototypeState = field(default_factory=PrototypeState)


# ── Store ──────────────────────────────────────────────────────────────────── #

class SessionStore:
    def __init__(self):
        self._sessions: dict[str, Session] = {}
        self._load_all()

    # ── CRUD ────────────────────────────────────────────────────────────────── #

    def create(self) -> Session:
        sid = str(uuid.uuid4())
        session = Session(session_id=sid, created_at=datetime.utcnow())
        self._sessions[sid] = session
        return session

    def get(self, session_id: str) -> Session:
        session = self._sessions.get(session_id)
        if not session:
            raise KeyError(f"Session '{session_id}' not found")
        return session

    def exists(self, session_id: str) -> bool:
        return session_id in self._sessions

    def delete(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
        path = os.path.join(SESSIONS_DIR, f"{session_id}.json")
        if os.path.exists(path):
            os.remove(path)

    def list_sessions(self) -> list[str]:
        return list(self._sessions.keys())

    # ── Persistence ──────────────────────────────────────────────────────────── #

    def save(self, session_id: str) -> None:
        """Persist session to disk. Call after any significant state change."""
        session = self._sessions.get(session_id)
        if not session:
            return

        session.updated_at = datetime.utcnow()

        # Auto-generate title from feature request if not set
        if not session.title and session.requirement.feature_request:
            words = session.requirement.feature_request.split()
            session.title = " ".join(words[:10])
            if len(words) > 10:
                session.title += "..."

        # Prototype HTML can be large — persist only metadata, not the HTML itself
        proto_data = {
            "status": session.prototype.status,
            "feature_name": session.prototype.feature_name,
            "screen_count": session.prototype.screen_count,
            "error": session.prototype.error,
        }

        data = {
            "session_id": session.session_id,
            "created_at": session.created_at.isoformat(),
            "updated_at": session.updated_at.isoformat(),
            "title": session.title,
            "bundle_id": session.bundle_id,
            "bundle_jobs": session.bundle_jobs,
            "requirement": asdict(session.requirement),
            "research": asdict(session.research),
            "canvas": asdict(session.canvas),
            "prototype": proto_data,
        }

        path = os.path.join(SESSIONS_DIR, f"{session_id}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False, default=str)

    def rename(self, session_id: str, title: str) -> None:
        session = self._sessions.get(session_id)
        if session:
            session.title = title
            self.save(session_id)

    # ── History helpers ───────────────────────────────────────────────────────── #

    def get_summary(self, session_id: str) -> dict:
        """Return lightweight summary for history list view."""
        session = self._sessions.get(session_id)
        if not session:
            return {}

        # Determine furthest completed step
        if session.prototype.status == "ready":
            progress = "prototype"
        elif session.bundle_id:
            progress = "documents"
        elif session.canvas.canvases:
            progress = "canvas"
        elif session.research.reports:
            progress = "research"
        elif session.requirement.messages:
            progress = "requirement"
        else:
            progress = "new"

        title = session.title
        if not title:
            title = session.requirement.feature_request[:80] if session.requirement.feature_request else "Untitled Session"

        return {
            "session_id": session.session_id,
            "title": title,
            "feature_request": session.requirement.feature_request,
            "created_at": session.created_at.isoformat(),
            "updated_at": (session.updated_at or session.created_at).isoformat(),
            "progress": progress,
            "requirement_status": session.requirement.status,
            "research_status": session.research.status,
            "canvas_status": session.canvas.status,
            "message_count": len(session.requirement.messages),
            "research_versions": len(session.research.reports),
            "canvas_versions": len(session.canvas.canvases),
        }

    def get_detail(self, session_id: str) -> dict:
        """Return full session data for history detail view."""
        session = self._sessions.get(session_id)
        if not session:
            return {}

        # Latest research report
        research_report = None
        if session.research.reports:
            current_v = session.research.current_version
            research_report = next(
                (r for r in session.research.reports if r["version"] == current_v),
                session.research.reports[-1],
            )

        # Latest canvas
        canvas = None
        if session.canvas.canvases:
            current_v = session.canvas.current_version
            canvas = next(
                (c for c in session.canvas.canvases if c["version"] == current_v),
                session.canvas.canvases[-1],
            )

        title = session.title
        if not title:
            title = session.requirement.feature_request[:80] if session.requirement.feature_request else "Untitled Session"

        return {
            "session_id": session.session_id,
            "title": title,
            "bundle_id": session.bundle_id,
            "created_at": session.created_at.isoformat(),
            "updated_at": (session.updated_at or session.created_at).isoformat(),
            "requirement": {
                "feature_request": session.requirement.feature_request,
                "messages": session.requirement.messages,
                "questions_asked": session.requirement.questions_asked,
                "structured_output": session.requirement.structured_output,
                "status": session.requirement.status,
            },
            "research": {
                "status": session.research.status,
                "current_report": research_report,
                "version_count": len(session.research.reports),
                "feedback_history": session.research.feedback_history,
            },
            "canvas": {
                "status": session.canvas.status,
                "current_canvas": canvas,
                "version_count": len(session.canvas.canvases),
            },
            "prototype": {
                "status": session.prototype.status,
                "feature_name": session.prototype.feature_name,
                "screen_count": session.prototype.screen_count,
            },
        }

    # ── Internal ─────────────────────────────────────────────────────────────── #

    def _load_all(self) -> None:
        """Load all persisted sessions from disk on startup."""
        if not os.path.exists(SESSIONS_DIR):
            return

        for filename in os.listdir(SESSIONS_DIR):
            if not filename.endswith(".json"):
                continue
            path = os.path.join(SESSIONS_DIR, filename)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)

                req_data = data.get("requirement", {})
                res_data = data.get("research", {})
                can_data = data.get("canvas", {})

                session = Session(
                    session_id=data["session_id"],
                    created_at=datetime.fromisoformat(data["created_at"]),
                    title=data.get("title", ""),
                    updated_at=datetime.fromisoformat(data["updated_at"]) if data.get("updated_at") else None,
                    requirement=RequirementState(
                        feature_request=req_data.get("feature_request", ""),
                        messages=req_data.get("messages", []),
                        questions_asked=req_data.get("questions_asked", 0),
                        answers=req_data.get("answers", {}),
                        structured_output=req_data.get("structured_output"),
                        status=req_data.get("status", "clarifying"),
                    ),
                    research=ResearchState(
                        status=res_data.get("status", "idle"),
                        reports=res_data.get("reports", []),
                        current_version=res_data.get("current_version", 0),
                        feedback_history=res_data.get("feedback_history", []),
                    ),
                    bundle_id=data.get("bundle_id"),
                    bundle_jobs=data.get("bundle_jobs", {}),
                    canvas=CanvasState(
                        status=can_data.get("status", "idle"),
                        canvases=can_data.get("canvases", []),
                        current_version=can_data.get("current_version", 0),
                    ),
                    prototype=PrototypeState(
                        status=data.get("prototype", {}).get("status", "idle"),
                        feature_name=data.get("prototype", {}).get("feature_name", ""),
                        screen_count=data.get("prototype", {}).get("screen_count", 0),
                        error=data.get("prototype", {}).get("error"),
                    ),
                )
                self._sessions[session.session_id] = session
            except Exception:
                # Skip corrupted or unreadable session files
                pass


# Singleton — import this across the app
store = SessionStore()
