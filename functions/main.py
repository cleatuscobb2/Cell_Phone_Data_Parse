"""Firebase Cloud Function that summarizes a message history with Claude.

This is the deployed counterpart of backend/main.py. The local FastAPI proxy
is for development; this single HTTPS function is the production backend.

  - The Anthropic API key lives in a Firebase secret (ANTHROPIC_API_KEY) and
    is injected as an environment variable at runtime — it never reaches the
    browser.
  - Every request except /health must carry a valid Firebase ID token; the
    function verifies it before doing any work.
  - Uploaded files are parsed in memory and never written to disk or a DB.
    The only network egress is the request to Anthropic.

One function ("api") serves every route, dispatched on the request path:
  GET  /health
  POST /contacts
  POST /summarize
  POST /custody-report
"""

from __future__ import annotations

import base64
import contextvars
import csv
import io
import json
import os
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from typing import Literal

import anthropic
import firebase_admin
from firebase_admin import auth as fb_auth
from firebase_functions import https_fn, options
from pydantic import BaseModel, ValidationError

from parser import (
    compute_stats,
    filter_by_contact,
    filter_by_date,
    list_conversations,
    messages_to_records,
    parse_emails,
    parse_export,
    search_messages,
    to_condensed_string,
    with_context,
)

firebase_admin.initialize_app()

MODEL = "claude-opus-4-7"
# Opus 4.7 has a 1M-token context window; leave headroom for the response.
MAX_INPUT_TOKENS = 900_000

# The Anthropic client is created lazily so the secret-backed env var is
# guaranteed to be present by the time it is first used.
_client: anthropic.Anthropic | None = None


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the env
    return _client


