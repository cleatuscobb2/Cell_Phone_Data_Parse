"""Cheap relevance filter (Phase 2) — narrow a large message set down to the
custody-relevant slice before the expensive extraction runs, so cost scales
with relevant volume, not total volume.

Pure helpers live here; the LLM classification orchestration lives in main.py
(which holds the Anthropic client). Recall-biased by design: in a custody
matter a dropped relevant message is lost evidence, so the classifier is told
to over-include, the full message log is always kept in the report appendix,
and a sample of dropped messages is surfaced for audit.
"""

from __future__ import annotations

import re

# How many messages the cheap classifier judges per call. Its output is tiny
# (a list of numbers), so large chunks keep the call count and cost down.
CLASSIFY_CHUNK_SIZE = 400

# Include this many neighbours on each side of a flagged message, so a bare
# "yes ok" reply carries the exchange it belongs to into the extraction.
CONTEXT_RADIUS = 2

# Senders/threads that are unambiguously automated — safe to drop for free
# before paying to classify them. Conservative on purpose (never human 2-way).
_AUTOMATED_RE = re.compile(
    r"no[-_.]?reply|do[-_.]?not[-_.]?reply|newsletter|notification|mailer|"
    r"alerts?@|updates?@|noreply|donotreply|postmaster|automated|receipts?@|"
    r"billing@|marketing@|no\.?reply",
    re.I,
)


def prefilter(messages: list) -> tuple[list, list]:
    """Tier 0: drop exact-duplicate messages and clearly-automated senders.
    Returns (kept, dropped). Safe — never drops human two-way traffic; it only
    removes noise the classifier would otherwise be paid to read."""
    kept: list = []
    dropped: list = []
    seen: set = set()
    for m in messages:
        sig = (m.sender, m.body, str(m.timestamp)[:16])
        if sig in seen:
            dropped.append(m)
            continue
        seen.add(sig)
        if not m.from_me and _AUTOMATED_RE.search(f"{m.sender} {m.conversation}"):
            dropped.append(m)
            continue
        kept.append(m)
    return kept, dropped


def chunk_messages(messages: list, size: int = CLASSIFY_CHUNK_SIZE):
    """Yield (global_start_index, chunk) tuples over the message list."""
    for i in range(0, len(messages), size):
        yield i, messages[i:i + size]


def build_classify_content(chunk: list, children: list[str],
                           other_parent: str | None) -> str:
    """The user turn for one classify call: a numbered list of messages."""
    kids = ", ".join(children) if children else "the children"
    lines = [
        f"Children: {kids}. Other parent: {other_parent or 'the other parent'}.",
        "",
        "Messages (return the numbers of the custody-relevant ones):",
    ]
    for i, m in enumerate(chunk, 1):
        body = (m.body or "").replace("\n", " ").strip()[:300]
        lines.append(f"[{i}] {m.timestamp:%Y-%m-%d} {m.sender}: {body}")
    return "\n".join(lines)


def expand_context(total: int, relevant_idx: set[int],
                   radius: int = CONTEXT_RADIUS) -> list[int]:
    """Grow a set of relevant indices to include their neighbours, returned
    sorted. `total` is the length of the list the indices point into."""
    out: set[int] = set()
    for i in relevant_idx:
        for j in range(max(0, i - radius), min(total, i + radius + 1)):
            out.add(j)
    return sorted(out)


def even_sample(items: list, n: int = 20) -> list:
    """An evenly-spaced sample of up to n items (deterministic — no RNG)."""
    if not items or n <= 0:
        return []
    if len(items) <= n:
        return list(items)
    step = len(items) / n
    return [items[int(k * step)] for k in range(n)]


RELEVANCE_PROMPT = """You are triaging a parent's message history for a child-\
custody matter. You are given a numbered list of messages. Return the numbers \
of the ones that are RELEVANT to custody or co-parenting.

A message is RELEVANT if it relates in ANY way to:
- the children — their care, whereabouts, health, school, activities, wellbeing
- parenting logistics — pickup, drop-off, visits, schedules, overnights, holidays
- missed, cancelled, changed, or refused parenting time
- a parent handling a child-rearing responsibility (medical, dental, school, \
activities, transport, religious, expenses)
- child expenses or child support
- someone else (relative, teacher, doctor) commenting on either parent's caregiving
- the tone or conflict between the parents regarding the children

Be INCLUSIVE. When in doubt, mark it relevant — a missed relevant message is \
lost evidence, while an extra one costs almost nothing to review downstream. \
Only leave out messages clearly unrelated to the children or co-parenting \
(spam, newsletters, receipts, work, purely adult social chatter, logistics \
with no connection to the kids).

Call flag_relevant with the list of relevant message numbers."""

FLAG_TOOL = {
    "name": "flag_relevant",
    "description": "Report which message numbers are custody-relevant.",
    "input_schema": {
        "type": "object",
        "properties": {
            "relevant": {
                "type": "array",
                "items": {"type": "integer"},
                "description": "The numbers of the custody-relevant messages.",
            }
        },
        "required": ["relevant"],
    },
}
