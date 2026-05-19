"""Local FastAPI proxy that summarizes a message history with the Claude API.

Why a backend at all, given the goal is "messages stay local"?
  - The Anthropic API key must never reach the browser. This proxy holds it.
  - The browser talks only to this process (run it on your own machine).
  - Uploaded files are parsed in memory and never written to disk or a DB.
    The only network egress is the summarization request to Anthropic.

Run:
    uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import os
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from typing import Literal

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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

# Load .env by absolute path so the key resolves regardless of the cwd
# uvicorn is launched from. override=True so the file wins over an empty or
# stale ANTHROPIC_API_KEY already present in the shell environment.
load_dotenv(Path(__file__).with_name(".env"), override=True)

MODEL = "claude-opus-4-7"
# Opus 4.7 has a 1M-token context window; leave headroom for the response.
MAX_INPUT_TOKENS = 900_000

client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment

app = FastAPI(title="Message History Summarizer")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


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


def _load_export(raw: bytes, filename: str) -> object:
    """Decode an upload into the structure parse_export() expects.

    CSV is read into a list of row dicts, which parse_export() already
    accepts (it matches column names like type/body/date case-insensitively).
    """
    text = raw.decode("utf-8-sig", errors="replace")
    if filename.lower().endswith(".csv"):
        return list(csv.DictReader(io.StringIO(text)))
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(422, f"File is not valid JSON: {e}")


def _parse_date(value: str | None, field: str) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(422, f"{field} must be YYYY-MM-DD, got: {value!r}")


def _parse_text_upload(raw: bytes, filename: str) -> list:
    """Parse a text-message export into Message objects (channel='text')."""
    try:
        return parse_export(_load_export(raw, filename))
    except ValueError as e:
        raise HTTPException(422, f"Text-message file: {e}")


def _parse_email_upload(raw: bytes, filename: str, user_email: str | None) -> list:
    """Parse an email upload into Message objects (channel='email').

    .eml/.mbox go through the email parser; a JSON/CSV email export falls
    back to the structured parser and is tagged as email.
    """
    name = (filename or "").lower()
    if name.endswith((".json", ".csv")):
        try:
            messages = parse_export(_load_export(raw, filename))
        except ValueError as e:
            raise HTTPException(422, f"Email file: {e}")
        for m in messages:
            m.channel = "email"
        return messages
    return parse_emails(raw, filename, user_email)


async def _collect_messages(
    file: UploadFile | None,
    email_file: UploadFile | None,
    user_email: str | None,
) -> list:
    """Read both uploads, parse each channel, and merge chronologically."""
    messages: list = []
    if file is not None:
        messages += _parse_text_upload(await file.read(), file.filename or "")
    if email_file is not None:
        messages += _parse_email_upload(
            await email_file.read(), email_file.filename or "", user_email
        )
    if not messages:
        raise HTTPException(
            422, "Upload a text-message export, an email file (.eml/.mbox), or both."
        )
    messages.sort(key=lambda m: m.timestamp)
    return messages


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": MODEL}


@app.post("/contacts")
async def contacts(
    file: UploadFile | None = File(None),
    email_file: UploadFile | None = File(None),
    user_email: str | None = Form(None),
) -> dict:
    """Parse-only (no Claude call): list the conversations across the
    uploaded text and/or email files so the UI can offer a contact selector."""
    messages = await _collect_messages(file, email_file, user_email)
    return {"contacts": list_conversations(messages)}


# Cap on how many matched messages are returned to the UI breakdown. The
# Claude summary still analyzes the full filtered set (within the token guard).
DISPLAY_CAP = 500

# Cap on the full transcript returned with a custody report (for the PDF
# appendix). Large enough for most cases; oversize histories should be
# narrowed by date range.
TRANSCRIPT_CAP = 2000

# Chunked custody analysis — a history too large for one pass is split into
# chronological windows, analyzed concurrently, then merged into one report.
CHUNK_CHARS = 300_000        # approx. transcript size per window (~135k tokens)
MAX_CHUNKS = 15              # refuse histories that would need more windows
CHUNK_CONCURRENCY = 4        # windows analyzed in parallel


@app.post("/summarize")
async def summarize(
    file: UploadFile | None = File(None),
    email_file: UploadFile | None = File(None),
    user_email: str | None = Form(None),
    start_date: str | None = Form(None),
    end_date: str | None = Form(None),
    contact: str | None = Form(None),
    search_terms: str | None = Form(None),
) -> dict:
    # 1. Read and parse the upload(s) — in memory only, nothing persisted.
    #    Text and email are merged into one chronological stream.
    messages = await _collect_messages(file, email_file, user_email)

    messages = filter_by_date(
        messages, _parse_date(start_date, "start_date"), _parse_date(end_date, "end_date")
    )
    if not messages:
        raise HTTPException(422, "No messages found in the file for the selected date range.")

    # 2. Narrow to a single contact, if requested.
    if contact:
        messages = filter_by_contact(messages, contact)
        if not messages:
            raise HTTPException(422, f"No messages found for contact {contact!r}.")

    # 3. Apply search terms — comma-separated, OR-matched on message body.
    terms = [t.strip() for t in (search_terms or "").split(",") if t.strip()]
    matched = search_messages(messages, terms)
    if terms and not matched:
        raise HTTPException(
            422, f"No messages matched the search terms: {', '.join(terms)}."
        )

    focused = bool(contact or terms)

    # The model reads the matches plus their neighbors for context; the UI
    # breakdown shows only the strict matches.
    transcript_messages = with_context(messages, matched, window=2) if terms else matched
    condensed = to_condensed_string(transcript_messages)
    stats = compute_stats(matched)

    # 4. Build the user turn. The system prompt stays static (cacheable);
    #    all per-request scope goes here, after the cached prefix.
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
    token_count = client.messages.count_tokens(
        model=MODEL,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    ).input_tokens
    if token_count > MAX_INPUT_TOKENS:
        raise HTTPException(
            413,
            f"The selected messages are too large ({token_count:,} tokens) for a "
            f"single request. Narrow the date range, contact, or search terms.",
        )

    # 6. Summarize. Structured output guarantees the response shape; the
    #    system prompt is cached so repeat requests are cheaper.
    try:
        response = client.messages.parse(
            model=MODEL,
            max_tokens=8000,
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
        raise HTTPException(502, f"Claude API error ({e.status_code}): {e.message}")

    if response.stop_reason == "max_tokens":
        raise HTTPException(
            413,
            "The summary output hit the size limit before completing. Narrow the "
            "date range, contact, or search terms and try again.",
        )
    summary = response.parsed_output
    if summary is None:
        raise HTTPException(502, "The model could not produce a structured summary.")

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
    # In focused mode, return the matched messages themselves as the breakdown.
    if focused:
        body["matched_messages"] = messages_to_records(matched[:DISPLAY_CAP])
        body["matched_truncated"] = len(matched) > DISPLAY_CAP
    return body


def _custody_breakdown(events: list[ChildcareEvent]) -> dict:
    """Derive custody-split counts and percentages directly from the cited
    childcare events — a transparent function of the evidence, not an LLM
    guess. Shared time is split half to each parent; unclear is excluded
    from the percentage."""
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
    """Split time-sorted messages into chronological windows whose condensed
    transcript stays roughly under max_chars."""
    chunks: list[list] = []
    current: list = []
    size = 0
    for m in messages:
        cost = len(m.body) + 45  # timestamp + sender + framing per rendered line
        if current and size + cost > max_chars:
            chunks.append(current)
            current, size = [], 0
        current.append(m)
        size += cost
    if current:
        chunks.append(current)
    return chunks


def _extract_chunk(chunk_messages: list, context_lines: list[str],
                   window_note: str) -> CustodyReport:
    """Run the custody extraction over one window. Synchronous — invoked via
    asyncio.to_thread so windows can be analyzed concurrently."""
    condensed = to_condensed_string(chunk_messages)
    user_content = "\n".join(context_lines) + (
        f"\n\n{window_note}\n\nHere is this portion of the transcript:\n\n{condensed}"
    )
    try:
        response = client.messages.parse(
            model=MODEL,
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
        raise HTTPException(502, f"Claude API error ({e.status_code}): {e.message}")
    if response.stop_reason == "max_tokens":
        raise HTTPException(
            413,
            "A time window produced too many events to extract. Narrow the date "
            "range and try again.",
        )
    report = response.parsed_output
    if report is None:
        raise HTTPException(502, "The model could not analyze one of the time windows.")
    return report


def _combine_reports(partials: list[CustodyReport]) -> CustodyReport:
    """Merge windowed reports: concatenate the event lists, then re-synthesize
    the narrative across all windows with a final reduce call. Synchronous —
    invoked via asyncio.to_thread."""
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
        response = client.messages.parse(
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
    except anthropic.APIStatusError:
        narrative = None

    if narrative is None:
        # Reduce failed — fall back to concatenating the window narratives.
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


@app.post("/custody-report")
async def custody_report(
    file: UploadFile | None = File(None),
    email_file: UploadFile | None = File(None),
    user_email: str | None = Form(None),
    other_parent: str = Form(...),
    user_role: str = Form("mother"),
    children: str | None = Form(None),
    contact: str | None = Form(None),
    start_date: str | None = Form(None),
    end_date: str | None = Form(None),
) -> dict:
    """Extract a dated, source-quoted custody-relevant event log from a
    message history. The model EXTRACTS — the cited messages are the
    evidence; this is an organizational aid, not legal advice."""
    if not other_parent.strip():
        raise HTTPException(422, "The other parent's name is required.")

    # 1. Read and parse the upload(s) — in memory only, nothing persisted.
    #    Text and email are merged into one chronological stream.
    messages = await _collect_messages(file, email_file, user_email)

    messages = filter_by_date(
        messages, _parse_date(start_date, "start_date"), _parse_date(end_date, "end_date")
    )
    if contact:
        messages = filter_by_contact(messages, contact)
    if not messages:
        raise HTTPException(422, "No messages found for the selected filters.")

    stats = compute_stats(messages)

    # 2. Case context for the model (the system prompt stays static/cached).
    kids = [c.strip() for c in (children or "").split(",") if c.strip()]
    context = [
        f"The user ('Me' in the transcript) is the children's {user_role}.",
        f"The other parent is named: {other_parent}.",
    ]
    if kids:
        context.append(f"The children are: {', '.join(kids)}.")

    # 3. Split into windows. A small history runs as a single pass; a larger
    #    one is analyzed window-by-window (concurrently) and merged.
    chunks = _split_into_chunks(messages, CHUNK_CHARS)
    if len(chunks) > MAX_CHUNKS:
        raise HTTPException(
            413,
            f"This selection is very large ({len(messages):,} messages, "
            f"{len(chunks)} windows). Narrow the date range or scope to one "
            f"contact and try again.",
        )

    if len(chunks) == 1:
        report = await asyncio.to_thread(
            _extract_chunk,
            chunks[0],
            context,
            "This transcript covers the full requested history.",
        )
    else:
        sem = asyncio.Semaphore(CHUNK_CONCURRENCY)

        async def run_window(idx: int, chunk: list) -> CustodyReport:
            note = (
                f"This is time window {idx + 1} of {len(chunks)}, covering "
                f"{chunk[0].timestamp:%Y-%m-%d} to {chunk[-1].timestamp:%Y-%m-%d}. "
                f"Analyze only this window; results are merged with the others."
            )
            async with sem:
                return await asyncio.to_thread(_extract_chunk, chunk, context, note)

        partials = await asyncio.gather(
            *(run_window(i, ch) for i, ch in enumerate(chunks))
        )
        report = await asyncio.to_thread(_combine_reports, list(partials))

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
        },
        # Counts derived deterministically from the cited events, not the LLM.
        "custody_breakdown": _custody_breakdown(report.childcare_events),
        "report": report.model_dump(),
        # The full chronological message log, for the PDF appendix.
        "transcript": messages_to_records(messages[:TRANSCRIPT_CAP]),
    }