class ApiError(Exception):
    """A request error to surface to the caller with an HTTP status."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# --- Structured-output schema -------------------------------------------------
# Claude is constrained to return exactly this shape, so the frontend can
# render it without defensive parsing.

class ActionItem(BaseModel):
    description: str
    owner: str
    priority: Literal["high", "medium", "low"]


class ContactInsight(BaseModel):
    name: str
    relationship_note: str


class SentimentPoint(BaseModel):
    period: str  # e.g. "2024-01" or "Week of Mar 4"
    sentiment_score: float  # -1.0 (very negative) .. 1.0 (very positive)
    label: Literal["positive", "neutral", "negative"]


class SearchFinding(BaseModel):
    term: str
    insight: str  # what the correspondence reveals about this term


class ConversationSummary(BaseModel):
    key_takeaways: list[str]
    action_items: list[ActionItem]
    contact_insights: list[ContactInsight]
    sentiment_trends: list[SentimentPoint]
    search_findings: list[SearchFinding]
    overall_sentiment: str


# --- Custody-report schema ----------------------------------------------------
# Every extracted item carries a verbatim `quote` and a `date` so it can be
# traced back to — and verified against — the original message.

# The enum-shaped fields below are typed as plain `str` to keep Claude's
# compiled structured-output grammar under its size limit. The allowed
# values are spelled out in CUSTODY_PROMPT and re-enforced by
# _normalize_extraction() after parsing.

class ChildcareEvent(BaseModel):
    date: str
    parent: str    # mother | father | shared | unclear
    description: str
    quote: str
    sender: str
    channel: str   # text | email | unclear


class MissedVisit(BaseModel):
    date: str
    kind: str      # cancellation | no_show | reschedule_request | late | declined_time | other
    description: str
    quote: str
    sender: str
    channel: str


class CommunicationGap(BaseModel):
    start_date: str
    end_date: str
    days: int
    description: str


class ResponsibilityEvent(BaseModel):
    date: str
    # education | medical_dental_eye | religious | child_care |
    # childrens_employment | motor_vehicle | activities | other
    category: str
    subcategory: str
    responsible_party: str   # mother | father | shared | unclear
    description: str
    quote: str
    sender: str
    channel: str


class ThirdPartyStatement(BaseModel):
    date: str
    source: str
    description: str
    quote: str
    channel: str


class Suggestion(BaseModel):
    # attachment | key_statement | evidence_to_gather | follow_up | other
    category: str
    suggestion: str
    related_date: str


class Expense(BaseModel):
    """A single child-related financial transaction sourced from a receipt,
    invoice, bank statement, or payment-app export. Paired with the
    `quote` (the verbatim line that grounds it) and `source_type` +
    `source_index` so the frontend can render a stable reference
    (R# for receipts/bills, V# for payment-app rows, B# for bank rows)
    that lines up with the timeline and the appendix.
    """
    date: str
    amount: float                     # USD, positive
    payer: Literal["mother", "father", "shared", "unclear"]
    payer_evidence: str               # how we know — "card ending 4521", "Venmo from Sarah", etc.
    vendor: str
    # Same court-recognized categories as ResponsibilityEvent so totals
    # roll up alongside the existing responsibility-share charts.
    category: Literal[
        "education",
        "medical_dental_eye",
        "religious",
        "child_care",
        "childrens_employment",
        "motor_vehicle",
        "activities",
        "other",
    ]
    subcategory: str
    description: str
    quote: str                        # verbatim text from the source document
    source_type: Literal["receipt", "payment_app", "bank", "eob"]
    source_index: int                 # 0-based position within its source-type list
    # EOB-only structured context — `amount` is the patient responsibility
    # (out-of-pocket); these two carry the surrounding insurance picture.
    billed_amount: float | None = None     # what the provider billed
    insurance_paid: float | None = None    # what the insurer covered


class CustodyExtraction(BaseModel):
    """Output shape for the per-window LLM extraction. Excludes the
    financial `expenses` field — that comes from a separate extractor —
    to keep Claude's compiled-grammar size under the API limit."""
    overview: str
    breakdown_basis: str
    childcare_events: list[ChildcareEvent]
    missed_or_cancelled: list[MissedVisit]
    communication_gaps: list[CommunicationGap]
    responsibility_events: list[ResponsibilityEvent]
    third_party_statements: list[ThirdPartyStatement]
    suggestions: list[Suggestion]
    sentiment_overview: str
    limitations: list[str]


class CustodyReport(CustodyExtraction):
    """API response shape — what the frontend receives. Adds the
    `expenses` list populated by the financial extractors."""
    expenses: list[Expense] = []


class CustodyNarrative(BaseModel):
    """The narrative-only fields, re-synthesized when windowed reports merge."""
    overview: str
    breakdown_basis: str
    sentiment_overview: str
    limitations: list[str]


class ExpenseList(BaseModel):
    """Container for a batched Claude extraction over many receipts / rows."""
    expenses: list[Expense]


# --- The prompt ---------------------------------------------------------------
# Static, so it caches cleanly across requests (prompt caching keys on the
# exact prefix bytes). The volatile conversation text goes in the user turn.

SYSTEM_PROMPT = """You are an expert conversation analyst. You are given a \
person's text-message history as a chronological, condensed transcript. \
Messages the user themselves sent are labeled "Me".

The user message may scope the request to a particular contact and/or a set \
of search terms. When it does, treat that filtered subset as the entirety of \
what you are analyzing.

Analyze the transcript and produce:

1. key_takeaways — The most important themes, events, decisions, and topics. \
Each takeaway is one clear, specific sentence. Aim for 5-9, ordered by \
importance.

2. action_items — Concrete commitments, follow-ups, plans, or unresolved \
requests someone still needs to act on. For each: a clear description, the \
owner ("Me" or a contact's name), and a priority of high, medium, or low. \
Only include genuine action items — do not invent them. An empty list is \
valid.

3. contact_insights — For the most significant contacts, a short note on the \
nature and tone of the relationship as evidenced by the messages.

4. sentiment_trends — How the emotional tone evolves over time. Bucket the \
transcript into chronological periods (by month, or by week if the span is \
short). For each: a period label, a sentiment_score from -1.0 (very negative) \
to 1.0 (very positive), and a label of positive, neutral, or negative. \
Produce at least 2 points so a trend is visible.

5. overall_sentiment — Two or three sentences characterizing the overall \
emotional arc.

6. search_findings — Only when the user message provides search terms. For \
each term, write one finding describing what the correspondence reveals about \
that topic: the substance of what was said, any decisions or recurring \
patterns, and how it was discussed. If no search terms were provided, return \
an empty list.

Be accurate and grounded strictly in the transcript. Do not speculate beyond \
what the messages support."""


CUSTODY_PROMPT = """You are a careful analyst helping a parent organize their \
own message history for a child-custody matter. Your role is strictly to \
EXTRACT and ORGANIZE factual events that are explicitly supported by the \
transcript. You do not give legal advice, you do not predict outcomes, and \
you do not decide what is admissible.

The user message states which parent is the user ("Me" in the transcript), \
names the other parent, and may name the children.

The transcript may combine text messages and emails. Email lines are tagged \
"(email)" and may list "[attachments: ...]". Treat both channels as one \
combined record: correlate them by timestamp and build a single chronological \
account of what happened.

CRITICAL RULES:
- Only include an event if it is explicitly supported by message text. Never \
infer, assume, or invent an event.
- For every event, include a `quote` copied verbatim from a message that \
supports it, and the `date` of that message (YYYY-MM-DD).
- For every event, set `channel` to "email" if the message line you quote is \
tagged "(email)" in the transcript, or "text" if it is not tagged. Use \
"unclear" only when you genuinely cannot tell.
- If you cannot tell which parent an event involves, use "unclear". Do not \
guess.
- Prefer omitting a borderline event over including a weakly-supported one.
- These outputs will be checked against the original messages by the user \
and their attorney. Accuracy and traceability matter more than completeness.

Produce:

- overview: A neutral, factual 3-5 sentence summary of what the co-parenting \
communications show.

- childcare_events: Every instance where the messages show a child was in the \
care of, spending time with, or being looked after by a specific parent. For \
each: date, which parent ("mother", "father", "shared", or "unclear"), a \
short factual description, the verbatim quote, and the sender of the quoted \
message.

- missed_or_cancelled: Every instance where the OTHER parent cancelled, did \
not show up for, asked to reschedule, arrived late for, or declined scheduled \
or offered time with the children. For each: date, kind (cancellation, \
no_show, reschedule_request, late, declined_time, other), description, \
verbatim quote, sender.

- communication_gaps: Notable stretches of time with no message from or about \
the other parent regarding the children, which may indicate a lack of \
outreach. For each: start_date, end_date, approximate number of days, and a \
description. Only report gaps clearly visible in the message timestamps.

- responsibility_events: Instances showing a parent handling a child-rearing \
responsibility. Classify each into ONE court-recognized category plus a \
specific subcategory. Categories:
  - education: teacher/parent conferences, tuition, books and clothes, \
transportation to and from school.
  - medical_dental_eye: medical, dental, or eye care — including who paid, \
transportation to appointments, scheduling and paperwork, and identifying a \
quality doctor and initiating contact.
  - religious: religious upbringing, observance, and instruction.
  - child_care: arranging or providing child care or babysitting.
  - childrens_employment: the children's jobs or employment.
  - motor_vehicle: the children's motor vehicle use, driving, and licensing.
  - activities: school and after-school activities — sports practices and \
games, camp, competition dance, awards and ceremonies, and Boy or Girl Scouts.
  - other: any child-rearing responsibility not covered above.
For each event: date, category (one of the keys above), subcategory (a short \
specific label, e.g. "Teacher/parent conference", "Tuition", "Books & \
clothes", "Who paid", "Scheduling & paperwork", "Sports — game", "Camp", \
"Competition dance", "Awards & ceremonies", "Scouts"), responsible_party \
("mother", "father", "shared", or "unclear"), description, verbatim quote, \
and sender.

- third_party_statements: Messages from people OTHER than the two parents \
that describe or corroborate either parent's involvement with the children \
(for example a relative, teacher, or friend commenting on caregiving). For \
each: date, source (who said it), description, verbatim quote.

- suggestions: Practical, actionable items to help the user and their \
attorney build a strong case. Use these categories:
  - attachment: any text or email that references a document, photo, file, \
or "[attachments: ...]" the user should locate, preserve, and provide to \
counsel — say what it is and when.
  - key_statement: especially strong or revealing statements already in the \
record that are worth flagging for counsel.
  - evidence_to_gather: records the messages reference but that are NOT \
themselves in the transcript (e.g. school records, report cards, medical \
bills, receipts) that the user should obtain.
  - follow_up: concrete next steps that would strengthen the case.
  - other: anything else useful.
For each: category, the suggestion text, and related_date (the relevant \
date in YYYY-MM-DD, or an empty string).

- breakdown_basis: A short explanation of how the childcare_events were \
identified and what makes the resulting count reliable or uncertain.

- sentiment_overview: A factual description of the tone of the communications \
specifically about arranging and discussing the children — note conflict, \
cooperation, hostility, or non-responsiveness, grounded in the messages.

- limitations: A candid list of caveats — what the transcript could NOT \
establish, where attributions were uncertain, that counts are estimates \
derived only from messages and not a complete record of actual time spent, \
and that message analysis cannot replace official school, medical, or court \
records.

Be neutral and factual throughout. Do not advocate; present what the \
messages show."""


REDUCE_PROMPT = """You are consolidating a child-custody communication \
analysis that was performed in several sequential time windows. You are given \
each window's overview and tone summary, plus the merged event totals across \
all windows.

Produce a single unified analysis of the ENTIRE history:

- overview: A neutral, factual 4-6 sentence summary of what the co-parenting \
communications show across the whole period.

- breakdown_basis: A short explanation of how the childcare instances were \
counted and what makes the total reliable or uncertain.

- sentiment_overview: A factual description of the overall tone of the \
communications about the children across the whole period.

- limitations: A candid list of caveats. ALWAYS include that the analysis was \
performed in multiple time-windowed passes, and that a communication gap \
straddling a window boundary may be split or under-counted. Carry forward any \
other limitations evident from the window summaries.

Be neutral and factual. Do not invent events or numbers beyond what you are \
given."""


EOB_PROMPT = """You are extracting child-related medical expenses from \
insurance Explanation-of-Benefits (EOB) documents uploaded by a parent in \
a child-custody case.

The user message provides:
- the case context (user's role, other parent's name, children),
- a card-lookup mapping from card-last-4 to "mother" or "father" \
(rarely used for EOBs — most EOBs identify the subscriber by name),
- one or more EOB documents, each labeled with its 0-based index.

For EACH service line on each EOB that pertains to one of the children, \
emit one Expense:
- date: date of service (YYYY-MM-DD)
- amount: the PATIENT RESPONSIBILITY for that service (deductible + copay \
+ coinsurance — what the parent actually owed out of pocket)
- billed_amount: the provider's billed amount for the service
- insurance_paid: what the insurer paid
- vendor: the provider / facility name as shown
- category: medical_dental_eye (almost always for EOBs)
- subcategory: short label — "Office visit", "Dental cleaning", \
"Vision exam", "Lab work", "Imaging", etc.
- description: factual sentence describing the service
- quote: a verbatim line from the EOB that supports the numbers
- payer: the subscriber if the EOB names them and they match the user or \
the other parent; otherwise "unclear"
- payer_evidence: e.g. "subscriber: Sarah Miller (mother)", "policyholder: David Miller (father)"
- source_type: "eob"
- source_index: the 0-based EOB index from the input

Skip lines that are for an adult only (not one of the children) or that \
have zero patient responsibility AND zero billed (informational only). \
Be conservative: omit anything you cannot ground in the document."""


RECEIPTS_PROMPT = """You are extracting child-related expenses from receipts, \
invoices, or bills uploaded by a parent in a child-custody case.

The user message provides:
- the case context (user's role, other parent's name, children),
- a card-lookup mapping from card-last-4 to "mother" or "father",
- one or more receipt images, in order, each labeled with its 0-based index.

For each image, decide whether it shows a single transaction that is \
plausibly child-related: medical, dental, eye care, school, camp, daycare, \
activities, religious instruction, motor-vehicle, or children's employment.

Skip non-child-related transactions (groceries, the parent's own bills, etc.) \
— omit them entirely. Skip ambiguous receipts.

For each child-related receipt emit one Expense with:
- date: YYYY-MM-DD from the receipt
- amount: total paid (positive USD)
- vendor: merchant or service provider as shown
- category: one of education, medical_dental_eye, religious, child_care, \
childrens_employment, motor_vehicle, activities, other
- subcategory: short specific label
- description: one factual sentence
- quote: a verbatim line from the receipt (e.g. "Pediatric Dental of WV — $342.50")
- payer: from the card-lookup ("mother" or "father" if a recognized card \
last-4 appears) — otherwise "unclear"
- payer_evidence: how you decided (e.g. "card ending 4521 → mother", \
"name on receipt: David Miller", "no payer evidence visible")
- source_type: "receipt"
- source_index: the 0-based image index from the input

Be conservative: omit anything you cannot ground in what the receipt shows."""


BANK_CSV_PROMPT = """You are filtering and categorizing transactions from a \
parent's BANK or CREDIT-CARD statement in a child-custody case.

The user message provides:
- the case context (user's role, other parent's name, children),
- a card-lookup mapping from card-last-4 to "mother" or "father",
- a JSON list of raw transactions; each has source_index, date, amount, \
description, bank_category, and card_last4.

Most bank/credit-card rows are NOT child-related (groceries, gas, \
restaurants, the parent's own bills, subscriptions, mortgage / rent). \
DROP those — be aggressive.

Keep a row only when its description is clearly child-related:
- Medical, dental, vision providers (Pediatric Dental, Children's \
Hospital, dentist, orthodontist, optometrist)
- School / education (tuition, PTA, school supplies if obvious from memo)
- Camp / activities / sports / dance / scouts
- Daycare / after-school care
- Religious instruction
- Children's motor-vehicle expenses (DMV, driving school)

For each kept row emit an Expense with:
- date, amount, vendor (extract a clean name from the description)
- category, subcategory from the court-recognized categories
- description (one factual sentence) and quote (the verbatim row description)
- payer: from the card-lookup if card_last4 matches; otherwise "unclear"
- payer_evidence: e.g. "card ending 4521 → mother", "no card_last4 in row"
- source_type: "bank"
- source_index: pass through from the row

Be very conservative — when in doubt, omit. The cost of a false positive \
(a non-child expense in the ledger) is much higher than missing one."""


PAYMENT_CSV_PROMPT = """You are categorizing payment-app transactions \
(Venmo, Zelle, Cash App, PayPal) from a parent in a child-custody case.

The user message provides:
- the case context (user's role, other parent's name, children),
- a JSON list of raw transactions; each has source_index, date, amount, \
sender, recipient, memo, and type.

Decide whether each transaction is plausibly child-related (camp, daycare, \
school, medical, activities, religious instruction, etc.). Skip rent, \
takeout, parent-only spending, and ambiguous rows.

For each child-related row emit an Expense with:
- date, amount, vendor (the recipient or merchant name)
- category, subcategory (use the same category enum as receipts)
- description (one factual sentence) and quote (the memo verbatim)
- payer: "mother" if the user sent it, "father" if the other parent did, \
"shared" if memo indicates a split, "unclear" otherwise
- payer_evidence: e.g. "Venmo from Sarah", "Zelle to Camp Pines from Dave"
- source_type: "payment_app"
- source_index: pass through from the row

Be conservative — when in doubt, omit."""


# --- Upload parsing -----------------------------------------------------------

def _load_export(raw: bytes, filename: str) -> object:
    """Decode an upload into the structure parse_export() expects."""
    text = raw.decode("utf-8-sig", errors="replace")
    if filename.lower().endswith(".csv"):
        return list(csv.DictReader(io.StringIO(text)))
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise ApiError(422, f"File is not valid JSON: {e}")


def _parse_date(value: str | None, field: str) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise ApiError(422, f"{field} must be YYYY-MM-DD, got: {value!r}")


def _parse_text_upload(raw: bytes, filename: str) -> list:
    """Parse a text-message export into Message objects (channel='text')."""
    try:
        return parse_export(_load_export(raw, filename))
    except ValueError as e:
        raise ApiError(422, f"Text-message file: {e}")


def _parse_email_upload(raw: bytes, filename: str, user_email: str | None) -> list:
    """Parse an email upload into Message objects (channel='email')."""
    name = (filename or "").lower()
    if name.endswith((".json", ".csv")):
        try:
            messages = parse_export(_load_export(raw, filename))
        except ValueError as e:
            raise ApiError(422, f"Email file: {e}")
        for m in messages:
            m.channel = "email"
        return messages
    return parse_emails(raw, filename, user_email)


def _collect_messages(req: https_fn.Request) -> list:
    """Read every upload across both channels, parse each, merge by time.
    Multiple files per channel are supported — useful when a parent has
    several text exports or multiple .eml/.mbox files."""
    messages: list = []
    user_email = req.form.get("user_email")
    for f in req.files.getlist("file"):
        messages += _parse_text_upload(f.read(), f.filename or "")
    for ef in req.files.getlist("email_file"):
        messages += _parse_email_upload(ef.read(), ef.filename or "", user_email)
    if not messages:
        raise ApiError(
            422, "Upload a text-message export, an email file (.eml/.mbox), or both."
        )
    messages.sort(key=lambda m: m.timestamp)
    return messages


# Cap on how many matched messages are returned to the UI breakdown.
DISPLAY_CAP = 500
# Cap on the full transcript returned with a custody report (PDF appendix).
TRANSCRIPT_CAP = 2000
# Chunked custody analysis — a long history is split into chronological
# windows, analyzed concurrently, then merged into one report. A window is
# capped by BOTH transcript size and message count: even a modestly sized
# but event-dense window can overflow a single structured response.
CHUNK_CHARS = 300_000          # max transcript size per window
MAX_MESSAGES_PER_WINDOW = 50   # max messages per window (bounds output size)
MAX_CHUNKS = 30                # refuse histories that would need more windows
CHUNK_CONCURRENCY = 4          # windows analyzed in parallel


# --- /summarize ---------------------------------------------------------------

def handle_summarize(req: https_fn.Request) -> dict:
    form = req.form
    # 1. Read and parse the upload(s) — in memory only, nothing persisted.
    messages = _collect_messages(req)
    messages = filter_by_date(
        messages,
        _parse_date(form.get("start_date"), "start_date"),
        _parse_date(form.get("end_date"), "end_date"),
    )
    if not messages:
        raise ApiError(422, "No messages found in the file for the selected date range.")

    # 2. Narrow to a single contact, if requested.
    contact = form.get("contact")
    if contact:
        messages = filter_by_contact(messages, contact)
        if not messages:
            raise ApiError(422, f"No messages found for contact {contact!r}.")

    # 3. Apply search terms — comma-separated, OR-matched on message body.
    terms = [t.strip() for t in (form.get("search_terms") or "").split(",") if t.strip()]
    matched = search_messages(messages, terms)
    if terms and not matched:
        raise ApiError(422, f"No messages matched the search terms: {', '.join(terms)}.")

    focused = bool(contact or terms)
    transcript_messages = with_context(messages, matched, window=2) if terms else matched
    condensed = to_condensed_string(transcript_messages)
    stats = compute_stats(matched)

    # 4. Build the user turn; the system prompt stays static (cacheable).
    scope_lines: list[str] = []
    if contact:
        scope_lines.append(f"This transcript is the correspondence with: {contact}.")
    if terms:
        scope_lines.append(
            "Focus the entire analysis on messages relevant to these search "
            f"terms: {', '.join(terms)}. Produce a search finding for each term."
        )
    user_content = "\n\n".join(
        scope_lines + [f"Here is the message history transcript:\n\n{condensed}"]
    )

    # 5. Context-window guard — never silently truncate.
    token_count = client().messages.count_tokens(
        model=MODEL,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    ).input_tokens
    if token_count > MAX_INPUT_TOKENS:
        raise ApiError(
            413,
            f"The selected messages are too large ({token_count:,} tokens) for a "
            f"single request. Narrow the date range, contact, or search terms.",
        )

    # 6. Summarize. Structured output guarantees the response shape.
    try:
        summary = _structured_extract(
            ConversationSummary,
            system_text=SYSTEM_PROMPT,
            user_content=user_content,
            max_tokens=32000,
        )
    except anthropic.APIStatusError as e:
        raise ApiError(502, f"Claude API error ({e.status_code}): {e.message}")

    body = {
        "meta": {
            "total_messages": stats["total_messages"],
            "conversation_count": stats["conversation_count"],
            "date_range": stats["date_range"],
            "tokens_analyzed": token_count,
            "contact": contact or None,
            "search_terms": terms,
        },
        "stats": {
            "top_contacts": stats["top_contacts"],
            "volume": stats["volume"],
        },
        "summary": summary.model_dump(),
    }
    if focused:
        body["matched_messages"] = messages_to_records(matched[:DISPLAY_CAP])
        body["matched_truncated"] = len(matched) > DISPLAY_CAP
    return body


# --- /custody-report ----------------------------------------------------------

def _case_profile_context(profile: dict) -> list[str]:
    """Turn the WV custody intake answers into prompt context lines so the
    extraction is tailored to the filer's specific case and form packet."""
    phrases: list[str] = []
    ms = profile.get("marital_status")
    if ms == "married":
        phrases.append("the parents are currently married (custody within a divorce)")
    elif ms == "unmarried":
        phrases.append("the parents are not married or are already divorced")
    ct = profile.get("case_type")
    if ct == "new":
        phrases.append("this is a new custody/support case")
    elif ct == "modification":
        phrases.append("this is a modification of an existing order")
    if profile.get("temporary_relief") == "yes":
        phrases.append("temporary orders are being requested while the case is pending")
    if profile.get("child_support") == "yes":
        phrases.append("child support establishment or enforcement is involved")
    if profile.get("address_safety") == "yes":
        phrases.append("disclosing the filer's address could endanger their safety")
    if profile.get("other_parent_address") == "unknown":
        phrases.append("the other parent's address is unknown or out of state")
    if profile.get("military") == "yes":
        phrases.append("the other parent is on active military duty")
    if not phrases:
        return []
    return [
        "This analysis supports a West Virginia family-court custody filing.",
        "Case profile: " + "; ".join(phrases) + ".",
        "Organize and emphasize the evidence so it helps complete the required "
        "WV forms — especially the Parenting Plan (parenting schedule and "
        "decision-making) and, where support is involved, the Financial Statement.",
    ]


def _custody_breakdown(events: list[ChildcareEvent]) -> dict:
    """Derive custody-split counts and percentages directly from the cited
    childcare events. Shared time is split half to each parent; unclear is
    excluded from the percentage."""
    counts = Counter(e.parent for e in events)
    mother, father, shared = counts["mother"], counts["father"], counts["shared"]
    denom = mother + father + shared
    return {
        "instances_with_mother": mother,
        "instances_with_father": father,
        "instances_shared": shared,
        "instances_unclear": counts["unclear"],
        "estimated_pct_mother": round((mother + 0.5 * shared) / denom * 100, 1) if denom else 0.0,
        "estimated_pct_father": round((father + 0.5 * shared) / denom * 100, 1) if denom else 0.0,
    }


def _split_into_chunks(messages: list, max_chars: int) -> list[list]:
    """Split time-sorted messages into chronological windows, each kept under
    max_chars of transcript AND under MAX_MESSAGES_PER_WINDOW messages — the
    message cap bounds how large the model's extracted output can grow."""
    chunks: list[list] = []
    current: list = []
    size = 0
    for m in messages:
        cost = len(m.body) + 45
        full = size + cost > max_chars or len(current) >= MAX_MESSAGES_PER_WINDOW
        if current and full:
            chunks.append(current)
            current, size = [], 0
        current.append(m)
        size += cost
    if current:
        chunks.append(current)
    return chunks


# Allowed values for the formerly-Literal enums, used to normalize the
# model's free-form `str` output back into canonical buckets.
_PARTIES = {"mother", "father", "shared", "unclear"}
_CHANNELS = {"text", "email", "unclear"}
_MISSED_KINDS = {
    "cancellation", "no_show", "reschedule_request",
    "late", "declined_time", "other",
}
_RESP_CATEGORIES = {
    "education", "medical_dental_eye", "religious", "child_care",
    "childrens_employment", "motor_vehicle", "activities", "other",
}
_SUGGESTION_CATEGORIES = {
    "attachment", "key_statement", "evidence_to_gather", "follow_up", "other",
}


def _bucket(value: str | None, allowed: set[str], fallback: str) -> str:
    """Coerce a free-text field into one of the allowed canonical buckets."""
    if not value:
        return fallback
    v = value.strip().lower().replace(" ", "_").replace("-", "_")
    return v if v in allowed else fallback


def _normalize_extraction(report: CustodyExtraction) -> None:
    """Snap the model's free-form enum-shaped strings into canonical buckets."""
    for e in report.childcare_events:
        e.parent = _bucket(e.parent, _PARTIES, "unclear")
        e.channel = _bucket(e.channel, _CHANNELS, "unclear")
    for m in report.missed_or_cancelled:
        m.kind = _bucket(m.kind, _MISSED_KINDS, "other")
        m.channel = _bucket(m.channel, _CHANNELS, "unclear")
    for r in report.responsibility_events:
        r.category = _bucket(r.category, _RESP_CATEGORIES, "other")
        r.responsible_party = _bucket(r.responsible_party, _PARTIES, "unclear")
        r.channel = _bucket(r.channel, _CHANNELS, "unclear")
    for t in report.third_party_statements:
        t.channel = _bucket(t.channel, _CHANNELS, "unclear")
    for s in report.suggestions:
        s.category = _bucket(s.category, _SUGGESTION_CATEGORIES, "other")


def _structured_extract(
    output_model: type[BaseModel],
    *,
    system_text: str,
    user_content,
    max_tokens: int = 32000,
    use_thinking: bool = False,  # kept for signature compatibility — unused
) -> BaseModel:
    """Call Claude with the output model's JSON schema as a NON-strict tool,
    via the streaming API so we can request a much larger max_tokens budget
    (the non-streaming path caps at ~16k, which truncates dense windows
    mid-JSON and produces a 413).

    Thinking is incompatible with a forced tool_choice on this model, so
    it is not enabled here."""
    _ = use_thinking  # noqa: F841
    with client().messages.stream(
        model=MODEL,
        max_tokens=max_tokens,
        system=[{
            "type": "text",
            "text": system_text,
            "cache_control": {"type": "ephemeral"},
        }],
        messages=[{"role": "user", "content": user_content}],
        tools=[{
            "name": "submit",
            "description": "Submit the structured analysis.",
            "input_schema": output_model.model_json_schema(),
        }],
        tool_choice={"type": "tool", "name": "submit"},
    ) as stream:
        response = stream.get_final_message()
    if response.stop_reason == "max_tokens":
        raise ApiError(
            413,
            "A time window produced too many events to extract. Narrow the date "
            "range and try again.",
        )
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "submit":
            try:
                return output_model.model_validate(block.input)
            except ValidationError:
                raise ApiError(
                    413,
                    "A time window produced more events than fit in one response. "
                    "Narrow the date range and try again.",
                )
    raise ApiError(502, "The model did not return a structured response.")


def _extract_chunk(chunk_messages: list, context_lines: list[str],
                   window_note: str) -> CustodyExtraction:
    """Run the custody extraction over one window."""
    condensed = to_condensed_string(chunk_messages)
    user_content = "\n".join(context_lines) + (
        f"\n\n{window_note}\n\nHere is this portion of the transcript:\n\n{condensed}"
    )
    try:
        report = _structured_extract(
            CustodyExtraction,
            system_text=CUSTODY_PROMPT,
            user_content=user_content,
            max_tokens=32000,
        )
    except anthropic.APIStatusError as e:
        raise ApiError(502, f"Claude API error ({e.status_code}): {e.message}")
    _normalize_extraction(report)
    return report


def _combine_reports(partials: list[CustodyExtraction]) -> CustodyReport:
    """Merge windowed reports: concatenate the event lists, then re-synthesize
    the narrative across all windows with a final reduce call."""
    def sort_by(items, attr):
        return sorted(items, key=lambda x: getattr(x, attr) or "")

    childcare = sort_by([e for p in partials for e in p.childcare_events], "date")
    missed = sort_by([e for p in partials for e in p.missed_or_cancelled], "date")
    gaps = sort_by([g for p in partials for g in p.communication_gaps], "start_date")
    responsibility = sort_by([r for p in partials for r in p.responsibility_events], "date")
    third_party = sort_by([t for p in partials for t in p.third_party_statements], "date")
    suggestions = [s for p in partials for s in p.suggestions]

    cb = _custody_breakdown(childcare)
    window_summaries = "\n\n".join(
        f"Window {i + 1}:\nOverview: {p.overview}\nTone: {p.sentiment_overview}\n"
        f"Window limitations: {'; '.join(p.limitations)}"
        for i, p in enumerate(partials)
    )
    totals = (
        f"Merged totals across all {len(partials)} windows — childcare instances: "
        f"{len(childcare)} (with mother {cb['instances_with_mother']}, with father "
        f"{cb['instances_with_father']}, shared {cb['instances_shared']}, unclear "
        f"{cb['instances_unclear']}); missed or cancelled visits: {len(missed)}; "
        f"communication gaps: {len(gaps)}; responsibility events: "
        f"{len(responsibility)}; third-party statements: {len(third_party)}."
    )

    narrative = None
    try:
        narrative = _structured_extract(
            CustodyNarrative,
            system_text=REDUCE_PROMPT,
            user_content=f"{window_summaries}\n\n{totals}",
            max_tokens=4000,
        )
    except (anthropic.APIStatusError, ValidationError, ApiError):
        narrative = None

    if narrative is None:
        narrative = CustodyNarrative(
            overview=" ".join(p.overview for p in partials),
            breakdown_basis=partials[0].breakdown_basis,
            sentiment_overview=" ".join(p.sentiment_overview for p in partials),
            limitations=sorted({l for p in partials for l in p.limitations})
            + ["This report was assembled from multiple time-windowed analysis passes; "
               "a communication gap spanning a window boundary may be split."],
        )

    return CustodyReport(
        overview=narrative.overview,
        breakdown_basis=narrative.breakdown_basis,
        childcare_events=childcare,
        missed_or_cancelled=missed,
        communication_gaps=gaps,
        responsibility_events=responsibility,
        third_party_statements=third_party,
        suggestions=suggestions,
        sentiment_overview=narrative.sentiment_overview,
        limitations=narrative.limitations,
    )


# --- Financial extraction -----------------------------------------------------
# Bounds for the receipt and payment-CSV batched Claude calls.
MAX_RECEIPTS = 20
MAX_EOBS = 12
MAX_CSV_ROWS = 200
MAX_BANK_ROWS = 500

_IMAGE_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
# PDFs go through Claude's document content block — multi-page bills and
# invoices are handled in one call without any pre-rasterization.
_PDF_EXTS = (".pdf",)


def _parse_financial_inputs(monthly_gross_income: str | None) -> dict:
    """Normalize the optional SCA-FC-106 income field."""
    out: dict = {}
    if monthly_gross_income:
        cleaned = "".join(c for c in monthly_gross_income if c.isdigit() or c == ".")
        try:
            v = float(cleaned)
            if v > 0:
                out["monthly_gross_income"] = v
        except ValueError:
            pass
    return out


def _parse_card_lookup(raw: str | None) -> dict[str, str]:
    """JSON-decode the card-lookup mapping {last4: 'mother'|'father'}."""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in parsed.items():
        k4 = "".join(c for c in str(k) if c.isdigit())[-4:]
        if len(k4) == 4 and v in ("mother", "father"):
            out[k4] = v
    return out


def _parse_payment_csv(raw: bytes, filename: str, base_index: int) -> list[dict]:
    """Tolerant parse of a Venmo / Zelle / Cash App / PayPal CSV."""
    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict] = []
    for row in reader:
        lc = {k.lower().strip(): (v or "").strip() for k, v in row.items() if k}
        date_str = (
            lc.get("datetime") or lc.get("date") or
            lc.get("transaction date") or lc.get("when") or ""
        )[:10]
        amt_raw = (
            lc.get("amount (total)") or lc.get("amount") or
            lc.get("total") or lc.get("net amount") or "0"
        )
        amt_clean = "".join(c for c in amt_raw if c.isdigit() or c in ".-")
        try:
            amount = abs(float(amt_clean)) if amt_clean else 0.0
        except ValueError:
            amount = 0.0
        sender = lc.get("from") or lc.get("sender") or lc.get("sent from") or ""
        recipient = lc.get("to") or lc.get("recipient") or lc.get("sent to") or ""
        memo = (
            lc.get("note") or lc.get("memo") or lc.get("description") or
            lc.get("subject") or ""
        )
        tx_type = lc.get("type") or lc.get("transaction type") or ""
        if amount == 0 and not memo:
            continue
        rows.append({
            "source_index": base_index + len(rows),
            "date": date_str,
            "amount": amount,
            "sender": sender,
            "recipient": recipient,
            "memo": memo,
            "type": tx_type,
            "source_file": filename,
        })
    return rows


