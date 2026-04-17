"""LangGraph StateGraph pipeline — 5 nodes + error handler."""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any

import requests
from langchain_core.messages import HumanMessage, SystemMessage

# Truly lazy import — only loaded when LLM_PROVIDER=ollama and actually used
ChatOllama = None  # type: ignore[assignment,misc]

def _get_chat_ollama():
    global ChatOllama
    if ChatOllama is None:
        try:
            from langchain_ollama import ChatOllama as _ChatOllama
            ChatOllama = _ChatOllama
        except ImportError:
            pass
    return ChatOllama
from langgraph.graph import StateGraph, END

from docgen.config import settings
from docgen.content_fallbacks import fallback_table_data
from docgen.document_validator import repair_sections_for_validation, validate_generated_document
from docgen.document_guides import build_blueprint_plan, get_document_blueprint
from docgen.models import DocumentPlan, GeneratedContent
from docgen.plan_store import save_json_artifact
from docgen.rag.engine import retrieve_multi_query
from docgen.tools.diagram_generator import generate_diagram
from docgen.tools.docx_builder import assemble_document

logger = logging.getLogger(__name__)


class _CompatLLMResponse:
    def __init__(self, content: str):
        self.content = content


class _OpenAICompatChat:
    """Minimal OpenAI-compatible chat client used when langchain_openai is unavailable."""

    def __init__(
        self,
        *,
        model: str,
        base_url: str,
        api_key: str,
        temperature: float,
        response_format: dict | None = None,
        timeout: int = 180,
    ):
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.temperature = temperature
        self.response_format = response_format
        self.timeout = timeout

    def invoke(self, messages: list) -> _CompatLLMResponse:
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "system" if isinstance(message, SystemMessage) else "user",
                    "content": message.content,
                }
                for message in messages
            ],
            "temperature": self.temperature,
        }
        if self.response_format:
            payload["response_format"] = self.response_format

        response = requests.post(
            f"{self.base_url}/chat/completions",
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            timeout=self.timeout,
        )
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        return _CompatLLMResponse(content=content)

# ---------------------------------------------------------------------------
# LLM factories
# ---------------------------------------------------------------------------

def _make_llm_json():
    """Create LLM client for JSON-structured output.

    Uses ChatOllama when LLM_PROVIDER=ollama (default).
    Uses ChatOpenAI-compatible when LLM_PROVIDER=openai_compat (for vLLM/LiteLLM).
    """
    if settings.llm_provider == "openai_compat":
        try:
            from langchain_openai import ChatOpenAI

            return ChatOpenAI(
                model=settings.openai_model_name,
                base_url=settings.openai_base_url,
                api_key=settings.openai_api_key,
                temperature=settings.temperature,
                model_kwargs={"response_format": {"type": "json_object"}},
            )
        except ImportError:
            logger.warning(
                "[LLM] langchain_openai not installed; using built-in OpenAI-compatible adapter."
            )
            return _OpenAICompatChat(
                model=settings.openai_model_name,
                base_url=settings.openai_base_url,
                api_key=settings.openai_api_key,
                temperature=settings.temperature,
                response_format={"type": "json_object"},
            )
    # Default: local Ollama
    _Ollama = _get_chat_ollama()
    if _Ollama is None:
        raise RuntimeError("langchain_ollama not installed. Set LLM_PROVIDER=openai_compat in .env.")
    return _Ollama(
        model=settings.model_name,
        base_url=settings.ollama_base_url,
        temperature=settings.temperature,
        format="json",
    )


def _make_llm_content():
    """Create LLM client for free-form content generation (prose, sections).

    Uses effective_content_model if configured separately, otherwise same as _make_llm_json
    but without JSON format enforcement.
    """
    if settings.llm_provider == "openai_compat":
        try:
            from langchain_openai import ChatOpenAI

            return ChatOpenAI(
                model=settings.openai_model_name,
                base_url=settings.openai_base_url,
                api_key=settings.openai_api_key,
                temperature=settings.temperature,
            )
        except ImportError:
            logger.warning(
                "[LLM] langchain_openai not installed; using built-in OpenAI-compatible adapter."
            )
            return _OpenAICompatChat(
                model=settings.openai_model_name,
                base_url=settings.openai_base_url,
                api_key=settings.openai_api_key,
                temperature=settings.temperature,
            )
    _Ollama = _get_chat_ollama()
    if _Ollama is None:
        raise RuntimeError("langchain_ollama not installed. Set LLM_PROVIDER=openai_compat in .env.")
    return _Ollama(
        model=settings.effective_content_model,
        base_url=settings.ollama_base_url,
        temperature=settings.temperature,
    )


def _make_llm():
    """LLM for free-form prose — uses configured temperature."""
    if settings.llm_provider == "openai_compat":
        return _make_llm_content()
    _Ollama = _get_chat_ollama()
    if _Ollama is None:
        raise RuntimeError("langchain_ollama not installed. Set LLM_PROVIDER=openai_compat in .env.")
    return _Ollama(
        model=settings.model_name,
        base_url=settings.ollama_base_url,
        temperature=settings.temperature,
    )


# ---------------------------------------------------------------------------
# JSON parsing helpers
# ---------------------------------------------------------------------------

