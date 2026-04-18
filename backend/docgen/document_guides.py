"""Document anatomy guides and blueprint helpers."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any


CIRCULAR_BLUEPRINT = {
    "title": "Circular",
    "subtitle": "Formal regulatory directive",
    "doc_type": "Circular",
    "tone": "Formal, directive, terse",
    "audience": "Member Banks, PSPs, TPAPs",
    "include_cover_page": False,
    "include_toc": False,
    "sections": [
        {
            "section_key": "letterhead_reference",
            "heading": "Letterhead & Reference Block",
            "level": 1,
            "render_style": "circular_reference",
            "content_instructions": (
                "Prepare the issuing organization header details. Include only the minimum official "
                "identity elements needed for traceability."
            ),
            "prompt_instruction": (
                "Include the issuing organization name, a formal circular reference number in the format "
                "[ORG]/[DEPT]/OC No. [NNN]/[YYYY-YYYY], and the issue date flush-right. "
                "This header is mandatory and must appear before all body text."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "addressee_line",
            "heading": "Addressee Line",
            "level": 1,
            "render_style": "circular_addressee",
            "content_instructions": "State the complete recipient categories bound by this circular.",
            "prompt_instruction": (
                "State the recipient categories precisely and comprehensively. Bold the addressee list. "
                "Use inclusive language ('All X, Y and Z')."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "subject_line",
            "heading": "Subject Line",
            "level": 1,
            "render_style": "circular_subject",
            "content_instructions": (
                "Write a one-line subject that clearly names the directive, the feature/artifact, and the scope."
            ),
            "prompt_instruction": (
                "Write a subject line that names the action, the specific feature or artifact, and the system scope. "
                "Under 20 words. Formal sentence case."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "context_paragraph",
            "heading": "Context Paragraph",
            "level": 1,
            "render_style": "body",
            "content_instructions": (
                "Explain the current state, the ecosystem gap, and why the issuer is issuing this directive. "
                "Keep it factual and vendor-neutral."
            ),
            "prompt_instruction": (
                "Describe the current state, identify the limitation or opportunity, and briefly state what the "
                "issuer has decided to do in response. Single paragraph, 3-5 sentences."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "decision_scope",
            "heading": "Decision & Scope Statement",
            "level": 1,
            "render_style": "body",
            "content_instructions": (
                "State the decision declaratively and name the technical artifacts, modules, schemas, or APIs affected."
            ),
            "prompt_instruction": (
                "Start with '[Organization] has decided to...'. Then name the specific artifacts being changed so "
                "engineering teams can identify scope immediately."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "participant_obligations",
            "heading": "Participant Impact & Obligations",
            "level": 1,
            "render_style": "body",
            "content_instructions": (
                "List the participant categories and their concrete implementation or compliance obligations."
            ),
            "prompt_instruction": (
                "For each affected participant category, state specific obligations. Use 'must' for mandatory items "
                "and 'are advised to' for recommended items."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "dissemination_instruction",
            "heading": "Dissemination Instruction",
            "level": 1,
            "render_style": "circular_dissemination",
            "content_instructions": "Include the standard one-line internal dissemination instruction.",
            "prompt_instruction": (
                "Include the standard dissemination instruction: "
                "'Please disseminate the information contained herein to the officials concerned.'"
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "signature_block",
            "heading": "Signature Block",
            "level": 1,
            "render_style": "circular_signature",
            "content_instructions": "Render the approving authority block.",
            "prompt_instruction": (
                "Close with 'Yours Sincerely,' followed by 'SD/-', then the authorizing official's name, designation, "
                "and department on separate lines."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
    ],
}

PRODUCT_NOTE_BLUEPRINT = {
    "title": "Product Note",
    "subtitle": "Comprehensive product reference",
    "doc_type": "Product Note",
    "tone": "Explanatory, thorough, structured",
    "audience": "Banks, TPAPs, TSPs, Internal Product & Tech teams",
    "include_cover_page": True,
    "include_toc": True,
    "sections": [
        {
            "section_key": "document_overview",
            "heading": "Document Overview",
            "level": 1,
            "render_style": "body",
            "content_instructions": "Write purpose, audience, and scope as three short sub-sections.",
            "prompt_instruction": "Write Purpose, Audience, and Scope sub-sections in short prose. No bullets unless needed for stakeholder names.",
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "background",
            "heading": "Background",
            "level": 1,
            "render_style": "body",
            "content_instructions": "Cover current state, limitations/challenges, and why this solution in a product-oriented way.",
            "prompt_instruction": "Use prose for current state and concise bullets for limitations and benefits.",
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "feature_description",
            "heading": "Product Overview - Feature Description",
            "level": 1,
            "render_style": "body",
            "content_instructions": "Explain what the feature is, what it enables, and the security/privacy principles in plain language.",
            "prompt_instruction": "Use 2-3 clear paragraphs. Avoid XML tags or API payload detail.",
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "product_construct_setting",
            "heading": "Product Construct: Setting / Enrollment",
            "level": 1,
            "render_style": "body",
            "content_instructions": (
                "If the feature requires explicit enrollment or opt-in by the user: describe UI placement, "
                "step-by-step enrollment journey, consent capture, and participant roles. "
                "If the feature does NOT require a separate enrollment or setting step (e.g., it is "
                "auto-enabled, accessed directly from the payment screen, or triggered from recent "
                "transactions): write exactly two sentences stating that this section is not applicable "
                "for this feature and briefly explain why (e.g., 'This feature does not require a "
                "separate enrollment step. Users access it directly from [describe entry point] without "
                "any prior registration or opt-in.'). NEVER leave this section blank."
            ),
            "prompt_instruction": (
                "If enrollment applies: structure as UI Placement → Indicative Journey → "
                "Roles & Responsibilities table (Step | Activity | Responsible). "
                "If enrollment does NOT apply: write 2 sentences only — state it is not applicable "
                "and explain the entry point. Do not fabricate enrollment steps that do not exist."
            ),
            "include_table": True,
            "table_fallback_profile": "process_steps",
            "include_diagram": True,
            "diagram_type": "activity",
            "diagram_description": "Feature access / enrollment journey across key participants",
        },
        {
            "section_key": "product_construct_transaction",
            "heading": "Product Construct: Transaction Flow",
            "level": 1,
            "render_style": "body",
            "content_instructions": "Describe the transaction scope, high-level system changes, supported modes, end-to-end transaction journey, and roles/responsibilities table for the payment execution flow.",
            "prompt_instruction": "Structure as Scope, High-level Changes, Modes, and Roles & Responsibilities. Include a table with Step | Activity | Responsible. Derive flows from the input — names of participants and steps must come from the actual document content.",
            "include_table": True,
            "table_fallback_profile": "process_steps",
            "include_diagram": True,
            "diagram_type": "sequence",
            "diagram_description": "Transaction flow across key participants and system components",
        },
        {
            "section_key": "policy_rules",
            "heading": "Key Considerations & Policy Rules",
            "level": 1,
            "render_style": "body",
            "content_instructions": "List optionality, consent scope, storage, key rotation, and disablement scenarios as actionable rules.",
            "prompt_instruction": "Use grouped bullets. Each bullet should state one explicit policy and its trigger or implication.",
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "salient_points",
            "heading": "Other Salient Points",
            "level": 1,
            "render_style": "body",
            "content_instructions": "Add numbered standalone product rules or UX constraints not already covered.",
            "prompt_instruction": "Use a numbered list of 1-2 sentence items only if such rules exist.",
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "dispute_management",
            "heading": "Dispute Management",
            "level": 1,
            "render_style": "body",
            "content_instructions": "State whether dispute management changes due to this feature.",
            "prompt_instruction": "If unchanged, explicitly say there is no change in dispute management.",
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "testing_certification",
            "heading": "Testing, Certification & Audits",
            "level": 1,
            "render_style": "body",
            "content_instructions": "Describe test environments, mandatory scenarios, certification steps, and audit expectations.",
            "prompt_instruction": "Cover enrollment, transaction, fallback, and disablement scenarios and identify approving authority.",
            "include_table": True,
            "table_fallback_profile": "test_matrix",
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "annexure_prechecks",
            "heading": "Annexure: Pre-Checks",
            "level": 1,
            "render_style": "body",
            "content_instructions": "Define pre-checks required before enrollment/enabling and at transaction time, with failure consequences for each. Derive the specific checks from the input.",
            "prompt_instruction": "Split into Before Enrollment/Enabling and At Transaction Time. Each item should name the check, which participant performs it, and the consequence if it fails.",
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
    ],
}

BRD_BLUEPRINT = {
    "title": "Business Requirements Document",
    "subtitle": "Business and implementation requirements",
    "doc_type": "BRD",
    "tone": "Structured, accountability-focused, complete",
    "audience": "Engineering & product leads, Banks, PSPs, NPCI internal teams",
    "include_cover_page": True,
    "include_toc": True,
    "sections": [
        # ── Section 1: Background ──────────────────────────────────────────
        {
            "section_key": "background_current_state",
            "heading": "i. Current State",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "Describe how the relevant UPI flow works TODAY before this change. "
                "Explain the existing mechanism, who the participants are, and how the current process operates. "
                "Minimum 2 paragraphs. Business language only — no XML tags or API field names."
            ),
            "prompt_instruction": (
                "Write 2 paragraphs: (1) the existing process and participants, "
                "(2) how the current system handles the relevant scenario."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "background_limitations",
            "heading": "ii. Limitations / Challenges",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "Explain why the current state is insufficient. "
                "Cover security gaps, friction points, scalability concerns, or regulatory gaps. "
                "Use bullet points or numbered items for each limitation. Minimum 1 paragraph + 4 bullet points."
            ),
            "prompt_instruction": (
                "Write a short intro paragraph then list ≥ 4 concrete limitations as bullet points. "
                "Each bullet names the limitation, the stakeholder it affects, and the consequence."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "background_rationale",
            "heading": "iii. Why the Proposed Change",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "State the business and technical justification for this change. "
                "Reference RBI guidelines, security improvements, user experience benefits, "
                "or ecosystem mandates where applicable. Minimum 2 paragraphs."
            ),
            "prompt_instruction": (
                "Write 2 paragraphs: (1) the business case and regulatory context, "
                "(2) the expected benefits and why this approach was chosen over alternatives."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        # ── Section 2: Product Overview ───────────────────────────────────
        {
            "section_key": "product_description",
            "heading": "i. Product Description",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "Provide a high-level description of what this feature/product does and what business outcome it achieves. "
                "Name the affected participants and the scope of changes. "
                "Business language only. Minimum 2 paragraphs."
            ),
            "prompt_instruction": (
                "Write 2-3 paragraphs describing: what the feature does, who it affects, "
                "and what problem it solves from a business perspective. No API details."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "product_construct_setting",
            "heading": "ii. Product Construct: Setting / Enrollment",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "If the feature requires explicit enrollment or opt-in: describe UI placement, "
                "consent capture, and the step-by-step enrollment journey with a Roles & "
                "Responsibilities table [Step, Activity, Responsible]. "
                "If the feature does NOT require a separate enrollment or setting step: write exactly "
                "two sentences stating that this section is not applicable for this feature and briefly "
                "explain why (e.g., 'This feature does not require a separate enrollment step. "
                "Users access it directly from [entry point] without prior registration or opt-in.'). "
                "NEVER leave this section blank."
            ),
            "prompt_instruction": (
                "If enrollment applies: write overview paragraph + Step/Activity/Responsible table. "
                "If enrollment does NOT apply: write exactly 2 sentences — not applicable + reason. "
                "Do not fabricate enrollment steps that do not exist for this feature. "
                "No XML tags. Plain business language."
            ),
            "include_table": True,
            "include_diagram": True,
            "diagram_type": "activity",
            "diagram_description": (
                "Enrollment / setting journey across UPI App, PSP, NPCI, and Issuer Bank"
            ),
            "table_fallback_profile": "process_steps",
        },
        {
            "section_key": "product_construct_transaction",
            "heading": "iii. Product Construct: Transaction Flow",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "Describe the end-to-end payment transaction flow after enrollment. "
                "Cover: triggering conditions, authentication path, debit/credit sequence, "
                "and a Roles & Responsibilities table with columns [Step, Activity, Responsible]. "
                "Rows: Pre-Check → Step 1..N → Post Response. Minimum 1 paragraph + R&R table."
            ),
            "prompt_instruction": (
                "Write a brief overview paragraph then produce a Step/Activity/Responsible table. "
                "Name the entity performing each step. Business language only — no XML payloads."
            ),
            "include_table": True,
            "table_fallback_profile": "process_steps",
            "include_diagram": True,
            "diagram_type": "sequence",
            "diagram_description": (
                "Transaction flow: UPI App → PSP → NPCI → Remitter Bank → Beneficiary Bank → NPCI → PSP"
            ),
        },
        # ── Section 3: Other Salient Points ──────────────────────────────
        {
            "section_key": "salient_points",
            "heading": "Other Salient Points",
            "level": 1,
            "render_style": "body",
            "content_instructions": (
                "List edge cases, constraints, opt-in/opt-out rules, backward-compatibility requirements, "
                "and any operational rules not covered in the Product Construct sections. "
                "Minimum 6 numbered points. Each point is one self-contained business rule or constraint."
            ),
            "prompt_instruction": (
                "Use numbered_items. Each item is a standalone, actionable business rule. "
                "Cover: optionality, device constraints, retry logic, consent withdrawal, "
                "backward compatibility, and any exception handling at the business level."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        # ── Section 4: Dispute Management ────────────────────────────────
        {
            "section_key": "dispute_management",
            "heading": "Dispute Management",
            "level": 1,
            "render_style": "body",
            "content_instructions": (
                "State explicitly whether dispute management changes due to this feature. "
                "If unchanged, say so clearly and reference the standard UPI dispute framework. "
                "If changed, describe the new liability assignment, SLA, and escalation path. "
                "Minimum 2 paragraphs."
            ),
            "prompt_instruction": (
                "Start with a declarative statement on whether the dispute process changes. "
                "Then describe liability, SLA, and escalation path explicitly."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        # ── Section 5: Functional Requirements ───────────────────────────
        {
            "section_key": "functional_requirements",
            "heading": "Functional Requirements",
            "level": 1,
            "render_style": "body",
            "content_instructions": (
                "List all functional requirements for this feature as a table. "
                "Table columns: [ID, Requirement, Priority]. "
                "IDs: FR-01, FR-02, ... Minimum 8 functional requirement rows. "
                "Each requirement is one testable statement. "
                "Write a 1-paragraph intro before the table."
            ),
            "prompt_instruction": (
                "Write a short intro paragraph, then produce a table with columns "
                "[ID, Requirement, Priority]. "
                "IDs start at FR-01. Priority values: High / Medium / Low. "
                "Each requirement is a single testable statement starting with 'The system shall'."
            ),
            "include_table": True,
            "table_fallback_profile": "requirement_table",
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        # ── Section 6: Envisaged Changes — NPCI ──────────────────────────
        {
            "section_key": "changes_npci_setting",
            "heading": "A. NPCI (UPI Platform & CL) — Setting / Schema / Registration Changes",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "List all NPCI platform, Common Library (CL), and schema changes required for the "
                "enrollment/setting flow. Number each requirement. "
                "Cover: new API messages, changed schema fields, CL version changes, configuration flags. "
                "Minimum 2 paragraphs + ≥ 4 numbered requirements."
            ),
            "prompt_instruction": (
                "Write a short intro, then number each change: (1) what changes, (2) which API or schema, "
                "(3) which participant must implement it. Business language — no raw XML tags."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "changes_npci_transaction",
            "heading": "B. NPCI (UPI Platform & CL) — Transaction Flow / Processing Changes",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "List all NPCI routing, processing, and validation changes for the payment transaction flow. "
                "Number each requirement. Cover: refCategory handling, credential validation, "
                "switch routing changes, response handling. "
                "Minimum 2 paragraphs + ≥ 4 numbered requirements."
            ),
            "prompt_instruction": (
                "Write a short intro, then number each change with entity ownership. "
                "Business language only."
            ),
            "include_table": False,
            "include_diagram": True,
            "diagram_type": "sequence",
            "diagram_description": (
                "NPCI switch processing changes for the new transaction flow"
            ),
        },
        # ── Section 7: Envisaged Changes — UPI App / PSP ─────────────────
        {
            "section_key": "changes_psp_app",
            "heading": "A. UPI App / PSP — App-side Changes",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "List all UPI App and PSP changes required on the app side for enrollment, "
                "consent capture, and device binding. Number each requirement. "
                "Cover: UI changes, CL SDK invocation, local key storage, device check logic. "
                "Minimum 2 paragraphs + ≥ 4 numbered requirements."
            ),
            "prompt_instruction": (
                "Write a short intro, then number each app-side change. "
                "Business language. Name the owning entity (UPI App or PSP) for each."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "activity",
            "diagram_description": "",
        },
        {
            "section_key": "changes_psp_transaction",
            "heading": "B. UPI App / PSP — Transaction-time Changes",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "List all UPI App and PSP changes required at payment time. "
                "Number each requirement. Cover: credential capture, CL invocation, "
                "fallback handling, response presentation. "
                "Minimum 2 paragraphs + ≥ 4 numbered requirements."
            ),
            "prompt_instruction": (
                "Write a short intro, then number each transaction-time change. Business language."
            ),
            "include_table": False,
            "include_diagram": True,
            "diagram_type": "activity",
            "diagram_description": (
                "UPI App and PSP responsibilities during payment execution"
            ),
        },
        # ── Section 8: Envisaged Changes — Issuer Bank ───────────────────
        {
            "section_key": "changes_issuer_auth",
            "heading": "A. Issuer Bank — Auth / Registration Changes",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "List all Issuer Bank changes required for authentication, registration, "
                "and credential management under this feature. Number each requirement. "
                "Cover: what the bank must store, validate, and respond to. "
                "Minimum 2 paragraphs + ≥ 4 numbered requirements."
            ),
            "prompt_instruction": (
                "Write a short intro, then number each issuer-bank auth/registration change. "
                "Business language — name what the bank must store, validate, and respond to. "
                "Derive all specifics from the input — do not assume a particular auth mechanism."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "changes_issuer_transaction",
            "heading": "B. Issuer Bank — Transaction Flow Changes",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "List all Issuer Bank changes for processing authenticated debit requests under this feature. "
                "Number each requirement. Cover: credential/auth validation, debit processing, "
                "response codes, timeout handling, fallback. "
                "Minimum 2 paragraphs + ≥ 4 numbered requirements."
            ),
            "prompt_instruction": (
                "Write a short intro, then number each transaction-flow change. Business language."
            ),
            "include_table": False,
            "include_diagram": True,
            "diagram_type": "sequence",
            "diagram_description": (
                "Issuer bank processing of authenticated debit requests and response flow"
            ),
        },
    ],
}

TSD_BLUEPRINT = {
    "title": "Technical Specification Document",
    "subtitle": "Engineering implementation contract",
    "doc_type": "TSD",
    "tone": "Precise, technical, unambiguous",
    "audience": "Engineers at Banks, PSPs, TSPs, and NPCI",
    "include_cover_page": True,
    "include_toc": True,
    "sections": [
        {
            "section_key": "background",
            "heading": "Background",
            "level": 1,
            "render_style": "body",
            "content_instructions": (
                "Describe the current state of the UPI ecosystem relevant to this feature. "
                "Cover: (i) what exists today, (ii) the gap or limitation that motivated this change, "
                "(iii) the rationale for the proposed technical approach. Minimum 2 substantive paragraphs."
            ),
            "prompt_instruction": (
                "Write current state first, then limitations, then rationale in separate paragraphs. "
                "Keep the language engineering-level but not implementation-specific."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "product_overview",
            "heading": "Product Overview",
            "level": 1,
            "render_style": "body",
            "content_instructions": (
                "Provide a high-level description of the feature being specified. "
                "What it does, which participants it touches, and what business outcome it enables. "
                "No API field details here — conceptual prose only. Minimum 2 paragraphs."
            ),
            "prompt_instruction": (
                "Describe the feature from a product perspective. Name the participants and flows at a high level. "
                "Do not describe XML field names or payload structures in this section."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "product_construct",
            "heading": "Product Construct",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "Describe the overall system design and operating model for the feature. "
                "Include: participant roles, interaction topology, key design decisions. Minimum 2 paragraphs."
            ),
            "prompt_instruction": (
                "Describe how the components fit together. Name each participant and what system role they play. "
                "Use prose — no XML payloads at this level."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "process_flow_setting",
            "heading": "Process Flow: Setting & Enrollment",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "Describe the step-by-step flow for the enrollment/setting process. "
                "Use a Roles & Responsibilities table: columns [Step, Activity, Entity]. "
                "Rows: Pre-Check, Step 1 through Step N, Post Response. "
                "Include a prose intro paragraph followed by the table."
            ),
            "prompt_instruction": (
                "Write a 1-paragraph overview then produce a Step/Activity/Entity table for every action in the flow. "
                "Be explicit about which entity (UPI App, PSP, NPCI, Issuer Bank) performs each step."
            ),
            "include_table": True,
            "table_fallback_profile": "process_steps",
            "include_diagram": True,
            "diagram_type": "sequence",
            "diagram_description": "Setting and enrollment flow: UPI App → PSP → NPCI → Issuer Bank → NPCI → PSP",
        },
        {
            "section_key": "process_flow_transaction",
            "heading": "Process Flow: Transaction",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "Describe the step-by-step flow for the transaction (payment execution) process. "
                "Use a Roles & Responsibilities table: columns [Step, Activity, Entity]. "
                "Rows: Pre-Check, Step 1 through Step N, Post Response."
            ),
            "prompt_instruction": (
                "Write a 1-paragraph overview then produce a Step/Activity/Entity table. "
                "Name every participant hop explicitly. Derive the flow entirely from the input."
            ),
            "include_table": True,
            "table_fallback_profile": "process_steps",
            "include_diagram": True,
            "diagram_type": "sequence",
            "diagram_description": "Transaction flow: UPI App → PSP → NPCI → Remitter Bank → Beneficiary Bank → NPCI → PSP",
        },
        {
            "section_key": "tech_specs_intro",
            "heading": "Technical Specifications",
            "level": 1,
            "render_style": "body",
            "validation_min_paragraphs": 1,
            "content_instructions": (
                "Write a short 1-paragraph introduction to the technical specifications section. "
                "State which APIs are specified and what the scope of changes is."
            ),
            "prompt_instruction": (
                "This is a section header with a brief intro only. "
                "Do not describe API details here — those follow in subsections."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "api_spec_primary",
            "heading": "i. Primary API Specifications",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "Identify the primary API(s) described in the input and specify them fully. "
                "For each API provide: (a) purpose and participant flow, "
                "(b) request/response message samples — use XML with xmlns:upi for UPI XML APIs, "
                "JSON for REST APIs; derive structures ONLY from the input, "
                "(c) new/changed field dictionary table [Field Name, dType, dLength, Description, Mandatory], "
                "(d) Roles & Responsibilities table [Step, Activity, Entity]: "
                "Pre-Check → Step 1..N → Post Response."
            ),
            "prompt_instruction": (
                "Name this section after the actual API(s) from the input (e.g., 'i. ReqPay & ListAccount' "
                "or 'i. Payment Initiation API'). Put all message samples in code_blocks. "
                "Field dictionary must list every new or changed field. "
                "Derive everything from the supplied input — do not invent fields or endpoints."
            ),
            "include_table": True,
            "table_fallback_profile": "field_spec",
            "include_diagram": True,
            "diagram_type": "sequence",
            "diagram_description": "Primary API request/response flow across participants",
        },
        {
            "section_key": "api_spec_secondary",
            "heading": "ii. Secondary API Specifications",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "Identify any secondary or supporting API(s) described in the input and specify them. "
                "For each API provide: (a) purpose and participant flow, "
                "(b) request/response message samples derived from the input, "
                "(c) field dictionary [Field Name, dType, dLength, Description, Mandatory], "
                "(d) Roles & Responsibilities [Step, Activity, Entity]. "
                "If there is no second distinct API in the input, use this section for "
                "error flow variants or alternative message variants of the primary API."
            ),
            "prompt_instruction": (
                "Name this section after the actual secondary API(s) from the input. "
                "Put all message samples in code_blocks. "
                "If only one API exists, cover its alternate variants (ENABLE/DISABLE, error paths) here."
            ),
            "include_table": True,
            "table_fallback_profile": "field_spec",
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "error_handling",
            "heading": "iii. Error Handling",
            "level": 2,
            "render_style": "body",
            "content_instructions": (
                "Provide a complete error code table covering all failure scenarios for the APIs specified above. "
                "Table columns: [Response Code, Error Code, Description, API, Entity, TD/BD]. "
                "Cover all failure categories present in the input: eligibility, activation, "
                "authentication, timeout, and any feature-specific error scenarios. "
                "Minimum 5 error rows. Write a short intro paragraph before the table."
            ),
            "prompt_instruction": (
                "This is a dedicated section — do not bury error codes inside other sections. "
                "Derive error codes and descriptions from the input. "
                "Include every failure scenario that an integration engineer needs to handle."
            ),
            "include_table": True,
            "table_fallback_profile": "error_matrix",
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
        {
            "section_key": "note",
            "heading": "iv. Note:",
            "level": 2,
            "render_style": "body",
            "validation_fill_numbered_items": True,
            "content_instructions": (
                "List all cross-flow technical notes, caveats, and mandatory operational rules "
                "that apply to this feature's implementation. "
                "Use a numbered list. Each note is a standalone, actionable technical statement. "
                "Minimum 4 numbered notes covering integration rules, edge cases, "
                "timeout handling, and any other implementation-critical details from the input."
            ),
            "prompt_instruction": (
                "Use numbered_items for this section, not paragraphs. "
                "Each note must be self-contained and implementation-actionable. "
                "Derive all notes from the input — no generic boilerplate."
            ),
            "include_table": False,
            "include_diagram": False,
            "diagram_type": "flowchart",
            "diagram_description": "",
        },
    ],
}


def _normalize_doc_type(doc_type: str) -> str:
    return (doc_type or "").strip().lower()


def get_document_blueprint(doc_type: str) -> dict[str, Any] | None:
    normalized = _normalize_doc_type(doc_type)
    if normalized == "circular":
        return deepcopy(CIRCULAR_BLUEPRINT)
    if normalized == "product note":
        return deepcopy(PRODUCT_NOTE_BLUEPRINT)
    if normalized == "brd":
        return deepcopy(BRD_BLUEPRINT)
    if normalized == "tsd":
        return deepcopy(TSD_BLUEPRINT)
    return None


def derive_subject(prompt: str) -> str:
    cleaned = " ".join(prompt.split())
    if not cleaned:
        return "Subject: Circular update"
    shortened = cleaned[:140].rstrip(" .,;:")
    if len(shortened.split()) > 20:
        shortened = " ".join(shortened.split()[:20])
    if not shortened.lower().startswith("subject:"):
        shortened = f"Subject: {shortened}"
    return shortened


def build_blueprint_plan(doc_type: str, brief: dict[str, Any]) -> dict[str, Any] | None:
    blueprint = get_document_blueprint(doc_type)
    if not blueprint:
        return None

    prompt = brief.get("prompt", "")
    organization_name = brief.get("organization_name") or "NPCI"
    signatory_department = brief.get("signatory_department") or "Product & Operations"
    current_year = datetime.now().year
    reference_code = brief.get("reference_code") or f"{organization_name}/UPI/OC No. 001/{current_year}-{current_year + 1}"
    issue_date = brief.get("issue_date") or datetime.now().strftime("%d %B %Y")
    recipient_line = brief.get("recipient_line") or "All Member Banks, PSP Banks and UPI Applications"
    subject = brief.get("subject_line") or derive_subject(prompt)
    version_number = brief.get("version_number") or "1.0"
    classification = brief.get("classification") or "Draft / Confidential"

    # Use the field names that match _revision_row_data() in docx_builder.py
    revision_history = [
        {
            "version": version_number,
            "version_no": version_number,
            "document_name": blueprint["title"],
            "date_of_change": issue_date,
            "changed_by": brief.get("signatory_name") or "NPCI",
            "reviewed_by": "",
            "remarks": "Initial draft",
        }
    ]

    blueprint["title"] = subject.replace("Subject:", "").strip() or "Circular"
    if _normalize_doc_type(doc_type) != "circular":
        blueprint["title"] = brief.get("document_title") or blueprint["title"]
    blueprint["subtitle"] = prompt[:120] if prompt else blueprint["subtitle"]
    blueprint["document_meta"] = {
        "organization_name": organization_name,
        "reference_code": reference_code,
        "issue_date": issue_date,
        "recipient_line": recipient_line,
        "subject_line": subject,
        "version_number": version_number,
        "classification": classification,
        "revision_history": revision_history,
        "signatory_name": brief.get("signatory_name") or "Authorized Signatory",
        "signatory_title": brief.get("signatory_title") or "Senior Vice President",
        "signatory_department": signatory_department,
        "audience": brief.get("audience") or blueprint.get("audience", ""),
        "desired_outcome": brief.get("desired_outcome") or "",
        "format_constraints": brief.get("format_constraints") or "",
    }
    return blueprint
