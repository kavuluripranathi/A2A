"""
Agent 5 — UI Prototype Generator

Reads the generated BRD content and produces a fully self-contained
HTML + CSS + JavaScript interactive mobile-app prototype that visually
demonstrates the feature's key user flows.

Called synchronously via asyncio.to_thread() from the router.
"""
import logging
import re

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

import config

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """You are a senior UI/UX designer and frontend developer specialising in mobile payment apps (UPI, BHIM, PhonePe style).

You will receive a Business Requirements Document (BRD) for a UPI/payments feature.
Analyse the BRD to identify all key user flows, screens, and interactions, then produce a complete
self-contained HTML + CSS + JS interactive prototype.

━━━ PROTOTYPE REQUIREMENTS ━━━

LAYOUT
• Outer page: centered, dark background (#0f172a)
• Phone frame: 390 × 844 px, rounded corners, drop shadow, positioned in the center
• Inside the frame render one screen at a time; screens slide in/out with a CSS transition

SCREENS (extract from BRD — minimum 5 screens)
  Screen 1 — Home / Entry point (show the feature entry in a typical UPI home screen)
  Screen 2-N — Key flow screens described in the BRD (input, confirmation, OTP, review, etc.)
  Last screen — Success / Receipt screen

DESIGN SYSTEM
• Primary color: #1B3F8F (NPCI blue)
• Accent: #4F8EF7
• Success: #16a34a
• Background cards: #ffffff
• Body text: #1e293b
• Subtle text: #64748b
• Font: system-ui, -apple-system, sans-serif
• Use ₹ for currency, realistic UPI IDs (user@axis, merchant@ybl, etc.)
• Use inline SVG or Unicode for icons — NO external icon libraries

NAVIGATION
• "Back" button (← arrow) on every screen except the first
• A slim progress bar at the top of the phone frame showing current step / total steps
• Screen title in a status-bar-style header

INTERACTIVITY
• All button clicks must navigate to the next logical screen using JavaScript
• Input fields should accept text (no validation required)
• Animate transitions: new screen slides in from the right, old screen exits to the left
• Include a floating "Restart" button (bottom-right of the phone) to return to screen 1

CODE RULES
• Output ONLY the raw HTML — no markdown fences, no explanation
• Start with <!DOCTYPE html>
• All CSS inside a <style> block in <head>
• All JS inside a <script> block before </body>
• Zero external dependencies (no CDN links, no Google Fonts, no images from URLs)
• Screens defined as <div class="screen" id="screen-N"> elements; only the active one is visible
• Use data-target="screen-N" attributes on buttons to wire navigation automatically
"""

# ---------------------------------------------------------------------------
# Public API — sync, called via asyncio.to_thread()
# ---------------------------------------------------------------------------

def generate_prototype(session_id: str, brd_content: str, feature_name: str = "") -> dict:
    """
    Generate a self-contained HTML UI prototype from BRD content.
    Returns a dict compatible with PrototypeState fields.
    """
    llm = ChatOpenAI(
        model=config.PROTOTYPE_MODEL_NAME,
        api_key=config.OPENAI_API_KEY,
        temperature=0.6,
        max_tokens=16000,
    )

    # Truncate BRD to avoid token overflow while keeping the most useful sections
    brd_trimmed = brd_content[:14000]

    human_text = f"""Feature: {feature_name or 'UPI Payment Feature'}

━━━ BUSINESS REQUIREMENTS DOCUMENT ━━━
{brd_trimmed}

━━━ TASK ━━━
Based on the BRD above, generate the complete interactive HTML prototype now.
Remember: output ONLY raw HTML starting with <!DOCTYPE html>."""

    system = SystemMessage(content=_SYSTEM_PROMPT)
    human = HumanMessage(content=human_text)

    logger.info("Prototype agent: invoking LLM for session=%s feature=%r", session_id, feature_name)
    response = llm.invoke([system, human])
    html = response.content.strip()

    # Strip accidental markdown fences
    html = re.sub(r"^```(?:html)?\s*\n?", "", html, flags=re.IGNORECASE)
    html = re.sub(r"\n?```\s*$", "", html, flags=re.IGNORECASE)

    # Count screens
    screen_ids = re.findall(r'id=["\']screen-?\d+["\']', html, re.IGNORECASE)
    screen_count = len(screen_ids) if screen_ids else max(
        len(re.findall(r'class=["\'][^"\']*\bscreen\b[^"\']*["\']', html, re.IGNORECASE)), 1
    )

    logger.info(
        "Prototype agent: generated %d chars, %d screens for session=%s",
        len(html), screen_count, session_id,
    )

    return {
        "prototype_html": html,
        "feature_name": feature_name,
        "screen_count": screen_count,
        "status": "ready",
        "error": None,
    }