def _normalize_bank_date(s: str) -> str:
    """Normalize MM/DD/YYYY, M/D/YY, or YYYY-MM-DD to YYYY-MM-DD."""
    s = (s or "").strip()
    if not s:
        return ""
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    parts = s.split("/")
    if len(parts) == 3:
        m, d, y = parts
        if len(y) == 2:
            y = "20" + y if int(y) < 50 else "19" + y
        try:
            return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
        except ValueError:
            return ""
    return ""


def _parse_bank_csv(raw: bytes, filename: str, base_index: int) -> list[dict]:
    """Tolerant parse of a bank or credit-card statement CSV."""
    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict] = []
    for row in reader:
        lc = {k.lower().strip(): (v or "").strip() for k, v in row.items() if k}
        date_str = _normalize_bank_date(
            lc.get("transaction date") or lc.get("trans date") or
            lc.get("posted date") or lc.get("post date") or
            lc.get("date") or ""
        )
        amt_raw = lc.get("amount") or lc.get("debit") or lc.get("credit") or ""
        amt_clean = "".join(c for c in amt_raw if c.isdigit() or c in ".-")
        try:
            amount = abs(float(amt_clean)) if amt_clean else 0.0
        except ValueError:
            amount = 0.0
        description = (
            lc.get("description") or lc.get("memo") or
            lc.get("detail") or lc.get("payee") or ""
        )
        bank_category = lc.get("category") or ""
        card_raw = lc.get("card no.") or lc.get("card number") or lc.get("card") or ""
        last4 = "".join(c for c in card_raw if c.isdigit())[-4:] if card_raw else ""
        if amount == 0 or not description:
            continue
        rows.append({
            "source_index": base_index + len(rows),
            "date": date_str,
            "amount": amount,
            "description": description,
            "bank_category": bank_category,
            "card_last4": last4,
            "source_file": filename,
        })
    return rows