def _strip_fences(text: str) -> str:
    """Remove ```json ... ``` or ``` ... ``` fences."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _parse_json(text: str) -> Any:
    """Stage 1 — strict parse. Raises ValueError on failure."""
    cleaned = _strip_fences(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if match:
            return json.loads(match.group())
        raise ValueError(f"Cannot parse JSON from: {cleaned[:200]}")


def _parse_json_lenient(text: str) -> Any:
    """Stage 3 — lenient parse: ignore unknown fields, partial content."""
    cleaned = _strip_fences(text)
    # Find the outermost JSON object
    start = cleaned.find("{")
    if start == -1:
        raise ValueError("No JSON object found in output.")
    # Walk to find balanced closing brace
    depth = 0
    end = -1
    for i, ch in enumerate(cleaned[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    fragment = cleaned[start:end] if end != -1 else cleaned[start:]
    return json.loads(fragment)


def _llm_self_correct(llm: ChatOllama, original_messages: list, error_msg: str, raw_output: str) -> str:
    """Stage 2 — ask the LLM to fix its own invalid JSON."""
    correction_prompt = (
        f"Your previous response was not valid JSON. Error: {error_msg}\n"
        f"Your output started with: {raw_output[:400]}\n\n"
        "Return ONLY valid JSON. No markdown fences, no explanation, no text before or after the JSON. "
        "Start directly with { and end with }."
    )
    messages = list(original_messages) + [HumanMessage(content=correction_prompt)]
    response = llm.invoke(messages)
    return response.content if hasattr(response, "content") else str(response)


def _sanitize_json_strings(text: str) -> str:
    """
    Best-effort repair for common LLM JSON breakage:
    - Unescaped XML angle-brackets inside quoted strings  (<tag> → &lt;tag&gt; is wrong;
      the correct fix is to escape the quote that actually broke the string, or to
      replace literal newlines inside strings with \\n).
    - Literal newlines inside JSON string values  → replace with \\n
    - Trailing commas before ] or }
    """
    # Replace literal newlines that are inside JSON string values with \n escape
    # Strategy: walk char by char tracking whether we're inside a string.
    result = []
    in_string = False
    escape_next = False
    for ch in text:
        if escape_next:
            result.append(ch)
            escape_next = False
            continue
        if ch == "\\":
            result.append(ch)
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            result.append(ch)
            continue
        if in_string and ch == "\n":
            result.append("\\n")
            continue
        if in_string and ch == "\r":
            result.append("\\r")
            continue
        result.append(ch)
    cleaned = "".join(result)
    # Remove trailing commas before } or ]
    cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
    return cleaned


def _parse_json_with_recovery(
    llm: ChatOllama,
    raw: str,
    original_messages: list,
    fallback: Any,
    context: str = "",
) -> Any:
    """4-stage JSON recovery.

    Stage 1: Primary strict parse.
    Stage 1b: Sanitise the raw text (escape bare newlines, strip trailing commas)
              and re-try strict parse.
    Stage 2: LLM self-correction retry with error message feedback.
    Stage 3: Lenient extraction of first JSON object from sanitised output.
    Fallback: Return provided default and log a warning.
    """
    ctx = f" ({context})" if context else ""

    # Stage 1 — strict parse of raw output
    stage1_err = ""
    try:
        return _parse_json(raw)
    except Exception as e1:
        stage1_err = str(e1)
        logger.warning("[JSON recovery] Stage 1 failed%s: %s", ctx, e1)

    # Stage 1b — sanitise then strict parse  (handles literal newlines / trailing commas)
    sanitised = _sanitize_json_strings(raw)
    try:
        result = _parse_json(sanitised)
        logger.info("[JSON recovery] Stage 1b (sanitised) succeeded%s", ctx)
        return result
    except Exception as e1b:
        logger.warning("[JSON recovery] Stage 1b failed%s: %s", ctx, e1b)

    # Stage 2 — LLM self-correction
    # NOTE: stage1_err is a plain str (not the exception object) so Python's
    # "del exception variable after except block" scoping rule doesn't affect it.
    try:
        corrected = _llm_self_correct(llm, original_messages, stage1_err, raw)
        # Try strict then sanitised on the corrected output
        for attempt in (corrected, _sanitize_json_strings(corrected)):
            try:
                result = _parse_json(attempt)
                logger.info("[JSON recovery] Stage 2 self-correction succeeded%s", ctx)
                return result
            except Exception:
                pass
    except Exception as e2:
        logger.warning("[JSON recovery] Stage 2 failed%s: %s", ctx, e2)

    # Stage 3 — lenient extraction from sanitised text
    for source in (sanitised, raw):
        try:
            result = _parse_json_lenient(source)
            logger.info("[JSON recovery] Stage 3 lenient parse succeeded%s", ctx)
            return result
        except Exception as e3:
            logger.warning("[JSON recovery] Stage 3 failed%s: %s", ctx, e3)

    logger.error("[JSON recovery] All stages failed%s — using fallback.", ctx)
    return fallback


def _safe_parse_json(text: str, fallback: Any) -> Any:
    """Legacy 1-stage helper used by diagram generation (no LLM ref available)."""
    try:
        return _parse_json(text)
    except Exception as e:
        logger.warning("JSON parse failed, using fallback: %s", e)
        return fallback


# ---------------------------------------------------------------------------
# Fallback defaults
# ---------------------------------------------------------------------------

DEFAULT_PLAN = {
    "title": "Document",
    "subtitle": "",
    "doc_type": "BRD",
    "sections": [
        {
            "heading": "1. Introduction",
            "level": 1,
            "content_instructions": "Provide an overview of the document purpose.",
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "heading": "2. Requirements",
            "level": 1,
            "content_instructions": "List and describe the main requirements.",
            "include_table": True,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "heading": "3. Conclusion",
            "level": 1,
            "content_instructions": "Summarize findings and next steps.",
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
    ],
}

# Gap 14 FIX: per-doc-type UPI-aware fallback plans used when LLM planning fails.
_DEFAULT_PLANS: dict[str, dict] = {
    "BRD": {
        "title": "Business Requirements Document",
        "subtitle": "UPI Feature Specification",
        "doc_type": "BRD",
        "sections": [
            {"heading": "1. Executive Summary", "level": 1, "content_instructions": "Summarise the business need, target users, and expected impact of this UPI feature.", "include_table": False, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "2. Problem Statement & Objectives", "level": 1, "content_instructions": "Describe the gap in the current UPI ecosystem that this feature addresses. State measurable objectives.", "include_table": False, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "3. Scope", "level": 1, "content_instructions": "Define what is in scope (participant types, transaction categories, PSP integrations) and what is explicitly out of scope.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "4. Functional Requirements", "level": 1, "content_instructions": "List all functional requirements as numbered statements. Each requirement must specify actor, action, and expected outcome. Minimum 10 requirements.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "5. Non-Functional Requirements", "level": 1, "content_instructions": "Cover performance (TPS targets), availability (99.99% SLA), security (MFA, TLS 1.3), scalability, and audit trail requirements per RBI Master Direction 12032.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "6. User Journey", "level": 1, "content_instructions": "Describe the end-to-end user journey from initiation through authentication, routing, settlement, and notification. Cover happy path and error paths.", "include_table": False, "include_diagram": True, "diagram_type": "sequence", "diagram_description": "UPI transaction lifecycle sequence diagram"},
            {"heading": "7. Ecosystem Participants", "level": 1, "content_instructions": "Identify all participants: Payer PSP, Payee PSP, Issuer Bank, Acquirer Bank, UPI Switch (NPCI). Describe each participant's role and integration obligations.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "8. Compliance & Regulatory Requirements", "level": 1, "content_instructions": "Map each requirement to applicable NPCI Operational Circulars and RBI directives. Include RBI Master Direction 12032, DPDP Act 2023, and relevant OCs.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "9. Success Metrics & KPIs", "level": 1, "content_instructions": "Define measurable KPIs: transaction success rate, P99 latency, adoption targets at 30/60/90 days, and fraud rate ceiling.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "10. Risks & Mitigations", "level": 1, "content_instructions": "Identify top 5 risks (technical, fraud, adoption, regulatory, operational) with likelihood, impact, and mitigation strategy for each.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
        ],
    },
    "TSD": {
        "title": "Technical Specification Document",
        "subtitle": "UPI Feature Engineering Specification",
        "doc_type": "TSD",
        "sections": [
            {"heading": "1. System Architecture Overview", "level": 1, "content_instructions": "Describe the high-level system architecture: services, databases, message queues, and external integrations. Cover UPI Switch connectivity.", "include_table": False, "include_diagram": True, "diagram_type": "flowchart", "diagram_description": "System component architecture diagram"},
            {"heading": "2. API Specifications", "level": 1, "content_instructions": "Define all REST/ISO 8583 APIs: endpoint URL, HTTP method, request schema, response schema, error codes. Include authentication headers.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "3. Data Models", "level": 1, "content_instructions": "Define all data entities: field names, data types, constraints, and relationships. Include the UPI transaction record schema.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "4. Transaction Flow & State Machine", "level": 1, "content_instructions": "Document the state machine for the transaction lifecycle: PENDING → PROCESSING → SUCCESS/FAILED/REVERSED. Include timeout handling.", "include_table": False, "include_diagram": True, "diagram_type": "sequence", "diagram_description": "Transaction state machine sequence diagram"},
            {"heading": "5. Security Architecture", "level": 1, "content_instructions": "Cover authentication (OAuth 2.0 / API keys), encryption (TLS 1.3, AES-256 at rest), tokenisation, PIN validation flow, and audit logging.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "6. Error Handling & Retry Policy", "level": 1, "content_instructions": "Define error codes, retry logic (exponential backoff), idempotency keys, and timeout escalation paths for each failure scenario.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "7. Performance & Scalability Design", "level": 1, "content_instructions": "Describe horizontal scaling strategy, database sharding, caching layer (Redis), and load testing targets (TPS, P99 latency).", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "8. Integration Points", "level": 1, "content_instructions": "Document all external integration touchpoints: CBS (Core Banking), UPI Switch, fraud detection engine, notification service. Include SLA per integration.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "9. Deployment Architecture", "level": 1, "content_instructions": "Describe containerisation (Docker/K8s), CI/CD pipeline, environment matrix (dev/staging/prod), and rollback procedure.", "include_table": False, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "10. Monitoring & Observability", "level": 1, "content_instructions": "Define metrics (Prometheus), logging (ELK), alerting thresholds, SLO dashboards, and on-call escalation paths.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
        ],
    },
    "Product Note": {
        "title": "Product Note",
        "subtitle": "UPI Feature Product Brief",
        "doc_type": "Product Note",
        "sections": [
            {"heading": "1. Feature Overview", "level": 1, "content_instructions": "Describe the feature in plain language: what it does, who it serves, and why it matters for the UPI ecosystem.", "include_table": False, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "2. Strategic Rationale", "level": 1, "content_instructions": "Explain how this feature aligns with NPCI's vision, RBI Payments Vision 2025, and competitive ecosystem positioning.", "include_table": False, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "3. Market Opportunity", "level": 1, "content_instructions": "Quantify the addressable market, target transaction volume, and expected merchant/user adoption in Year 1.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "4. Product Capabilities", "level": 1, "content_instructions": "List key product capabilities with brief description of each. Group by: Core, Enhanced, and Future capabilities.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "5. Go-to-Market Plan", "level": 1, "content_instructions": "Define the GTM phases: Pilot (select banks), Limited Launch, and General Availability. Include readiness criteria for each phase.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "6. Revenue & Pricing Model", "level": 1, "content_instructions": "Describe the pricing structure for PSPs, merchants, and issuers. Include MDR, interchange, and any NPCI facilitation fee.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "7. Compliance Summary", "level": 1, "content_instructions": "Summarise the key regulatory requirements and how the product meets them. Reference specific RBI directives and NPCI OCs.", "include_table": False, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
        ],
    },
    "Circular": {
        "title": "Operational Circular",
        "subtitle": "NPCI Directive",
        "doc_type": "Circular",
        "sections": [
            {"heading": "Letterhead & Reference Block", "level": 1, "content_instructions": "NPCI letterhead with OC reference number in format NPCI/UPI/OC No. XXX/2025-26 and issue date.", "include_table": False, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "Addressee Line", "level": 1, "content_instructions": "Complete recipient list: All Member Banks, Payment Service Providers, Third Party Application Providers, and Merchants.", "include_table": False, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "Subject", "level": 1, "content_instructions": "One-line subject in formal sentence case naming the specific feature and its scope.", "include_table": False, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "Context", "level": 1, "content_instructions": "3-5 sentences describing the current ecosystem state and the reason for this circular. Factual and vendor-neutral.", "include_table": False, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "Decision & Scope", "level": 1, "content_instructions": "Begin with 'NPCI has decided to...' and specify the exact artefacts, APIs, or processes being mandated.", "include_table": False, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "Participant Obligations", "level": 1, "content_instructions": "For each participant category, list mandatory ('must') and advisory ('are advised to') obligations with a go-live deadline.", "include_table": True, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
            {"heading": "Signature Block", "level": 1, "content_instructions": "Close with 'Yours Sincerely,' then 'SD/-', then authorising official's name, designation, and department.", "include_table": False, "include_diagram": False, "diagram_type": "flowchart", "diagram_description": ""},
        ],
    },
}


def _get_default_plan(doc_type: str) -> dict:
    """Return the UPI-aware per-type default plan, falling back to the generic one."""
    import copy
    return copy.deepcopy(_DEFAULT_PLANS.get(doc_type, DEFAULT_PLAN))


# ---------------------------------------------------------------------------
# Full per-type planner system prompts
# ---------------------------------------------------------------------------

_SECTION_SCHEMA = """{
  "title": string,
  "subtitle": string,
  "doc_type": string,
  "sections": [
    {
      "section_key": string,
      "heading": string,
      "level": int (1-3),
      "render_style": "body",
      "content_instructions": string,
      "prompt_instruction": string,
      "include_table": bool,
      "include_diagram": bool,
      "diagram_type": "sequence" | "flowchart" | "activity",
      "diagram_description": string
    }
  ]
}"""

_COMMON_JSON_RULES = """
═══════════════════════════════════════════════════════════
JSON RULES
═══════════════════════════════════════════════════════════
- Return ONLY valid JSON — no explanation, no markdown fences, no preamble
- Start directly with {
- Escape all quotes and special characters properly
- No trailing commas
- section content_instructions: no pipe characters, no markdown inside strings
- No [TBD], no "To be updated", no empty strings
- Unused top-level fields must be null or [] — never omit them
"""

_COMMON_UPI_DOMAIN = """
═══════════════════════════════════════════════════════════
UPI DOMAIN KNOWLEDGE — USE ALL YOU HAVE; KEY FACTS BELOW
═══════════════════════════════════════════════════════════
ECOSYSTEM PARTICIPANTS:
  · NPCI — operates the UPI switch and Common Library (CL). Issues specifications.
  · PSP Bank — Payment Service Provider. Hosts UPI App, initiates ReqPay to NPCI.
  · Issuer/Remitter Bank — Payer's bank. Authenticates, debits customer account.
  · Beneficiary/Payee Bank — Recipient's bank. Credits customer account.
  · UPI App — Customer-facing mobile application (e.g., PhonePe, GPay, BHIM).

CORE UPI MESSAGE TYPES:
  · REQ_PAY / RESP_PAY — Payment request/response. Auth → Debit → Credit → Confirmation.
  · REQ_CHK_TXN — Transaction status check. Used for timeout/fallback resolution.
  · REQ_LIST_ACCOUNT / LIST_ACCOUNT — Account listing for registration.
  · REQ_REG_MOB / REG_MOB — Mobile/device registration (used in biometric setting).
  · REQ_AUTH_DETAILS / RESP_AUTH_DETAILS — Authentication detail exchange.
  · REQ_ACTIVATION — Device onboarding, biometric activation/rotation/deactivation.
  · REQ_MANDATE — Mandate creation.
  · REQ_BAL_ENQ — Balance enquiry.
  · REQ_VAL_ADD — VPA validation.

STANDARD REQ_PAY FLOW:
  Stage 1 — Auth:    UPI App captures PIN/biometric → CL encrypts → PSP sends ReqPay to NPCI.
  Stage 2 — ReqAuth: NPCI sends REQ_AUTH_DETAILS to Acquirer Bank; PSP responds RESP_AUTH_DETAILS.
  Stage 3 — Debit:   NPCI sends debit request to Remitter/Issuer Bank; bank sends RESP_PAY.
  Stage 4 — Credit:  NPCI routes credit to Beneficiary Bank; bank sends RESP_PAY.
  Stage 5 — Confirm: NPCI sends confirmation to Payer PSP and Payee PSP.

OTHER API FLOW: APP → Payer PSP → NPCI → Payee PSP → NPCI → Payer PSP → APP.

KEY COMPONENTS:
  · CRED Block  — Encrypted credential block containing auth data sent from PSP to NPCI.
  · CL (Common Library) — NPCI-provided SDK integrated in UPI Apps for secure auth.
  · NPCI Switch — Central routing engine for all UPI messages.
  · TEE / Secure Enclave — Hardware-backed secure storage on device.
  · Nonce-based challenge — Cryptographic replay-attack prevention mechanism.
  · VPA — Virtual Payment Address (e.g., user@bank).
  · DEEMED status — Transaction where credit is unconfirmed; settled asynchronously.
  · refCategory='05' — Designates biometric-authenticated transactions.
  · clVersion — CL version field indicating biometric support (e.g., 2.36 in ListAccPvd).

DISPUTE MANAGEMENT:
  · Standard UPI dispute process applies unless explicitly changed by the BRD.
  · "No change in dispute management" is the default for most feature changes.
"""


def _planner_system_prompt(doc_type: str) -> str:
    """Return the full, doc-type-specific system prompt for the planner node."""
    normalized = (doc_type or "").strip().lower()

    if normalized == "brd":
        return _BRD_SYSTEM_PROMPT
    elif normalized == "tsd":
        return _TSD_SYSTEM_PROMPT
    elif normalized in ("product note", "prd"):
        return _PN_SYSTEM_PROMPT
    elif normalized == "circular":
        return _CIRCULAR_SYSTEM_PROMPT
    else:
        return _GENERIC_SYSTEM_PROMPT.format(doc_type=doc_type)


# ---------------------------------------------------------------------------
# BRD system prompt
# ---------------------------------------------------------------------------

_BRD_SYSTEM_PROMPT = f"""You are a senior document architect and domain expert. You produce professional,
publication-ready enterprise documents for any industry or domain.
You apply deep expertise in Business Requirements Documents (BRD).

═══════════════════════════════════════════════════════════
MANDATORY CONTENT RULES — APPLY TO EVERY SECTION
═══════════════════════════════════════════════════════════

✦ NO EMPTY CONTENT — EVER
  content_instructions → describe minimum 2 full paragraphs of real professional prose for each section.
  No placeholder text, no "TBD", no "[To be updated]", no empty strings "".
  Derive content from the input; use UPI domain knowledge to enrich brief inputs.

✦ BRD — ALWAYS INCLUDE ALL THREE:
  diagrams:  minimum 2 diagrams
               · 1 × SEQUENCE  — service/API interaction (all participants, all messages)
               · 1 × ACTIVITY  — end-to-end user journey (all steps)
  tables:    minimum 2 tables
               · Functional Requirements — headers: [ID, Requirement, Priority], min 5 FR rows, IDs: FR-01, FR-02 …
               · Roles & Responsibilities — headers: [Step, Activity, Responsible]
                 steps: Pre-Check → Step 1..N → Post Response
  diagrams with include_diagram=true must have a matching include in embeds equivalent
    (set diagram_description so the writer can embed it at the right section heading)

✦ DIAGRAMS — every diagram description must guide generation of complete valid PlantUML:
  SEQUENCE: include all participants; show every message with a label
  ACTIVITY: every step ends with semicolon  :Step Name;
  diagram_type: "sequence" | "activity" | "flowchart"
  diagram_description: unique descriptive string identifying what the diagram shows

✦ TABLES — minimum 3 rows of real data per table
  A section with include_table=true must have a content_instructions that specifies exact headers and rows.

═══════════════════════════════════════════════════════════
BRD DOCUMENT STRUCTURE — FOLLOW THIS SECTION ORDER EXACTLY
═══════════════════════════════════════════════════════════

Cover: Document title + version (supplied as metadata — do not create a section for it)
Revision History: Always first table — inside document_meta, NOT as a section.

Section 1: Background
  1.i   Current State — How the affected flow works TODAY, before this change.
  1.ii  Limitations/Challenges — Why current state is insufficient.
  1.iii Why Proposed Change — Business and technical justification.

Section 2: Product Overview
  2.i   Description — What the change does at a high level.
  2.ii  Product Construct — Detailed sub-sections per flow/component:
        Each sub-section = prose + indicative journey + R&R table + flow description.

Section 3: Other Salient Points — Edge cases, constraints, opt-in/opt-out rules.
Section 4: Dispute Management — Explicitly state if unchanged or describe changes.
Section 5: Envisaged Changes — Per stakeholder, per sub-area:
  5.1 NPCI (UPI Platform & CL)
      A. Setting / Schema / Registration changes
      B. Transaction Flow / Processing changes
  5.2 UPI App / PSP
      A. App-side changes
      B. Transaction-time changes
  5.3 Issuer Bank
      A. Auth/Registration changes
      B. Transaction Flow changes

═══════════════════════════════════════════════════════════
BRD CONTENT QUALITY
═══════════════════════════════════════════════════════════
- Background:          current state, limitations, rationale for the change
- Product Overview:    end-to-end description of the feature/product
- Salient Points:      minimum 6 numbered key points as prose
- Dispute Management:  liability framework, SLA, escalation path
- Envisaged Changes:   one sub-section per API/integration + R&R table after each
- Out of Scope:        explicitly list exclusions from the input
- Acceptance Criteria: tied to FR IDs from the Functional Requirements table

BRD LANGUAGE RULES:
  · Business language only — NO XSD field names, class names, or XML tags
  · Use accountability language — assign ownership explicitly to NPCI, PSP, Issuer Bank
  · Write as a subject matter expert in UPI / payments / banking
  · Never write placeholders, [TBD], or generic filler text

═══════════════════════════════════════════════════════════
OUTPUT FORMAT — return exactly this JSON structure
═══════════════════════════════════════════════════════════

{_SECTION_SCHEMA}

brdMetadata (populate inside document_meta):
  version, date, audience, revisionHistory
  revisionHistory columns: [Sr. No., Version No., Date of Change, Change By, Reviewed By, Remarks]
  Do NOT add revision history as a section — it goes in document_meta only.

For BRD: tsdMetadata=null, circularMetadata=null, productNoteMetadata=null, annexures=[]
{_COMMON_UPI_DOMAIN}
{_COMMON_JSON_RULES}"""


# ---------------------------------------------------------------------------
# TSD system prompt
# ---------------------------------------------------------------------------

_TSD_SYSTEM_PROMPT = f"""You are a senior document architect and domain expert. You produce professional,
publication-ready enterprise documents for any industry or domain.
You apply deep expertise in Technical Specification Documents (TSD).

═══════════════════════════════════════════════════════════
MANDATORY CONTENT RULES — APPLY TO EVERY SECTION
═══════════════════════════════════════════════════════════

✦ NO EMPTY CONTENT — EVER
  content_instructions → describe minimum 2 full paragraphs of real professional technical prose per section.
  No placeholder text, no "TBD", no "[To be updated]", no empty strings "".
  Derive all technical content from the input. Do NOT invent XML tags, API names, or schema attributes.

✦ TSD — ALWAYS INCLUDE ALL THREE:
  diagrams:  minimum 2 SEQUENCE diagrams — one per major API / integration flow
               Participants: exact stakeholder names from the input
  API specs: described in content_instructions with xmlSamples, rrRows, tagRows per section
               Derive xmlSamples ENTIRELY from API specs in the input
               For UPI XML-based APIs use XML format; for REST APIs use JSON format
  tables:    each API section must have include_table=true

═══════════════════════════════════════════════════════════
TSD DOCUMENT STRUCTURE — FOLLOW THIS SECTION ORDER EXACTLY
═══════════════════════════════════════════════════════════

"1. Document Overview"           — Purpose, Audience, Scope as prose sub-paragraphs
"2. Background"                  — current state, limitations, rationale
"3. Product Overview"            — high-level feature description, market view
"3.viii. Product Construct"      — overall construct from operating model / system design
"3.viii.a. [Flow 1 Name]"        — first major flow — name based on actual content
"3.viii.b. [Flow 2 Name]"        — second major flow if present
"4. Technical Specifications"    — intro paragraph only
"4.i. [API Group 1 Name]"        — first API or API group — name based on content
"4.ii. [API Group 2 Name]"       — second API group if present
"4.iii. Error Handling"          — error code table covering all failure scenarios
"4.iv. Note"                     — numbered cross-flow technical notes

tsdMetadata: version, date, audience, revisionHistory, apiSpecs[], errorRows[][], notes[]

TSD API Specs — one entry per API described in the input:
  apiName: the actual API/endpoint name from the input
  apiLabel: display label, e.g., "API 1: Eligibility Check (API Name: ListAccount)"
  targetSectionHeading: MUST exactly match one of the section headings above
  purpose: extract from input, one bullet per line separated by \\n
  rrRows: derive steps from the flow — [step, activity, responsible]
    format: Pre-Check → Step 1..N → Post Response
  xmlSamples: derive ENTIRELY from API specs in the input
    For UPI XML: use XML format with label "Request: (Payer PSP to UPI)" / "Response: (UPI to Payer PSP)"
    For REST/JSON: use JSON format with label "Request:" / "Response:"
    Use EXACT message structures from the input — do NOT invent or copy from other APIs
  tagRows: only when the input explicitly describes new XML tags or schema changes
    derive from "New fields" or "Schema changes" in the input

═══════════════════════════════════════════════════════════
TSD CONTENT QUALITY
═══════════════════════════════════════════════════════════
- Document Overview:  purpose, audience, scope — 2+ paragraphs each
- Background:         current state and limitations — 2+ paragraphs
- Product Construct:  one sub-section per major flow — describe end to end
- API Specs:          for each API: purpose + request/response samples + R&R table
- Error Handling:     full table: Response Code | Error Code | Description | API | Entity | TD/BD
- Notes:              all clarifications and important cross-flow notes

TSD LANGUAGE RULES:
  · Use precise technical language
  · Prefer exact field names and message names ONLY when grounded in the supplied input
  · Do NOT invent XML tags, APIs, class names, or schema attributes not present in the input
  · Never write placeholders, [TBD], or generic filler text

═══════════════════════════════════════════════════════════
OUTPUT FORMAT — return exactly this JSON structure
═══════════════════════════════════════════════════════════

{_SECTION_SCHEMA}

tsdMetadata (populate inside document_meta):
  version, date, audience, revisionHistory
  apiSpecs: array of API specs as described above
  errorRows: [[responseCode, errorCode, description, api, entity, tdBd], ...]
  notes: [list of note strings]

For TSD: brdMetadata=null, circularMetadata=null, productNoteMetadata=null, annexures=[]
Error Handling section content_instructions: write "POPULATED_BY_ERROR_TABLE" — the table is in tsdMetadata.errorRows.
{_COMMON_UPI_DOMAIN}
{_COMMON_JSON_RULES}"""


# ---------------------------------------------------------------------------
# Product Note system prompt
# ---------------------------------------------------------------------------

_PN_SYSTEM_PROMPT = f"""You are a senior document architect and domain expert. You produce professional,
publication-ready enterprise documents for any industry or domain.
You apply deep expertise in Product Notes and product documentation.

═══════════════════════════════════════════════════════════
MANDATORY CONTENT RULES — APPLY TO EVERY SECTION
═══════════════════════════════════════════════════════════

✦ NO EMPTY CONTENT — EVER
  content_instructions → describe minimum 2 full paragraphs of real professional prose per section.
  No placeholder text, no "TBD", no "[To be updated]", no empty strings "".
  Derive content from the input; use UPI domain knowledge to enrich brief inputs.

✦ PRODUCT NOTE — ALWAYS INCLUDE:
  diagrams:  minimum 2 diagrams
               · 1 × SEQUENCE  — service interaction across participants
               · 1 × ACTIVITY  — end-to-end user journey
  tables:    minimum 2 tables
               · Roles & Responsibilities per major flow — headers: [Step, Activity, Responsible]
               · Testing / Certification scenarios — headers: [Scenario, Objective, Owner]

✦ LANGUAGE RULE (CRITICAL):
  Product Note is for Banks, PSPs, TPAPs, and internal product teams.
  Translate ALL technical changes into STAKEHOLDER-FRIENDLY PRODUCT LANGUAGE.
  NO XSD field names, class names, internal handler names, or XML payload details.

═══════════════════════════════════════════════════════════
PRODUCT NOTE DOCUMENT STRUCTURE — FOLLOW THIS SECTION ORDER EXACTLY
═══════════════════════════════════════════════════════════

"1. Document Overview"
  i.   Purpose — What this product/change introduces
  ii.  Audience — Target stakeholders (business, tech, ops, partners)
  iii. Scope — What is included and excluded

"2. Background"
  i.   Current State — Existing system/process behaviour
  ii.  Limitations / Challenges — Pain points in current system
  iii. Rationale for Change — Why this solution is needed

"3. Product Overview"
  i.   Description of [Feature] — feature description prose
  ii.  Product Construct — construct overview prose
  a.   [Setting Flow Name] — e.g. "Biometric Setting / Consent Management"
       Include: Indicative Journey prose + Technical Flow intro
  b.   [Transaction Flow] — e.g. "Transaction"
       Include: transaction types + high-level changes + journey prose

"4. Other Salient Points" — numbered standalone product rules or UX constraints

"5. Dispute Management" — explicitly state if changed or unchanged

"6. Testing, Certification & Audits" — test environments, scenarios, certification steps

productNoteMetadata:
  version, date, audience, revisionHistory
  revisionHistory columns: [Sr. No., Version, Document Name, Date of Change, Remarks]
  apiSections: one entry per API in the product construct
    apiLabel: e.g. "1st API: Eligibility Check (API Name: ListAccount)"
    purpose: one bullet per line separated by \\n
    rrRows: [[step, activity, responsible]] — Pre-Check, Step 1..N, Post response
    keyConsiderations: [list of bullet strings]
  annexures: one entry per annexure
    label: "Annexure 1 - Pre-Checks"
    title: "ANNEXURE 1 - PRE-CHECKS"
    content: full prose
    headers/rows: [] unless a table is needed

═══════════════════════════════════════════════════════════
PRODUCT NOTE CONTENT QUALITY
═══════════════════════════════════════════════════════════
- Each section: minimum 3 substantive paragraphs drawn from the input content
- FAQs: embedded as prose in "FAQs and Communication Requirements" if present
- Risk section: identify domain-specific risks from the input + standard ones
- Testing section: enrollment, transaction, fallback, and disablement scenarios
- Identify approving authority for certification

For PRODUCT NOTE: brdMetadata=null, tsdMetadata=null, circularMetadata=null, annexures=[]
(annexures go inside productNoteMetadata.annexures only)

═══════════════════════════════════════════════════════════
OUTPUT FORMAT — return exactly this JSON structure
═══════════════════════════════════════════════════════════

{_SECTION_SCHEMA}
{_COMMON_UPI_DOMAIN}
{_COMMON_JSON_RULES}"""


# ---------------------------------------------------------------------------
# Circular system prompt
# ---------------------------------------------------------------------------

_CIRCULAR_SYSTEM_PROMPT = f"""You are a senior document architect and domain expert. You produce professional,
publication-ready enterprise documents for any industry or domain.
You apply deep expertise in official regulatory circulars.

═══════════════════════════════════════════════════════════
MANDATORY CONTENT RULES FOR CIRCULAR
═══════════════════════════════════════════════════════════

✦ A Circular is a FORMAL DIRECTIVE — terse, authoritative, and unambiguous.
  No narrative padding. No technical implementation detail.
  Name the affected artifact or API but do not explain how it works.

✦ CIRCULAR STRUCTURE RULES:
  · include_cover_page MUST be false
  · include_toc MUST be false
  · No diagrams unless a process flow is EXPLICITLY required by the input
  · No tables unless the input explicitly requires one
  · bodyParagraphs: minimum 4 paragraphs
  · Each body paragraph is one complete self-contained statement

═══════════════════════════════════════════════════════════
CIRCULAR DOCUMENT STRUCTURE — FOLLOW THIS SECTION ORDER EXACTLY
═══════════════════════════════════════════════════════════

Section 1: Letterhead & Reference Block
  — Issuing organization name, OC number in format [ORG]/[DEPT]/OC No. [NNN]/[YYYY-YYYY], issue date.

Section 2: Addressee Line
  — Complete recipient categories. Bold. Inclusive language ("All X, Y and Z").

Section 3: Subject Line
  — One line. Names the action, the specific feature or artifact, and the system scope.
  — Under 20 words. Formal sentence case.

Section 4: Context Paragraph
  — Current state, ecosystem gap, why the issuer is issuing this directive.
  — Single paragraph, 3-5 sentences. Factual and vendor-neutral.

Section 5: Decision & Scope Statement
  — Start with "[Organization] has decided to...".
  — Name the specific artifacts being changed so engineering teams can identify scope immediately.

Section 6: Participant Impact & Obligations
  — For each affected participant category, state specific obligations.
  — Use "must" for mandatory items and "are advised to" for recommended items.

Section 7: Dissemination Instruction
  — Standard one-line: "Please disseminate the information contained herein to the officials concerned."

Section 8: Signature Block
  — Close with "Yours Sincerely," followed by "SD/-", then authorizing official's name,
    designation, and department on separate lines.

circularMetadata (populate inside document_meta):
  ocNumber, date, addressee, subject, bodyParagraphs[], signatoryName,
  signatoryDesignation, closing, annexureTitles[]

For CIRCULAR: brdMetadata=null, tsdMetadata=null, productNoteMetadata=null,
  sections=[] (all content goes in circularMetadata), tables=[], embeds=[]

═══════════════════════════════════════════════════════════
OUTPUT FORMAT — return exactly this JSON structure
═══════════════════════════════════════════════════════════

{_SECTION_SCHEMA}
{_COMMON_UPI_DOMAIN}
{_COMMON_JSON_RULES}"""


# ---------------------------------------------------------------------------
# Generic fallback system prompt
# ---------------------------------------------------------------------------

_GENERIC_SYSTEM_PROMPT = f"""You are a senior document architect and domain expert. You produce professional,
publication-ready enterprise documents for any industry or domain.

DOCUMENT TYPE: {{doc_type}}

═══════════════════════════════════════════════════════════
MANDATORY CONTENT RULES
═══════════════════════════════════════════════════════════

✦ NO EMPTY CONTENT — EVER
  content_instructions → describe minimum 2 full paragraphs of real professional prose per section.
  No placeholder text, no "TBD", no "[To be updated]", no empty strings "".

✦ Create 5-8 sections appropriate for the document type.
  · For each section with structured data, set include_table=true and specify exact headers.
  · For each section with a process or interaction, set include_diagram=true and describe the diagram.
  · content_instructions must be substantive — at least 2 sentences explaining exactly what to write.
  · No [TBD], no placeholders.

═══════════════════════════════════════════════════════════
OUTPUT FORMAT — return exactly this JSON structure
═══════════════════════════════════════════════════════════

{_SECTION_SCHEMA}
{_COMMON_UPI_DOMAIN}
{_COMMON_JSON_RULES}"""


# ---------------------------------------------------------------------------
# Node 1 — retrieve_context
# ---------------------------------------------------------------------------

def retrieve_context(state: dict) -> dict:
    logger.info("[retrieve_context] job_id=%s", state.get("job_id"))
    state["status"] = "retrieving"

    try:
        prompt = state.get("prompt", "")
        collection = state.get("collection_name", "default")
        use_rag = state.get("use_rag", True)

        if not use_rag or not collection:
            state["rag_chunks"] = []
            state["rag_context"] = ""
            return state

        # Derive topic keyword from prompt
        topic = " ".join(prompt.split()[:6])

        chunks, context = retrieve_multi_query(
            prompt=prompt,
            topic=topic,
            collection_name=collection,
        )

        state["rag_chunks"] = chunks
        state["rag_context"] = context
        if chunks:
            logger.info(
                "[retrieve_context] collection=%s, retrieved_chunks=%d, rag_enabled=%s",
                collection,
                len(chunks),
                use_rag,
            )
        else:
            logger.warning(
                "[retrieve_context] collection=%s, no chunks retrieved — documents will be generated without RAG context.",
                collection,
            )

        # If a reference file was uploaded, extract its structure
        ref_path = state.get("reference_file_path")
        if ref_path and Path(ref_path).exists():
            from docgen.rag.engine import extract_reference_structure
            state["reference_structure"] = extract_reference_structure(ref_path)

    except Exception as e:
        logger.error("[retrieve_context] error: %s", e, exc_info=True)
        state["error"] = f"Context retrieval failed: {e}"
        state["status"] = "FAILED"

    return state


# ---------------------------------------------------------------------------
# Plan validation helper
# ---------------------------------------------------------------------------

def _validate_plan(plan: dict, doc_type: str) -> list[str]:
    """
    Return a list of error strings if the LLM-generated plan fails minimum quality checks.
    An empty list means the plan is acceptable.
    Note: blueprint plans bypass this function entirely (they return early in plan_document).
    """
    errors: list[str] = []

    sections = plan.get("sections", [])

    # Sections must exist
    if not sections:
        errors.append("Plan has no sections.")
        return errors

    placeholder_markers = (
        "[tbd]",
        "[to be updated]",
        "this section covers",
        "details to be elaborated",
        "to be elaborated further",
    )

    # No explicit placeholder content — catch obvious lazy planner output
    for sec in sections:
        instr = (sec.get("content_instructions", "") or "").strip()
        lowered = instr.lower()
        if any(marker in lowered for marker in placeholder_markers):
            errors.append(
                f"Section '{sec.get('heading')}' has placeholder content_instructions and must be regenerated."
            )

    return errors


# ---------------------------------------------------------------------------
# Node 2 — plan_document
# ---------------------------------------------------------------------------

def plan_document(state: dict) -> dict:
    logger.info("[plan_document] job_id=%s", state.get("job_id"))
    state["status"] = "planning"

    try:
        prompt = state.get("prompt", "")
        doc_type = state.get("doc_type", "BRD")
        brief = {
            "prompt": prompt,
            "document_title": state.get("document_title"),
            "version_number": state.get("version_number"),
            "classification": state.get("classification"),
            "audience": state.get("audience"),
            "desired_outcome": state.get("desired_outcome"),
            "format_constraints": state.get("format_constraints"),
            "organization_name": state.get("organization_name"),
            "reference_code": state.get("reference_code"),
            "issue_date": state.get("issue_date"),
            "recipient_line": state.get("recipient_line"),
            "subject_line": state.get("subject_line"),
            "signatory_name": state.get("signatory_name"),
            "signatory_title": state.get("signatory_title"),
            "signatory_department": state.get("signatory_department"),
        }
        blueprint_plan = build_blueprint_plan(doc_type, brief)
        if blueprint_plan:
            plan_data = DocumentPlan.model_validate(blueprint_plan).model_dump()
            state["document_plan"] = plan_data
            # Extract diagram specs from blueprint sections
            diagram_specs = []
            for i, section in enumerate(plan_data.get("sections", [])):
                if section.get("include_diagram") and state.get("include_diagrams", True):
                    diagram_specs.append({
                        "diagram_id": f"diagram_{i}_{uuid.uuid4().hex[:6]}",
                        "section_index": i,
                        "target_heading": section.get("heading", ""),
                        "diagram_type": section.get("diagram_type", "flowchart"),
                        "description": section.get("diagram_description", section.get("heading", "")),
                        "caption": section.get("diagram_description", section.get("heading", "")),
                    })
            state["diagram_specs"] = diagram_specs
            save_json_artifact(state.get("job_id", "tmp"), "document_plan.json", plan_data)
            return state

        llm = _make_llm_json()
        rag_context = state.get("rag_context", "")
        ref_structure = state.get("reference_structure", "")
        additional_context = state.get("additional_context", "")
        audience = state.get("audience", "")
        desired_outcome = state.get("desired_outcome", "")
        format_constraints = state.get("format_constraints", "")

        context_block = ""
        if rag_context:
            # Gap 3 FIX: was [:3000]; raised to [:8000] to avoid silently dropping
            # the latter half of multi-chunk RAG results.
            _RAG_LIMIT = 8000
            if len(rag_context) > _RAG_LIMIT:
                logger.warning(
                    "[plan_document] RAG context truncated from %d → %d chars",
                    len(rag_context), _RAG_LIMIT,
                )
            context_block = (
                "\nRelevant knowledge-base context. Use it only if it directly supports the user request:\n"
                f"{rag_context[:_RAG_LIMIT]}\n"
            )
        if ref_structure:
            context_block += f"\nReference document structure:\n{ref_structure}\n"
        if additional_context:
            context_block += f"\nAdditional context:\n{additional_context}\n"
        if audience:
            context_block += f"\nAudience:\n{audience}\n"
        if desired_outcome:
            context_block += f"\nDesired outcome:\n{desired_outcome}\n"
        if format_constraints:
            context_block += f"\nFormat constraints:\n{format_constraints}\n"

        system_msg = _planner_system_prompt(doc_type)
        user_msg = (
            f"Create a {doc_type} document plan for the following request:\n\n"
            f"{prompt}\n"
            f"{context_block}"
        )
        messages = [SystemMessage(content=system_msg), HumanMessage(content=user_msg)]

        response = llm.invoke(messages)
        raw = response.content if hasattr(response, "content") else str(response)
        plan_data = _parse_json_with_recovery(llm, raw, messages, _get_default_plan(state.get("doc_type", "BRD")), context=f"plan_document/{doc_type}")

        # Validate required keys
        if not isinstance(plan_data, dict) or "sections" not in plan_data:
            plan_data = _get_default_plan(state.get("doc_type", "BRD"))

        if not plan_data.get("title"):
            plan_data["title"] = f"{doc_type} Document"

        plan_data = DocumentPlan.model_validate(plan_data).model_dump()
        state["document_plan"] = plan_data
        save_json_artifact(state.get("job_id", "tmp"), "document_plan.json", plan_data)

        # Post-planning validation
        doc_type = plan_data.get("doc_type", state.get("doc_type", "BRD"))
        plan_errors = _validate_plan(plan_data, doc_type)
        if plan_errors:
            logger.warning(
                "[plan_document] Plan validation issues: %s — re-planning once",
                "; ".join(plan_errors),
            )
            retry_msg = (
                f"The plan you generated has the following issues:\n"
                + "\n".join(f"- {e}" for e in plan_errors)
                + "\n\nPlease fix ALL issues and return the corrected plan JSON."
            )
            messages_retry = messages + [HumanMessage(content=retry_msg)]
            response2 = llm.invoke(messages_retry)
            raw2 = response2.content if hasattr(response2, "content") else str(response2)
            plan_data2 = _parse_json_with_recovery(
                llm, raw2, messages_retry, plan_data, context="plan_document/retry"
            )
            if isinstance(plan_data2, dict) and "sections" in plan_data2:
                plan_data = DocumentPlan.model_validate(plan_data2).model_dump()
                state["document_plan"] = plan_data
                save_json_artifact(state.get("job_id", "tmp"), "document_plan.json", plan_data)

        # Extract diagram specs — include target_heading for positional embedding
        diagram_specs = []
        for i, section in enumerate(plan_data.get("sections", [])):
            if section.get("include_diagram") and state.get("include_diagrams", True):
                diagram_specs.append({
                    "diagram_id": f"diagram_{i}_{uuid.uuid4().hex[:6]}",
                    "section_index": i,               # kept for legacy compat
                    "target_heading": section.get("heading", ""),
                    "diagram_type": section.get("diagram_type", "flowchart"),
                    "description": section.get("diagram_description", section.get("heading", "")),
                    "caption": section.get("diagram_description", section.get("heading", "")),
                })

        state["diagram_specs"] = diagram_specs

    except Exception as e:
        logger.error("[plan_document] error: %s", e, exc_info=True)
        state["error"] = f"Document planning failed: {e}"
        state["status"] = "FAILED"
        state["document_plan"] = _get_default_plan(state.get("doc_type", "BRD"))

    return state


# ---------------------------------------------------------------------------
# Node 3 — generate_diagrams
# ---------------------------------------------------------------------------

def _generate_single_diagram(llm: ChatOllama, spec: dict, output_dir: str) -> tuple[str, str]:
    """Generate one diagram. Returns (diagram_id, path_or_empty).

    Strategy:
    1. Ask LLM for a valid PlantUML @startuml...@enduml block.
    2. Try to render it with plantuml.jar (requires Java + jar on disk).
    3. Fall back to Pillow-based rendering using a JSON spec if PlantUML is unavailable.
    """
    from docgen.tools.diagram_generator import generate_plantuml_diagram, _find_plantuml_jar

    diagram_id = spec["diagram_id"]
    dtype = spec["diagram_type"]
    description = spec["description"]
    out_path = str(Path(output_dir) / f"{diagram_id}.png")

    # ── Step 1 & 2: PlantUML path ──────────────────────────────────────
    plantuml_system = (
        f"You are a PlantUML expert. Generate a valid PlantUML {dtype} diagram.\n"
        "Rules:\n"
        "- Return ONLY the @startuml...@enduml block — no explanation, no markdown fences.\n"
        "- First line must be @startuml, last line must be @enduml.\n"
        f"- Diagram type: {dtype}\n"
        "- For ACTIVITY diagrams: every activity step MUST end with a semicolon, e.g. :Process Payment;\n"
        "- For SEQUENCE diagrams: declare all participants; show every message with a label.\n"
        "- For FLOWCHART (use_case / component): use --> arrows with labels.\n"
        "- Include all actors, steps, and decision points relevant to the description.\n"
        "- Keep it to 6-14 steps/messages for readability.\n"
        "- Every XML-based UPI API namespace must be xmlns:upi=\"http://npci.org/upi/schema/\"\n"
    )
    plantuml_user = f"Create a {dtype} PlantUML diagram for: {description}"

    try:
        resp = llm.invoke([SystemMessage(content=plantuml_system), HumanMessage(content=plantuml_user)])
        raw_puml = resp.content if hasattr(resp, "content") else str(resp)
        # Strip any markdown fences
        raw_puml = re.sub(r"^```(?:plantuml)?\s*", "", raw_puml.strip(), flags=re.IGNORECASE)
        raw_puml = re.sub(r"\s*```$", "", raw_puml)
        raw_puml = raw_puml.strip()
        if "@startuml" in raw_puml:
            puml_result = generate_plantuml_diagram(raw_puml, out_path)
            if puml_result:
                logger.info("PlantUML diagram generated: %s -> %s", diagram_id, out_path)
                return diagram_id, puml_result
    except Exception as e:
        logger.warning("PlantUML LLM/render step failed for %s: %s", diagram_id, e)

    # ── Step 3: Pillow fallback — ask for JSON spec ────────────────────
    schema_hint = {
        "sequence": (
            '{"title": "Authentication Sequence", "subtitle": "Happy path and validation checks", '
            '"actors": ["User", "Frontend", "Auth API"], '
            '"messages": [{"from_actor": "Actor1", "to_actor": "Actor2", '
            '"label": "Request", "direction": "forward"}], '
            '"notes": ["Optional note"]}'
        ),
        "flowchart": (
            '{"title": "Provisioning Flow", "subtitle": "Main steps, branch points, and outcomes", '
            '"nodes": [{"id": "start", "label": "Start", "node_type": "start"}, '
            '{"id": "p1", "label": "Process Step", "node_type": "process"}, '
            '{"id": "d1", "label": "Decision", "node_type": "decision"}, '
            '{"id": "end", "label": "End", "node_type": "end"}], '
            '"edges": [{"from_node": "start", "to_node": "p1", "label": ""}, '
            '{"from_node": "p1", "to_node": "d1", "label": ""}, '
            '{"from_node": "d1", "to_node": "end", "label": "Yes"}]}'
        ),
        "activity": (
            '{"title": "Cross-team Workflow", "subtitle": "Ownership by lane and handoff sequence", '
            '"lanes": ["Lane 1", "Lane 2"], '
            '"activities": [{"id": "a1", "label": "Activity 1", "lane": "Lane 1", "row": 0}], '
            '"edges": [{"from_id": "a1", "to_id": "a2", "label": ""}]}'
        ),
    }
    hint = schema_hint.get(dtype, schema_hint["flowchart"])
    json_system = (
        f"You are a diagram specification generator. "
        f"Create a {dtype} diagram spec as STRICT JSON. "
        "Respond with valid JSON ONLY. No markdown, no explanation. "
        f"Use this schema example:\n{hint}\n"
        "Make the diagram informative and presentation-ready. "
        "Use a clear title, a short subtitle, explicit labels, and realistic domain terminology. "
        "Prefer 4-7 nodes/messages when that improves clarity."
    )
    try:
        resp2 = llm.invoke([SystemMessage(content=json_system), HumanMessage(content=f"Create a {dtype} diagram for: {description}")])
        raw2 = resp2.content if hasattr(resp2, "content") else str(resp2)
        diagram_spec = _parse_json(raw2)
    except Exception as e:
        logger.warning("LLM JSON diagram spec failed for %s: %s, using empty", diagram_id, e)
        diagram_spec = {}

    result = generate_diagram(diagram_spec, dtype, out_path)
    return diagram_id, result or ""


def generate_diagrams(state: dict) -> dict:
    logger.info("[generate_diagrams] job_id=%s, specs=%d",
                state.get("job_id"), len(state.get("diagram_specs", [])))
    state["status"] = "generating_diagrams"

    try:
        specs = state.get("diagram_specs", [])
        if not specs or not state.get("include_diagrams", True):
            state["generated_diagrams"] = {}
            return state

        output_dir = str(Path(settings.output_dir) / state.get("job_id", "tmp"))
        Path(output_dir).mkdir(parents=True, exist_ok=True)

        llm = _make_llm_json()
        generated: dict[str, str] = {}

        for spec in specs:
            try:
                did, path = _generate_single_diagram(llm, spec, output_dir)
                if path:
                    generated[did] = path
                    logger.info("Generated diagram: %s -> %s", did, path)
            except Exception as e:
                logger.warning("Skipping diagram %s due to error: %s", spec.get("diagram_id"), e)

        state["generated_diagrams"] = generated

    except Exception as e:
        logger.error("[generate_diagrams] error: %s", e, exc_info=True)
        state["error"] = f"Diagram generation failed: {e}"
        state["status"] = "FAILED"

    return state


# ---------------------------------------------------------------------------
# Full per-type writer system prompts
# ---------------------------------------------------------------------------

_WRITER_CONTENT_SCHEMA = """{
  "section_heading": string,
  "paragraphs": [string, ...],
  "bullet_points": [string, ...],
  "numbered_items": [string, ...],
  "code_blocks": [string, ...],
  "table_data": {"headers": [string, ...], "rows": [[string, ...], ...]} or null
}"""

_WRITER_JSON_RULES = """
═══════════════════════════════════════════════════════════
JSON OUTPUT RULES — MANDATORY
═══════════════════════════════════════════════════════════
- Return ONLY valid JSON — no explanation, no markdown fences, no preamble
- Start directly with {  End directly with }
- Escape all quotes inside strings with \\\"
- No trailing commas
- paragraphs: array of strings — each string is one full paragraph (never a list item inside a paragraph string)
  PARAGRAPH LENGTH: Each paragraph must be 2-4 sentences maximum.
  If content is longer, split it into multiple paragraph strings.
  NEVER write a paragraph longer than 4 sentences.
- bullet_points and numbered_items: [] when not applicable — never null
- code_blocks: array of raw code/XML strings (not escaped, just the raw code text)
  Use code_blocks for ALL XML samples, JSON samples, request/response examples, and code snippets.
  NEVER put XML tags, JSON objects, or code inside paragraphs strings — always use code_blocks.
  [] when no code samples are needed.
- table_data: null when not applicable; when present must have 3-5 realistic rows minimum
- Never output [TBD], placeholder sentences, or empty strings in paragraphs
"""

_BRD_WRITER_SYSTEM_PROMPT = f"""You are a senior Business Requirements Document (BRD) author and UPI/payments domain expert.
You are filling ONE section of a pre-approved enterprise BRD. Do not invent or restructure the document.

═══════════════════════════════════════════════════════════
BRD WRITING RULES — APPLY TO EVERY SECTION
═══════════════════════════════════════════════════════════
✦ BUSINESS LANGUAGE ONLY — no XSD field names, no class names, no XML tags.
  Translate every technical change into accountable business prose:
  who owns it, what changes, what the business outcome is.
✦ MINIMUM 2 FULL PARAGRAPHS per body section. Each paragraph ≥ 4 sentences.
✦ PARAGRAPH LENGTH: Maximum 4 sentences per paragraph. Split longer content across multiple paragraph strings.
✦ Explicitly assign ownership to NPCI, PSP Bank, Issuer Bank, or Beneficiary Bank in every action statement.
✦ For Envisaged Changes sections: group changes by participant and by API/integration.
✦ For Background sections: describe current state → limitation → rationale in that order.
✦ For tables (when required):
    Functional Requirements → [ID, Requirement, Priority] with IDs FR-01, FR-02...
    Roles & Responsibilities → [Step, Activity, Responsible] Pre-Check … Post Response
✦ Write as a subject matter expert — no filler text, no [TBD], no generic sentences.
✦ Derive all content from the supplied instructions and context.
  Use UPI domain knowledge to enrich and validate what the input is asking for.

{_COMMON_UPI_DOMAIN}

═══════════════════════════════════════════════════════════
OUTPUT FORMAT — return exactly this JSON structure
═══════════════════════════════════════════════════════════
{_WRITER_CONTENT_SCHEMA}
{_WRITER_JSON_RULES}"""


_TSD_WRITER_SYSTEM_PROMPT = f"""You are a senior Technical Specification Document (TSD) author and UPI/payments integration expert.
You are filling ONE section of a pre-approved enterprise TSD. Do not invent or restructure the document.

═══════════════════════════════════════════════════════════
TSD WRITING RULES — APPLY TO EVERY SECTION
═══════════════════════════════════════════════════════════
✦ PRECISE TECHNICAL LANGUAGE — use exact field names, message names, and API names
  ONLY when they are explicitly present in the supplied instructions or context.
  Do NOT invent XML tags, API names, class names, or schema attributes.
✦ MINIMUM 2 FULL PARAGRAPHS per body section — operational and technical context.
✦ PARAGRAPH LENGTH: Maximum 4 sentences per paragraph. Split longer content across multiple paragraph strings.
✦ XML SAMPLES: Place ALL XML/request/response examples in code_blocks — NEVER inside paragraphs.
  Every XML sample MUST include namespace declaration: xmlns:upi="http://npci.org/upi/schema/"
  Label each code block with a comment line at the top: <!-- Request: PSP to NPCI --> etc.
✦ FIELD DICTIONARY: For every new or changed XML tag, include a table with columns:
  [Field Name, dType, dLength, Description, Mandatory (Y/N)]
✦ For API specification sections:
    Describe the purpose, inputs, outputs, and step-by-step participant interaction.
    Use Roles & Responsibilities table [Step, Activity, Responsible]: Pre-Check → Step 1..N → Post Response.
    Reference request/response samples only when explicit field specs are given in the input.
✦ For Error Handling sections:
    table_data headers: [Response Code, Error Code, Description, API, Entity, TD/BD]
    Each row is a specific, named error — no generic placeholders.
✦ For flow/construct sections: describe what the flow achieves + each participant's role.
✦ For Background sections: current state → limitation → rationale.
✦ Write precisely — no filler text, no [TBD], no invented details.

{_COMMON_UPI_DOMAIN}

═══════════════════════════════════════════════════════════
OUTPUT FORMAT — return exactly this JSON structure
═══════════════════════════════════════════════════════════
{_WRITER_CONTENT_SCHEMA}
{_WRITER_JSON_RULES}"""


_PN_WRITER_SYSTEM_PROMPT = f"""You are a senior Product Note author and UPI/payments product specialist.
You are filling ONE section of a pre-approved enterprise Product Note. Do not invent or restructure the document.

═══════════════════════════════════════════════════════════
PRODUCT NOTE WRITING RULES — APPLY TO EVERY SECTION
═══════════════════════════════════════════════════════════
✦ PRODUCT AND OPERATIONAL LANGUAGE — this document is read by Banks, PSPs, TPAPs, and product teams.
  Translate ALL technical changes into stakeholder-friendly product language.
  ABSOLUTELY NO XSD field names, class names, internal handler names, or XML payload snippets.
✦ MINIMUM 3 FULL PARAGRAPHS per body section. Each paragraph ≥ 4 sentences.
✦ PARAGRAPH LENGTH: Maximum 4 sentences per paragraph. Split longer content across multiple paragraph strings.
✦ For flow/journey sections: describe the end-to-end user experience and operational flow
  — who does what, in what order, and what the outcome is for each stakeholder.
✦ For Salient Points sections: number each point and write it as a standalone directive or insight.
  Minimum 6 numbered points.
✦ For Testing/Certification sections: list scenario types with objectives and owners.
  table_data headers: [Scenario, Objective, Owner].
✦ For Dispute Management sections: explicitly state whether the dispute process is unchanged
  or describe what changes. Assign liability clearly.
✦ Write as a product expert — clear, substantive, stakeholder-aware prose.
  No filler text, no [TBD], no technical jargon that belongs in a TSD.

{_COMMON_UPI_DOMAIN}

═══════════════════════════════════════════════════════════
OUTPUT FORMAT — return exactly this JSON structure
═══════════════════════════════════════════════════════════
{_WRITER_CONTENT_SCHEMA}
{_WRITER_JSON_RULES}"""


_CIRCULAR_WRITER_SYSTEM_PROMPT = f"""You are a senior regulatory circular author. You write formal, authoritative NPCI-style directives.
You are filling ONE section of a pre-approved official Circular. Do not invent or restructure the document.

═══════════════════════════════════════════════════════════
CIRCULAR WRITING RULES — APPLY TO EVERY SECTION
═══════════════════════════════════════════════════════════
✦ FORMAL DIRECTIVE LANGUAGE — terse, authoritative, unambiguous.
  No narrative padding. No technical implementation detail.
  Name the affected artifact or API but do not explain how it works.
✦ Each paragraph is one complete, self-contained directive statement.
✦ PARAGRAPH LENGTH: 2-4 sentences per paragraph. Never combine multiple directives in one paragraph.
  Minimum 4 paragraphs in the body sections combined.
✦ For addressee/subject sections: single line or short block — no prose expansion.
✦ For body/context sections: current state → gap → directive statement.
✦ For participant obligations: use "must" for mandatory, "are advised to" for recommended.
✦ For signature blocks: "Yours Sincerely," → "SD/-" → name, designation, department.
✦ No tables unless the input explicitly calls for one.
  No diagrams unless a process flow is explicitly required.

{_COMMON_UPI_DOMAIN}

═══════════════════════════════════════════════════════════
OUTPUT FORMAT — return exactly this JSON structure
═══════════════════════════════════════════════════════════
{_WRITER_CONTENT_SCHEMA}
{_WRITER_JSON_RULES}"""


_GENERIC_WRITER_SYSTEM_PROMPT = f"""You are a professional enterprise document author.
You are filling ONE section of a pre-approved document. Do not invent or restructure the document.

═══════════════════════════════════════════════════════════
WRITING RULES — APPLY TO EVERY SECTION
═══════════════════════════════════════════════════════════
✦ MINIMUM 2 FULL PARAGRAPHS per body section. Each paragraph ≥ 3 sentences.
✦ PARAGRAPH LENGTH: Maximum 4 sentences per paragraph. Split longer content across multiple paragraph strings.
✦ Write substantive professional prose — no filler text, no [TBD], no generic sentences.
✦ When a table is required: use concise, realistic headers aligned to the section purpose.
  Minimum 3 rows of real data per table.
✦ Use domain terminology consistent with the document context.
✦ Derive all content from the supplied section instructions and knowledge-base context.

{_COMMON_UPI_DOMAIN}

═══════════════════════════════════════════════════════════
OUTPUT FORMAT — return exactly this JSON structure
═══════════════════════════════════════════════════════════
{_WRITER_CONTENT_SCHEMA}
{_WRITER_JSON_RULES}"""


def _writer_system_prompt(doc_type: str) -> str:
    """Return the full, doc-type-specific system prompt for the writer node."""
    normalized = (doc_type or "").strip().lower()
    if normalized == "brd":
        return _BRD_WRITER_SYSTEM_PROMPT
    elif normalized == "tsd":
        return _TSD_WRITER_SYSTEM_PROMPT
    elif normalized in ("product note", "prd"):
        return _PN_WRITER_SYSTEM_PROMPT
    elif normalized == "circular":
        return _CIRCULAR_WRITER_SYSTEM_PROMPT
    else:
        return _GENERIC_WRITER_SYSTEM_PROMPT


# ---------------------------------------------------------------------------
# Node 4 — write_content
# ---------------------------------------------------------------------------

def _write_section(
    llm: ChatOllama,
    section: dict,
    rag_context: str,
    doc_type: str,
    audience: str = "",
    desired_outcome: str = "",
) -> dict:
    section_key = section.get("section_key")
    heading = section.get("heading", "Section")
    render_style = section.get("render_style", "body")
    instructions = section.get("content_instructions", f"Write content for {heading}")
    prompt_instruction = section.get("prompt_instruction", "")
    include_table = section.get("include_table", False)
    table_guidance = _table_guidance(section_key, heading) if include_table else ""

    system_msg = _writer_system_prompt(doc_type)

    context_snippet = rag_context[:2000] if rag_context else ""
    user_msg = (
        f"Write content for section: '{heading}'\n"
        f"Instructions: {instructions}\n"
        + (f"Required structure/style: {prompt_instruction}\n" if prompt_instruction else "")
        + (f"Audience focus: {audience}\n" if audience else "")
        + (f"Desired outcome: {desired_outcome}\n" if desired_outcome else "")
        + (f"Required table format: {table_guidance}\n" if table_guidance else "")
        + (
            "CRITICAL: Your JSON MUST include non-null table_data with non-empty headers and rows "
            "exactly as specified. Omitting the table breaks document generation.\n"
            if include_table
            else ""
        )
        + (
            f"\nKnowledge-base context (use only if relevant to this section):\n{context_snippet}"
            if context_snippet else ""
        )
    )

    fallback = {
        "section_key": section_key,
        "section_heading": heading,
        "render_style": render_style,
        "paragraphs": [f"This section covers {heading}.", "Details to be elaborated further."],
        "bullet_points": [],
        "numbered_items": [],
        "code_blocks": [],
        "table_data": fallback_table_data(section, heading) if include_table else None,
    }

    messages = [SystemMessage(content=system_msg), HumanMessage(content=user_msg)]
    try:
        response = llm.invoke(messages)
        raw = response.content if hasattr(response, "content") else str(response)
        content = _parse_json_with_recovery(llm, raw, messages, fallback, context=f"write_section/{heading}")
        if not isinstance(content, dict):
            content = fallback
        content.setdefault("section_heading", heading)
        content.setdefault("section_key", section_key)
        content.setdefault("render_style", render_style)
        content.setdefault("paragraphs", [])
        content.setdefault("bullet_points", [])
        content.setdefault("numbered_items", [])
        content.setdefault("code_blocks", [])
        content.setdefault("table_data", None)
        return GeneratedContent.model_validate(content).model_dump()
    except Exception as e:
        logger.warning("Content generation failed for '%s': %s", heading, e)
        return GeneratedContent.model_validate(fallback).model_dump()


def write_content(state: dict) -> dict:
    logger.info("[write_content] job_id=%s", state.get("job_id"))
    state["status"] = "writing"

    try:
        plan = state.get("document_plan", DEFAULT_PLAN)
        rag_context = state.get("rag_context", "")

        llm = _make_llm_json()
        sections_data = plan.get("sections", [])
        generated_sections = []
        doc_type = plan.get("doc_type", state.get("doc_type", "BRD"))
        audience = plan.get("document_meta", {}).get("audience", state.get("audience", ""))
        desired_outcome = plan.get("document_meta", {}).get("desired_outcome", state.get("desired_outcome", ""))

        from concurrent.futures import ThreadPoolExecutor, as_completed

        def _write_one(idx_section: tuple[int, dict]) -> tuple[int, dict]:
            idx, section = idx_section
            content = _write_section(
                llm,
                section,
                rag_context,
                doc_type=doc_type,
                audience=audience,
                desired_outcome=desired_outcome,
            )
            content["section_key"] = section.get("section_key")
            content["render_style"] = section.get("render_style", "body")
            content["level"] = section.get("level", 1)
            content["section_heading"] = section.get("heading", content.get("section_heading", ""))
            if doc_type.strip().lower() in ("brd", "product note"):
                content["code_blocks"] = []
            return idx, content

        configured_workers = min(settings.max_parallel_sections, len(sections_data)) or 1
        if settings.llm_provider == "openai_compat":
            # vLLM-backed JSON generation degrades under heavy concurrent section fan-out.
            max_workers = 1
        else:
            max_workers = configured_workers
        logger.info(
            "[write_content] job_id=%s sections=%d max_workers=%d provider=%s",
            state.get("job_id"),
            len(sections_data),
            max_workers,
            settings.llm_provider,
        )
        results: dict[int, dict] = {}
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(_write_one, (i, section)): i
                for i, section in enumerate(sections_data)
            }
            for future in as_completed(futures):
                idx, content = future.result()
                results[idx] = content

        # Reconstruct in original section order
        generated_sections = [results[i] for i in range(len(sections_data))]

        repaired, repair_notes = repair_sections_for_validation(plan, generated_sections)
        if repair_notes:
            logger.info(
                "[write_content] Auto-repaired %d section issue(s): %s",
                len(repair_notes),
                repair_notes,
            )
        generated_sections = repaired
        state["generated_sections"] = generated_sections
        save_json_artifact(state.get("job_id", "tmp"), "generated_sections.json", generated_sections)

    except Exception as e:
        logger.error("[write_content] error: %s", e, exc_info=True)
        state["error"] = f"Content writing failed: {e}"
        state["status"] = "FAILED"

    return state


# ---------------------------------------------------------------------------
# Node 5 — assemble_document
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Node 5 — review_document
# ---------------------------------------------------------------------------

def review_document(state: dict) -> dict:
    logger.info("[review_document] job_id=%s", state.get("job_id"))
    state["status"] = "reviewing"

    try:
        plan = state.get("document_plan", DEFAULT_PLAN)
        sections = state.get("generated_sections", [])
        sections, repair_notes = repair_sections_for_validation(plan, sections)
        if repair_notes:
            logger.info(
                "[review_document] Auto-repaired %d section issue(s): %s",
                len(repair_notes),
                repair_notes,
            )
            state["generated_sections"] = sections
        review = validate_generated_document(
            plan=plan,
            sections=sections,
            include_diagrams=state.get("include_diagrams", True),
        )
        if repair_notes:
            review.setdefault("warnings", [])
            review["warnings"].extend(f"Auto-repair: {n}" for n in repair_notes)
        state["review_report"] = review
        save_json_artifact(state.get("job_id", "tmp"), "review_report.json", review)
        if review["errors"]:
            state["error"] = "Document validation failed: " + "; ".join(review["errors"])
            state["status"] = "FAILED"
            return state
    except Exception as e:
        logger.error("[review_document] error: %s", e, exc_info=True)
        state["error"] = f"Document review failed: {e}"
        state["status"] = "FAILED"

    return state


# ---------------------------------------------------------------------------
# Node 6 — assemble_document
# ---------------------------------------------------------------------------

def assemble_doc(state: dict) -> dict:
    logger.info("[assemble_document] job_id=%s", state.get("job_id"))
    state["status"] = "assembling"

    try:
        job_id = state.get("job_id", "unknown")
        plan = state.get("document_plan", DEFAULT_PLAN)
        sections = state.get("generated_sections", [])
        diagram_specs = state.get("diagram_specs", [])
        generated_diagrams = state.get("generated_diagrams", {})

        session_id = state.get("session_id")
        doc_type_slug = plan.get("doc_type", "document").replace(" ", "_").lower()
        if session_id:
            # Session-scoped storage: all docs for a session in one folder
            session_dir = Path(settings.output_dir) / "sessions" / session_id
            session_dir.mkdir(parents=True, exist_ok=True)
            output_path = str(session_dir / f"{doc_type_slug}_{job_id[:8]}.docx")
        else:
            output_path = str(Path(settings.output_dir) / job_id / "document.docx")
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        final_path = assemble_document(
            plan,
            sections,
            output_path,
            diagram_specs=diagram_specs,
            generated_diagrams=generated_diagrams,
        )
        state["output_path"] = final_path
        state["status"] = "completed"
        logger.info("Document assembled: %s", final_path)

        doc_type = plan.get("doc_type", "")
        diagrams_embedded = sum(
            1 for s in diagram_specs
            if generated_diagrams.get(s.get("diagram_id", ""))
        )
        logger.info(
            "[assemble_document] doc_type=%s sections=%d diagrams_embedded=%d",
            doc_type, len(sections), diagrams_embedded,
        )

    except Exception as e:
        logger.error("[assemble_document] error: %s", e, exc_info=True)
        state["error"] = f"Document assembly failed: {e}"
        state["status"] = "FAILED"

    return state


# ---------------------------------------------------------------------------
# Error handler
# ---------------------------------------------------------------------------

def handle_error(state: dict) -> dict:
    logger.error("[handle_error] job_id=%s, error=%s", state.get("job_id"), state.get("error"))
    state["status"] = "failed"
    return state


# ---------------------------------------------------------------------------
# Routing logic
# ---------------------------------------------------------------------------

def _route_or_error(next_node: str):
    def router(state: dict) -> str:
        if state.get("error") or state.get("status") == "FAILED":
            return "handle_error"
        return next_node
    return router


# ---------------------------------------------------------------------------
# Build the StateGraph
# ---------------------------------------------------------------------------

def build_pipeline() -> Any:
    graph = StateGraph(dict)

    graph.add_node("retrieve_context", retrieve_context)
    graph.add_node("plan_document", plan_document)
    graph.add_node("generate_diagrams", generate_diagrams)
    graph.add_node("write_content", write_content)
    graph.add_node("review_document", review_document)
    graph.add_node("assemble_document", assemble_doc)
    graph.add_node("handle_error", handle_error)

    graph.set_entry_point("retrieve_context")

    graph.add_conditional_edges(
        "retrieve_context",
        _route_or_error("plan_document"),
        {"plan_document": "plan_document", "handle_error": "handle_error"},
    )
    graph.add_conditional_edges(
        "plan_document",
        _route_or_error("generate_diagrams"),
        {"generate_diagrams": "generate_diagrams", "handle_error": "handle_error"},
    )
    graph.add_conditional_edges(
        "generate_diagrams",
        _route_or_error("write_content"),
        {"write_content": "write_content", "handle_error": "handle_error"},
    )
    graph.add_conditional_edges(
        "write_content",
        _route_or_error("review_document"),
        {"review_document": "review_document", "handle_error": "handle_error"},
    )
    graph.add_conditional_edges(
        "review_document",
        _route_or_error("assemble_document"),
        {"assemble_document": "assemble_document", "handle_error": "handle_error"},
    )
    graph.add_edge("assemble_document", END)
    graph.add_edge("handle_error", END)

    return graph.compile()


def build_docgen_subgraph():
    """Build and return the document generation pipeline as a compiled LangGraph subgraph.

    This compiled graph can be embedded as a node in a parent StateGraph:

        parent_graph.add_node("docgen", build_docgen_subgraph())

    Required input state keys (must be provided by the parent graph):
        - job_id (str): Unique identifier for tracking and artifact storage.
        - prompt (str): User prompt / feature description.
        - doc_type (str): "BRD" | "TSD" | "Product Note" | "Circular"

    Optional input state keys:
        - session_id, document_title, version_number, classification,
          collection_name, use_rag, include_diagrams, audience,
          desired_outcome, format_constraints, organization_name,
          reference_code, issue_date, recipient_line, subject_line,
          signatory_name, signatory_title, signatory_department,
          additional_context

    Output state keys populated:
        - document_plan (dict)
        - diagram_specs (list)
        - generated_diagrams (dict)
        - generated_sections (list)
        - output_path (str | None): Path to the generated .docx file.
        - status (str): "completed" | "failed"
        - error (str | None)

    See SUBGRAPH_INTEGRATION_GUIDE.md for full usage examples.
    """
    return build_pipeline()


def _table_guidance(section_key: str | None, heading: str) -> str:
    key = (section_key or heading).lower()
    if "error" in key:
        return "Headers should be [Response Code, Error Code, Description, API, Entity, TD/BD]."
    if "testing" in key:
        return "Headers should be [Scenario, Objective, Owner] with realistic certification/test scenarios."
    if any(token in key for token in ("transaction", "setting", "construct", "responsibilities", "api")):
        return "Headers should be [Step, Activity, Responsible] with Pre-Check, Step 1..N, and Post Response rows."
    return "Use concise, realistic headers aligned to the section purpose."


def _section_mode_guidance(doc_type: str, section_key: str | None, heading: str) -> str:
    key = (section_key or heading).lower()
    normalized_doc_type = (doc_type or "").lower()

    if normalized_doc_type == "tsd":
        return (
            "Use precise technical language. Prefer exact field names and message names only when they are grounded in the supplied prompt/context. "
            "Do not invent XML tags, APIs, or schema attributes."
        )
    if normalized_doc_type == "product note":
        return (
            "Explain the feature in product and operational language. Avoid raw XML snippets, code identifiers, and internal class or handler names."
        )
    if normalized_doc_type == "brd":
        return (
            "Focus on stakeholder accountability, business impact, and required changes. Structure the prose so implementation ownership is explicit."
        )
    if normalized_doc_type == "circular":
        return (
            "Keep the content formal, directive, and concise. Avoid unnecessary narrative detail and do not add technical implementation trivia."
        )
    if "error" in key:
        return "Make the content operationally precise and aligned to realistic failure handling."
    return ""


# Singleton compiled pipeline
_pipeline = None


def get_pipeline():
    global _pipeline
    if _pipeline is None:
        _pipeline = build_pipeline()
    return _pipeline


# ---------------------------------------------------------------------------
# Public runner
# ---------------------------------------------------------------------------

def run_pipeline(initial_state: dict) -> dict:
    """Run the full pipeline and return the final state."""
    pipeline = get_pipeline()
    final_state = pipeline.invoke(initial_state)
    return final_state
