"""
Agent 2 — Deep Research Agent (LangGraph)

Graph flow:
  expand_sections (parallel per section)
       ↓
  synthesize_report
       ↓
  [READY — wait for feedback]
       ↓ (on feedback)
  apply_feedback  →  expand_sections (only flagged sections)  →  synthesize_report

NOTE: All nodes are SYNC to avoid Python 3.14 asyncio/LangGraph deadlock.
      The public API functions are called via asyncio.to_thread() from the router.
"""
import json
import logging
import copy
from typing import TypedDict, Annotated, Optional
import operator

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from agents.rag_client import query_rag_sync
import config

# Lazy import for Tavily
_TavilySearchResults = None

def _get_tavily_cls():
    global _TavilySearchResults
    if _TavilySearchResults is None:
        from langchain_community.tools.tavily_search import TavilySearchResults
        _TavilySearchResults = TavilySearchResults
    return _TavilySearchResults

logger = logging.getLogger(__name__)

SECTIONS = ["need", "market_view", "scalability", "success_kpis", "risks", "compliance"]

SECTION_PROMPTS = {
    "need": """Expand the 'Need' section into a detailed research analysis covering:
- Why build this feature (problem statement, pain points)
- Differentiation level: is it incremental or exponential? Cite market benchmarks.
- UX delta: specific improvements users will experience
- Cannibalization risk: quantify potential impact on existing products
- Cost of inaction: what happens if this is not built (competitor moves, regulatory risk)""",

    "market_view": """Expand the 'Market View' section covering:
- Ecosystem response: how will banks, PSPs, and payment networks react?
- Ecosystem effort and cost: estimate integration complexity and cost for participants
- Regulatory (RBI) view: relevant circulars, compliance requirements, approval pathways
- Competitive landscape: what are global/domestic competitors doing?""",

    "scalability": """Expand the 'Scalability' section covering:
- Demand anchors: what drives transaction volume growth?
- Supply anchors: infrastructure, partner onboarding capacity
- Projected impact: user numbers, revenue, timeline to meaningful scale
- Product operations: ops processes, support load, SLA requirements""",

    "success_kpis": """Expand the 'Success KPIs' section covering:
- Trust/Grievance KPIs: grievance rate targets, resolution time benchmarks
- Day-0 automation: what must be automated for smooth launch?
- SGF/FRM impact: settlement guarantee fund exposure, fraud risk management metrics
- Infrastructure and transaction KPIs: TPS capacity, latency, uptime SLAs""",

    "risks": """Expand the 'Risks' section covering:
- Fraud and abuse vectors: specific attack patterns this feature could enable
- Infosec and privacy: data exposure risks, PCI-DSS/GDPR/DPDP Act implications
- Second-order effects: unintended market, competitive, or regulatory consequences
- Mitigation strategies for each risk""",

    "compliance": """Expand the 'Compliance' section covering:
- Applicable RBI circulars and guidelines
- NPCI/UPI operating guidelines requirements
- Data localization requirements
- AML/KYC implications
- Required certifications or approvals before launch""",
}


# --------------------------------------------------------------------------
# LangGraph state
# --------------------------------------------------------------------------

class ResearchState(TypedDict):
    requirement_output: dict
    sections: Annotated[dict, lambda a, b: {**a, **b}]
    sources: dict
    feedback: Optional[str]
    sections_to_regenerate: Optional[list[str]]
    report_versions: list[dict]
    current_version: int
    status: str


# --------------------------------------------------------------------------
# LLM + tools
# --------------------------------------------------------------------------

def _llm():
    return ChatOpenAI(
        model=config.MODEL_NAME,
        api_key=config.OPENAI_API_KEY,
        temperature=0.4,
    )


def _tavily():
    TavilySearchResults = _get_tavily_cls()
    return TavilySearchResults(
        max_results=4,
        api_key=config.TAVILY_API_KEY,
    )


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _section_to_knowledge_type(section: str) -> Optional[str]:
    mapping = {
        "market_view": "rbi_guidelines",
        "compliance": "rbi_guidelines",
        "need": "product_canvas",
        "scalability": "product_documents",
        "success_kpis": "product_documents",
        "risks": "upi_codebase",
    }
    return mapping.get(section)


def _expand_single_section(
    section: str,
    requirement_data: dict,
    existing_content: Optional[str] = None,
    feedback: Optional[str] = None,
) -> tuple[str, list[str]]:
    """Expand one section (sync). Returns (content, sources_list)."""
    llm = _llm()
    sources = []

    # 1. RAG retrieval (sync)
    req_text = json.dumps(requirement_data.get(section, {}), indent=2)
    rag_result = query_rag_sync(
        f"{section} UPI payments embedded payments",
        top_k=config.FINAL_TOP_K,
        knowledge_type=_section_to_knowledge_type(section),
    )
    rag_context = rag_result["enriched_context"]
    for r in rag_result["results"]:
        sources.append(r["metadata"].get("source_file", "RAG"))

    # 2. Tavily web search (sync via run)
    web_context = ""
    try:
        tavily = _tavily()
        query = f"UPI {section.replace('_', ' ')} payments India RBI 2024 2025"
        web_results = tavily.run(query)
        if isinstance(web_results, list):
            web_snippets = [r.get("content", "") for r in web_results[:3]]
            web_context = "\n\n".join(web_snippets)
            sources.extend([r.get("url", "web") for r in web_results[:3]])
        elif isinstance(web_results, str):
            web_context = web_results[:2000]
    except Exception as e:
        logger.warning(f"Tavily search failed for section {section}: {e}")

    prompt_parts = [SECTION_PROMPTS[section]]
    prompt_parts.append(f"\n\nRequirement data for this section:\n{req_text}")
    if rag_context:
        prompt_parts.append(f"\n\nKnowledge base context:\n{rag_context[:3000]}")
    if web_context:
        prompt_parts.append(f"\n\nWeb research:\n{web_context[:2000]}")
    if existing_content and feedback:
        prompt_parts.append(f"\n\nPrevious content (incorporate feedback):\n{existing_content}")
        prompt_parts.append(f"\n\nUser feedback to address:\n{feedback}")

    system = SystemMessage(content="""You are a senior product research analyst specializing in UPI/payments.
Write a detailed, well-structured research analysis section.
Use markdown with headers (##, ###), bullet points, and bold for key terms.
Be specific with numbers, benchmarks, and regulatory references where available.
Cite sources inline as [Source: filename] when using knowledge base data.""")

    human = HumanMessage(content="\n".join(prompt_parts))
    response = llm.invoke([system, human])
    return response.content.strip(), list(set(sources))