def _extract_bank_expenses(
    rows: list[dict],
    card_lookup: dict[str, str],
    case_context: list[str],
) -> list[Expense]:
    """Single batched Claude call that filters bank/CC rows to the
    child-related transactions and categorizes them."""
    if not rows:
        return []
    if len(rows) > MAX_BANK_ROWS:
        raise ApiError(
            413,
            f"Too many bank-statement rows ({len(rows)}). Trim to "
            f"{MAX_BANK_ROWS} or fewer (or upload a shorter date range).",
        )
    user_content = (
        "\n".join(case_context)
        + "\n\nCard-lookup mapping (last-4 → parent): "
        + (json.dumps(card_lookup) if card_lookup else "(none provided)")
        + f"\n\nHere are {len(rows)} bank / credit-card transactions in JSON. "
        + "DROP rows that aren't clearly child-related — most won't be.\n\n"
        + json.dumps(rows, indent=2, default=str)
    )
    try:
        parsed = _structured_extract(
            ExpenseList,
            system_text=BANK_CSV_PROMPT,
            user_content=user_content,
            max_tokens=8000,
            use_thinking=False,
        )
    except anthropic.APIStatusError as e:
        raise ApiError(502, f"Claude API error ({e.status_code}): {e.message}")
    return list(parsed.expenses)


