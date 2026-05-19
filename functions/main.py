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

import csv
import io
import json
import os
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

class ChildcareEvent(BaseModel):
    date: str
    parent: Literal["mother", "father", "shared", "unclear"]
    description: str
    quote: str
    sender: str
    channel: Literal["text", "email", "unclear"]  # source of the cited message


class MissedVisit(BaseModel):
    date: str
    kind: Literal[
        "cancellation", "no_show", "reschedule_request", "late",
        "declined_time", "other",
    ]
    description: str
    quote: str
    sender: str
    channel: Literal["text", "email", "unclear"]


class CommunicationGap(BaseModel):
    start_date: str
    end_date: str
    days: int
    description: str


class ResponsibilityEvent(BaseModel):
    date: str
    # Court-recognized parenting-responsibility categories.
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
    subcategory: str  # specific item, e.g. "Tuition", "Sports — game", "Camp"
    responsible_party: Literal["mother", "father", "shared", "unclear"]
    description: str
    quote: str
    sender: str
    channel: Literal["text", "email", "unclear"]


class ThirdPartyStatement(BaseModel):
    date: str
    source: str  # who made the statement
    description: str
    quote: str
    channel: Literal["text", "email", "unclear"]  # text message or email


class Suggestion(BaseModel):
    category: Literal[
        "attachment",
        "key_statement",
        "evidence_to_gather",
        "follow_up",
        "other",
    ]
    suggestion: str
    related_date: str  # the date it relates to, or "" if none


class CustodyReport(BaseModel):
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


class CustodyNarrative(BaseModel):
    """The narrative-only fields, re-synthesized when windowed reports merge."""
    overview: str
    breakdown_basis: str
    sentiment_overview: str
    limitations: list[str]


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
    """Read both uploads from the request, parse each channel, merge by time."""
    messages: list = []
    text_file = req.files.get("file")
    email_file = req.files.get("email_file")
    user_email = req.form.get("user_email")
    if text_file is not None:
        messages += _parse_text_upload(text_file.read(), text_file.filename or "")
    if email_file is not None:
        messages += _parse_email_upload(
            email_file.read(), email_file.filename or "", user_email
        )
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
MAX_MESSAGES_PER_WINDOW = 80   # max messages per window (bounds output size)
MAX_CHUNKS = 20                # refuse histories that would need more windows
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
        response = client().messages.parse(
            model=MODEL,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            system=[{
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": user_content}],
            output_format=ConversationSummary,
        )
    except anthropic.APIStatusError as e:
        raise ApiError(502, f"Claude API error ({e.status_code}): {e.message}")
    except ValidationError:
        raise ApiError(
            413,
            "The summary output was too large to complete. Narrow the date "
            "range, contact, or search terms and try again.",
        )

    if response.stop_reason == "max_tokens":
        raise ApiError(
            413,
            "The summary output hit the size limit before completing. Narrow the "
            "date range, contact, or search terms and try again.",
        )
    summary = response.parsed_output
    if summary is None:
        raise ApiError(502, "The model could not produce a structured summary.")

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


def _extract_chunk(chunk_messages: list, context_lines: list[str],
                   window_note: str) -> CustodyReport:
    """Run the custody extraction over one window."""
    condensed = to_condensed_string(chunk_messages)
    user_content = "\n".join(context_lines) + (
        f"\n\n{window_note}\n\nHere is this portion of the transcript:\n\n{condensed}"
    )
    try:
        response = client().messages.parse(
            model=MODEL,
            # 16000 is the most a non-streaming request may request from this
            # SDK; windowing (below) keeps each window's output well under it.
            max_tokens=16000,
            thinking={"type": "adaptive"},
            system=[{
                "type": "text",
                "text": CUSTODY_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": user_content}],
            output_format=CustodyReport,
        )
    except anthropic.APIStatusError as e:
        raise ApiError(502, f"Claude API error ({e.status_code}): {e.message}")
    except ValidationError:
        # The structured output was cut off before its JSON closed — this
        # window held more events than fit in one response.
        raise ApiError(
            413,
            "A time window produced more events than fit in one response. "
            "Narrow the date range and try again.",
        )
    if response.stop_reason == "max_tokens":
        raise ApiError(
            413,
            "A time window produced too many events to extract. Narrow the date "
            "range and try again.",
        )
    report = response.parsed_output
    if report is None:
        raise ApiError(502, "The model could not analyze one of the time windows.")
    return report


def _combine_reports(partials: list[CustodyReport]) -> CustodyReport:
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
        response = client().messages.parse(
            model=MODEL,
            max_tokens=4000,
            thinking={"type": "adaptive"},
            system=[{
                "type": "text",
                "text": REDUCE_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": f"{window_summaries}\n\n{totals}"}],
            output_format=CustodyNarrative,
        )
        if response.stop_reason != "max_tokens":
            narrative = response.parsed_output
    except (anthropic.APIStatusError, ValidationError):
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
        report = _extract_chunk(
            chunks[0], context, "This transcript covers the full requested history."
        )
    else:
        def run_window(indexed_chunk: tuple[int, list]) -> CustodyReport:
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
# requests need CORS. Auth is by bearer token, not cookies, so a permissive
# origin is acceptable; tighten ALLOWED_ORIGIN if you want to lock it down.
_ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")


def _cors_headers() -> dict:
    return {
        "Access-Control-Allow-Origin": _ALLOWED_ORIGIN,
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