# --------------------------------------------------------------------------
# Nodes (all sync)
# --------------------------------------------------------------------------

def expand_sections(state: ResearchState) -> dict:
    """Expand all sections (or only the flagged ones for regeneration)."""
    to_process = state.get("sections_to_regenerate") or SECTIONS
    existing_sections = state.get("sections", {})
    existing_sources = state.get("sources", {})
    feedback = state.get("feedback")

    new_sections = dict(existing_sections)
    new_sources = dict(existing_sources)

    for section in to_process:
        if section not in SECTIONS:
            continue
        content, srcs = _expand_single_section(
            section=section,
            requirement_data=state["requirement_output"],
            existing_content=existing_sections.get(section),
            feedback=feedback,
        )
        new_sections[section] = content
        new_sources[section] = srcs
        logger.info(f"Expanded section: {section}")

    return {"sections": new_sections, "sources": new_sources}


def synthesize_report(state: ResearchState) -> dict:
    """Combine all sections into a versioned report."""
    llm = _llm()
    sections = state["sections"]

    section_summaries = "\n\n".join(
        f"**{s.upper().replace('_', ' ')}**:\n{sections.get(s, '')[:500]}"
        for s in SECTIONS if s in sections
    )

    sys_msg = SystemMessage(content="""Write a concise executive summary (3-5 sentences)
synthesizing the key findings across all research sections. Be crisp and insightful.""")
    h_msg = HumanMessage(content=section_summaries)
    summary_resp = llm.invoke([sys_msg, h_msg])
    summary = summary_resp.content.strip()

    new_version = state.get("current_version", 0) + 1
    report = {
        "version": new_version,
        "summary": summary,
        "sections": [
            {
                "title": s.replace("_", " ").title(),
                "key": s,
                "content": sections.get(s, ""),
                "sources": state.get("sources", {}).get(s, []),
            }
            for s in SECTIONS
        ],
    }

    versions = list(state.get("report_versions", []))
    versions.append(report)

    return {
        "current_version": new_version,
        "report_versions": versions,
        "status": "ready",
        "feedback": None,
        "sections_to_regenerate": None,
    }


def apply_feedback(state: ResearchState) -> dict:
    """Determine which sections to regenerate based on feedback."""
    feedback = state.get("feedback", "")
    sections_to_regen = state.get("sections_to_regenerate")

    if not sections_to_regen:
        mentioned = [s for s in SECTIONS if s.replace("_", " ").lower() in feedback.lower()]
        sections_to_regen = mentioned if mentioned else SECTIONS

    return {
        "sections_to_regenerate": sections_to_regen,
        "status": "regenerating",
    }


# --------------------------------------------------------------------------
# Graph construction
# --------------------------------------------------------------------------

def build_research_graph() -> StateGraph:
    workflow = StateGraph(ResearchState)

    workflow.add_node("expand_sections", expand_sections)
    workflow.add_node("synthesize_report", synthesize_report)
    workflow.add_node("apply_feedback", apply_feedback)

    workflow.set_entry_point("expand_sections")
    workflow.add_edge("expand_sections", "synthesize_report")
    workflow.add_edge("synthesize_report", END)
    workflow.add_edge("apply_feedback", "expand_sections")

    return workflow


_checkpointer = None
_research_graph = None

def _get_graph():
    global _checkpointer, _research_graph
    if _research_graph is None:
        _checkpointer = MemorySaver()
        _research_graph = build_research_graph().compile(checkpointer=_checkpointer)
    return _research_graph


# --------------------------------------------------------------------------
# Public API — sync, called via asyncio.to_thread() from the router
# --------------------------------------------------------------------------

def generate_research(session_id: str, requirement_output: dict) -> dict:
    """Trigger initial research generation from requirement structured output."""
    graph = _get_graph()
    config_dict = {"configurable": {"thread_id": f"research_{session_id}"}}
    initial_state = {
        "requirement_output": requirement_output,
        "sections": {},
        "sources": {},
        "feedback": None,
        "sections_to_regenerate": None,
        "report_versions": [],
        "current_version": 0,
        "status": "generating",
    }
    return graph.invoke(initial_state, config=config_dict)


def regenerate_with_feedback(
    session_id: str,
    feedback: str,
    sections_to_regenerate: Optional[list[str]] = None,
) -> dict:
    """Resume with feedback and trigger regeneration."""
    graph = _get_graph()
    config_dict = {"configurable": {"thread_id": f"research_{session_id}"}}
    snapshot = graph.get_state(config_dict)
    current = snapshot.values

    updated = {
        **current,
        "feedback": feedback,
        "sections_to_regenerate": sections_to_regenerate,
        "status": "regenerating",
    }
    return graph.invoke(updated, config=config_dict)