def _extract_receipts(
    files: list[tuple[bytes, str]],
    card_lookup: dict[str, str],
    case_context: list[str],
) -> list[Expense]:
    """Single batched Claude vision call across all uploaded receipts."""
    if not files:
        return []
    if len(files) > MAX_RECEIPTS:
        raise ApiError(
            413,
            f"Too many receipts in one request ({len(files)}). "
            f"Upload at most {MAX_RECEIPTS} at a time.",
        )
    content: list[dict] = [{
        "type": "text",
        "text": (
            "\n".join(case_context)
            + "\n\nCard-lookup mapping (last-4 → parent): "
            + (json.dumps(card_lookup) if card_lookup else "(none provided)")
            + f"\n\nReceipts follow ({len(files)} document"
            + ("s" if len(files) != 1 else "")
            + "), each labeled with its 0-based source_index:"
        ),
    }]
    for i, (raw, name) in enumerate(files):
        ext = "." + (name.rsplit(".", 1)[-1].lower() if "." in name else "")
        mime = _IMAGE_MIME.get(ext)
        b64 = base64.b64encode(raw).decode("ascii")
        if mime is not None:
            content.append({"type": "text", "text": f"\n[source_index {i}] {name}"})
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": mime, "data": b64},
            })
        elif ext in _PDF_EXTS:
            content.append({"type": "text", "text": f"\n[source_index {i}] {name}"})
            content.append({
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": b64,
                },
            })
        else:
            content.append({
                "type": "text",
                "text": f"\n[source_index {i}] {name} — unsupported format, skipped.",
            })
    try:
        parsed = _structured_extract(
            ExpenseList,
            system_text=RECEIPTS_PROMPT,
            user_content=content,
            max_tokens=8000,
            use_thinking=False,
        )
    except anthropic.APIStatusError as e:
        raise ApiError(502, f"Claude API error ({e.status_code}): {e.message}")
    return list(parsed.expenses)


def _extract_eob_expenses(
    files: list[tuple[bytes, str]],
    card_lookup: dict[str, str],
    case_context: list[str],
) -> list[Expense]:
    """Single batched Claude vision call across uploaded EOBs."""
    if not files:
        return []
    if len(files) > MAX_EOBS:
        raise ApiError(
            413,
            f"Too many EOBs in one request ({len(files)}). "
            f"Upload at most {MAX_EOBS} at a time.",
        )
    content: list[dict] = [{
        "type": "text",
        "text": (
            "\n".join(case_context)
            + "\n\nCard-lookup mapping (last-4 → parent): "
            + (json.dumps(card_lookup) if card_lookup else "(none provided)")
            + f"\n\nEOBs follow ({len(files)} document"
            + ("s" if len(files) != 1 else "")
            + "), each labeled with its 0-based source_index. Emit one "
            + "Expense per child-related service line:"
        ),
    }]
    for i, (raw, name) in enumerate(files):
        ext = "." + (name.rsplit(".", 1)[-1].lower() if "." in name else "")
        mime = _IMAGE_MIME.get(ext)
        b64 = base64.b64encode(raw).decode("ascii")
        if mime is not None:
            content.append({"type": "text", "text": f"\n[source_index {i}] {name}"})
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": mime, "data": b64},
            })
        elif ext in _PDF_EXTS:
            content.append({"type": "text", "text": f"\n[source_index {i}] {name}"})
            content.append({
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": b64,
                },
            })
        else:
            content.append({
                "type": "text",
                "text": f"\n[source_index {i}] {name} — unsupported format, skipped.",
            })
    try:
        parsed = _structured_extract(
            ExpenseList,
            system_text=EOB_PROMPT,
            user_content=content,
            max_tokens=8000,
            use_thinking=False,
        )
    except anthropic.APIStatusError as e:
        raise ApiError(502, f"Claude API error ({e.status_code}): {e.message}")
    return list(parsed.expenses)


def _extract_payment_expenses(
    rows: list[dict],
    card_lookup: dict[str, str],
    case_context: list[str],
) -> list[Expense]:
    """Single batched Claude call that categorizes payment-app rows."""
    if not rows:
        return []
    if len(rows) > MAX_CSV_ROWS:
        raise ApiError(
            413,
            f"Too many payment-app rows ({len(rows)}). Trim to {MAX_CSV_ROWS} or fewer.",
        )
    user_content = (
        "\n".join(case_context)
        + "\n\nCard-lookup mapping (last-4 → parent): "
        + (json.dumps(card_lookup) if card_lookup else "(none provided)")
        + f"\n\nHere are {len(rows)} payment-app transactions in JSON:\n\n"
        + json.dumps(rows, indent=2, default=str)
    )
    try:
        parsed = _structured_extract(
            ExpenseList,
            system_text=PAYMENT_CSV_PROMPT,
            user_content=user_content,
            max_tokens=8000,
            use_thinking=False,
        )
    except anthropic.APIStatusError as e:
        raise ApiError(502, f"Claude API error ({e.status_code}): {e.message}")
    return list(parsed.expenses)


def handle_custody(req: https_fn.Request) -> dict:
    form = req.form
    other_parent = (form.get("other_parent") or "").strip()
    if not other_parent:
        raise ApiError(422, "The other parent's name is required.")
    user_role = form.get("user_role") or "mother"

    # 1. Read and parse the upload(s) — in memory only, nothing persisted.
    messages = _collect_messages(req)
    messages = filter_by_date(
        messages,
        _parse_date(form.get("start_date"), "start_date"),
        _parse_date(form.get("end_date"), "end_date"),
    )
    contact = form.get("contact")
    if contact:
        messages = filter_by_contact(messages, contact)
    if not messages:
        raise ApiError(422, "No messages found for the selected filters.")

    stats = compute_stats(messages)

    # 2. Case context for the model (the system prompt stays static/cached).
    kids = [c.strip() for c in (form.get("children") or "").split(",") if c.strip()]
    context = [
        f"The user ('Me' in the transcript) is the children's {user_role}.",
        f"The other parent is named: {other_parent}.",
    ]
    if kids:
        context.append(f"The children are: {', '.join(kids)}.")

    # WV custody intake answers — tailor the extraction to the filer's case.
    profile: dict = {}
    raw_profile = form.get("case_profile")
    if raw_profile:
        try:
            parsed = json.loads(raw_profile)
            if isinstance(parsed, dict):
                profile = parsed
        except (json.JSONDecodeError, TypeError):
            profile = {}
    context += _case_profile_context(profile)

    # 3. Split into windows. A small history runs as a single pass; a larger
    #    one is analyzed window-by-window (concurrently) and merged.
    chunks = _split_into_chunks(messages, CHUNK_CHARS)
    if len(chunks) > MAX_CHUNKS:
        raise ApiError(
            413,
            f"This selection is very large ({len(messages):,} messages, "
            f"{len(chunks)} windows). Narrow the date range or scope to one "
            f"contact and try again.",
        )

    if len(chunks) == 1:
        # _extract_chunk returns CustodyExtraction (no expenses field);
        # promote it to CustodyReport so the financial extractors below can
        # attach their results.
        extraction = _extract_chunk(
            chunks[0], context, "This transcript covers the full requested history."
        )
        report = CustodyReport(**extraction.model_dump())
    else:
        def run_window(indexed_chunk: tuple[int, list]) -> CustodyExtraction:
            idx, chunk = indexed_chunk
            note = (
                f"This is time window {idx + 1} of {len(chunks)}, covering "
                f"{chunk[0].timestamp:%Y-%m-%d} to {chunk[-1].timestamp:%Y-%m-%d}. "
                f"Analyze only this window; results are merged with the others."
            )
            return _extract_chunk(chunk, context, note)

        with ThreadPoolExecutor(max_workers=CHUNK_CONCURRENCY) as pool:
            partials = list(pool.map(run_window, enumerate(chunks)))
        report = _combine_reports(partials)

    # 4. Financial extraction — child-related expenses from receipts and
    #    payment-app CSVs. Skipped entirely when no files were uploaded.
    cards = _parse_card_lookup(form.get("card_lookup"))
    fin_context = list(context) + [
        "When deciding `payer`, use the card-lookup above to resolve a "
        "card-last-4 to the parent. If no card or sender info is visible, "
        "set payer to 'unclear'.",
    ]
    # Read every uploaded file first, then run the four extractors
    # concurrently so the total wall-clock time is max(receipts, eobs,
    # payment, bank) instead of sum.
    receipt_payload: list[tuple[bytes, str]] = [
        (rf.read(), rf.filename or "")
        for rf in req.files.getlist("receipt_files")
    ]
    eob_payload: list[tuple[bytes, str]] = [
        (ef.read(), ef.filename or "")
        for ef in req.files.getlist("eob_files")
    ]
    csv_rows: list[dict] = []
    for pf in req.files.getlist("payment_files"):
        csv_rows.extend(
            _parse_payment_csv(pf.read(), pf.filename or "", len(csv_rows))
        )
    bank_rows: list[dict] = []
    for bf in req.files.getlist("bank_files"):
        bank_rows.extend(
            _parse_bank_csv(bf.read(), bf.filename or "", len(bank_rows))
        )

    if receipt_payload or eob_payload or csv_rows or bank_rows:
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {
                "receipt": pool.submit(_extract_receipts, receipt_payload, cards, fin_context),
                "eob": pool.submit(_extract_eob_expenses, eob_payload, cards, fin_context),
                "payment": pool.submit(_extract_payment_expenses, csv_rows, cards, fin_context),
                "bank": pool.submit(_extract_bank_expenses, bank_rows, cards, fin_context),
            }
            report.expenses = (
                list(futures["receipt"].result())
                + list(futures["eob"].result())
                + list(futures["payment"].result())
                + list(futures["bank"].result())
            )

    return {
        "meta": {
            "total_messages": stats["total_messages"],
            "conversation_count": stats["conversation_count"],
            "date_range": stats["date_range"],
            "windows": len(chunks),
            "other_parent": other_parent,
            "user_role": user_role,
            "children": kids,
            "transcript_truncated": len(messages) > TRANSCRIPT_CAP,
            "case_profile": profile,
            # Optional income context for the SCA-FC-106 worksheet; the
            # rest of that form is filled in by the user / attorney.
            "financial_inputs": _parse_financial_inputs(
                form.get("monthly_gross_income"),
            ),
            # Provenance — the settings used to produce this report.
            "model": MODEL,
            "jurisdiction": {
                "state": (form.get("state") or "").strip(),
                "county": (form.get("county") or "").strip(),
            },
            "contact": contact or None,
            "date_filter": {
                "start": form.get("start_date") or "",
                "end": form.get("end_date") or "",
            },
        },
        "custody_breakdown": _custody_breakdown(report.childcare_events),
        "report": report.model_dump(),
        "transcript": messages_to_records(messages[:TRANSCRIPT_CAP]),
    }


# --- HTTP plumbing ------------------------------------------------------------

# The frontend is hosted on a different origin (Vercel), so cross-origin
# requests need CORS. Auth is by bearer token, not cookies. Allow localhost
# dev plus this project's Vercel domains (production + preview deploys);
# override with ALLOWED_ORIGIN_REGEX if the project is renamed or a custom
# domain is used.
_DEFAULT_ORIGIN_REGEX = (
    r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
    r"|^https://cell-phone-data-parse(-[a-z0-9-]+)?\.vercel\.app$"
)
_ORIGIN_RE = re.compile(
    os.environ.get("ALLOWED_ORIGIN_REGEX", _DEFAULT_ORIGIN_REGEX)
)
_request_origin: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_origin", default=""
)


def _cors_headers() -> dict:
    """CORS headers — echoes the request's Origin if it matches the allow regex."""
    origin = _request_origin.get()
    allowed = origin if origin and _ORIGIN_RE.match(origin) else ""
    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "3600",
        "Vary": "Origin",
    }


def _json(data: dict, status: int = 200) -> https_fn.Response:
    return https_fn.Response(
        json.dumps(data),
        status=status,
        headers={"Content-Type": "application/json", **_cors_headers()},
    )


def _require_auth(req: https_fn.Request) -> None:
    """Reject the request unless it carries a valid Firebase ID token."""
    header = req.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise ApiError(401, "Sign-in required.")
    try:
        fb_auth.verify_id_token(header[len("Bearer "):])
    except Exception:
        raise ApiError(401, "Invalid or expired sign-in. Please sign in again.")


@https_fn.on_request(
    timeout_sec=900,
    memory=options.MemoryOption.GB_1,
    secrets=["ANTHROPIC_API_KEY"],
)
def api(req: https_fn.Request) -> https_fn.Response:
    """Single HTTPS entry point. Dispatches on the request path."""
    # Remember the request origin for the duration of this invocation so the
    # CORS-header builder can echo it back when it matches the allow regex.
    _request_origin.set(req.headers.get("Origin", ""))
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204, headers=_cors_headers())

    path = (req.path or "/").rstrip("/") or "/"
    try:
        if path in ("/", "/health"):
            return _json({"status": "ok", "model": MODEL})

        # Every analysis route requires a signed-in user.
        _require_auth(req)

        if path == "/contacts" and req.method == "POST":
            return _json({"contacts": list_conversations(_collect_messages(req))})
        if path == "/summarize" and req.method == "POST":
            return _json(handle_summarize(req))
        if path == "/custody-report" and req.method == "POST":
            return _json(handle_custody(req))

        return _json({"detail": f"No route for {req.method} {path}."}, 404)
    except ApiError as e:
        return _json({"detail": e.message}, e.status)
    except Exception as e:  # pragma: no cover - last-resort guard
        return _json({"detail": f"Internal error: {e}"}, 500)
