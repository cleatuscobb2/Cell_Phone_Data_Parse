"""Parse a Google Messages JSON export into an LLM-ready condensed string.

Google Messages has no single official JSON schema, so this parser is
deliberately tolerant: it accepts the common community/Takeout shapes and
normalizes them into a flat list of messages. It runs standalone as a CLI
or is imported by the backend (`from parser import ...`).

CLI:
    python parser.py export.json
    python parser.py export.json --start 2024-01-01 --end 2024-03-31 -o out.txt
"""

from __future__ import annotations

import argparse
import email
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from email import policy
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from typing import Any


@dataclass
class Message:
    timestamp: datetime
    sender: str
    body: str
    conversation: str
    from_me: bool
    channel: str = "text"  # "text" or "email"
    attachments: list[str] = field(default_factory=list)


# Candidate key names across the export variants we accept. Lookup is
# case- and punctuation-insensitive (see _first), so these are written in
# normalized form: lowercase with underscores. "message_date" etc. cover
# iMazing / SMS-export CSV headers like "Message Date".
_BODY_KEYS = (
    "body", "text", "message", "content", "snippet",
    "message_body", "text_body", "sms",
)
_SENDER_KEYS = (
    "sender", "from", "author", "name", "contact_name",
    # "sender_name" before "sender_id": iMazing carries both, and the
    # contact's name reads far better in reports than the raw number.
    "sender_name", "sender_id", "from_number", "phone_number",
)
# Thread identifiers — the other party, stable across both directions. "name"
# is excluded here: at message level it usually denotes the sender, not the
# thread, so it would mis-bucket outgoing messages.
_CONVO_KEYS = (
    "conversation", "thread", "title", "with", "address", "contact",
    "chat_session", "conversation_title", "thread_id",
)
_TIME_KEYS = (
    "timestamp", "date", "time", "date_sent", "sent_at", "datetime",
    "message_date", "readable_date", "sent_date", "received_date",
    "created_at",
)


def _norm_key(k: Any) -> str:
    """Normalize a column/key name for tolerant matching: real exports use
    'Message Date', 'Body', 'Sender ID', etc."""
    return str(k).strip().lower().replace(" ", "_").replace("-", "_")


def _first(d: dict, keys: tuple[str, ...]) -> Any:
    # Exact match first (cheap, preserves old behavior), then normalized.
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    normalized = {_norm_key(k): v for k, v in d.items()}
    for k in keys:
        v = normalized.get(k)
        if v not in (None, ""):
            return v
    return None


def sample_columns(data: Any, limit: int = 12) -> str:
    """The column/key names of the first message-like row — used to build
    an actionable error when a file parses to zero messages."""
    row: Any = None
    if isinstance(data, dict):
        convos = data.get("conversations")
        if isinstance(convos, list) and convos and isinstance(convos[0], dict):
            msgs = convos[0].get("messages")
            if isinstance(msgs, list) and msgs:
                row = msgs[0]
        elif isinstance(data.get("messages"), list) and data["messages"]:
            row = data["messages"][0]
    elif isinstance(data, list) and data:
        row = data[0]
    if not isinstance(row, dict):
        return ""
    return ", ".join(list(map(str, row.keys()))[:limit])


def _parse_timestamp(value: Any) -> datetime | None:
    """Accept epoch seconds/millis or assorted ISO/text date strings."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        # Values past ~year 2001 in ms are >1e11; treat those as milliseconds.
        seconds = value / 1000 if value > 1e11 else value
        try:
            return datetime.fromtimestamp(seconds)
        except (OSError, ValueError, OverflowError):
            return None
    if isinstance(value, str):
        v = value.strip()
        if v.isdigit():
            return _parse_timestamp(int(v))
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            pass
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%m/%d/%Y %H:%M:%S",
                    "%m/%d/%Y %H:%M", "%b %d, %Y %I:%M:%S %p", "%Y-%m-%d",
                    # 12-hour clocks — common in iMazing / phone-tool CSVs.
                    "%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %I:%M %p",
                    "%m/%d/%y %I:%M %p", "%m/%d/%y %H:%M",
                    "%b %d, %Y %I:%M %p", "%d %b %Y %H:%M:%S"):
            try:
                return datetime.strptime(v, fmt)
            except ValueError:
                continue
    return None


def _is_from_me(raw: dict) -> bool:
    """Detect outgoing messages across the differing conventions."""
    for key in ("is_from_me", "from_me", "outgoing"):
        if isinstance(raw.get(key), bool):
            return raw[key]
    msg_type = _first(raw, ("type",))
    if isinstance(msg_type, str):
        msg_type = msg_type.strip().lower()
    if msg_type in (2, "2", "sent", "outgoing", "message_status_outgoing"):
        return True
    if msg_type in (1, "1", "received", "inbox", "incoming"):
        return False
    direction = str(_first(raw, ("direction",)) or "").lower()
    return direction in ("out", "outgoing", "sent")


def _normalize_message(raw: dict, conversation: str) -> Message | None:
    body = _first(raw, _BODY_KEYS)
    ts = _parse_timestamp(_first(raw, _TIME_KEYS))
    if not body or ts is None:
        return None  # MMS attachments / system rows without text or time
    from_me = _is_from_me(raw)
    sender = "Me" if from_me else (str(_first(raw, _SENDER_KEYS) or conversation or "Unknown"))
    # Without a thread identifier, fall back to a single shared bucket rather
    # than the sender — keying on sender would split each direction apart.
    if not conversation:
        conversation = sender if not from_me else "Message History"
    # Drop tzinfo so naive and aware exports can be compared/sorted uniformly.
    return Message(
        timestamp=ts.replace(tzinfo=None),
        sender=sender,
        body=str(body).replace("\n", " ").strip(),
        conversation=conversation,
        from_me=from_me,
    )


def parse_export(data: Any) -> list[Message]:
    """Normalize a parsed JSON export into a flat, time-sorted message list.

    Accepts three shapes:
      1. {"conversations": [{"name"/"participants", "messages": [...]}]}
      2. {"messages": [...]}
      3. [ ...messages... ]
    """
    messages: list[Message] = []

    if isinstance(data, dict) and isinstance(data.get("conversations"), list):
        for convo in data["conversations"]:
            if not isinstance(convo, dict):
                continue
            participants = convo.get("participants")
            if isinstance(participants, list) and participants:
                name = ", ".join(str(p) for p in participants)
            else:
                name = str(_first(convo, _CONVO_KEYS) or "Unknown")
            for raw in convo.get("messages", []):
                if isinstance(raw, dict):
                    m = _normalize_message(raw, name)
                    if m:
                        messages.append(m)
    else:
        rows = data.get("messages") if isinstance(data, dict) else data
        if not isinstance(rows, list):
            raise ValueError("Unrecognized export structure: expected a list of "
                              "messages or a 'conversations'/'messages' key.")
        for raw in rows:
            if isinstance(raw, dict):
                m = _normalize_message(raw, str(_first(raw, _CONVO_KEYS) or ""))
                if m:
                    messages.append(m)

    messages.sort(key=lambda m: m.timestamp)
    return messages


def filter_by_date(messages: list[Message], start: date | None,
                   end: date | None) -> list[Message]:
    return [
        m for m in messages
        if (start is None or m.timestamp.date() >= start)
        and (end is None or m.timestamp.date() <= end)
    ]


def _render_line(m: Message) -> str:
    """One transcript line. Emails are tagged and list any attachments."""
    tag = "(email) " if m.channel == "email" else ""
    line = f"[{m.timestamp:%Y-%m-%d %H:%M}] {tag}{m.sender}: {m.body}"
    if m.attachments:
        line += f"  [attachments: {', '.join(m.attachments)}]"
    return line


def to_condensed_string(messages: list[Message]) -> str:
    """Render messages for the LLM — compact, preserving who-said-what-when.

    When the set mixes text messages and emails, render one chronological
    stream so the model can build a joint story across the two channels.
    With a single channel, group by conversation.
    """
    mixed = len({m.channel for m in messages}) > 1
    if mixed:
        ordered = sorted(messages, key=lambda x: x.timestamp)
        return "\n".join(_render_line(m) for m in ordered)

    by_convo: dict[str, list[Message]] = defaultdict(list)
    for m in messages:
        by_convo[m.conversation].append(m)

    blocks: list[str] = []
    for convo, msgs in sorted(by_convo.items()):
        lines = [f"=== Conversation: {convo} ({len(msgs)} messages) ==="]
        lines += [_render_line(m) for m in msgs]
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def compute_stats(messages: list[Message]) -> dict:
    """Deterministic counts the frontend charts directly (no LLM involved)."""
    if not messages:
        return {"total_messages": 0, "date_range": None,
                "conversation_count": 0, "top_contacts": [], "volume": []}

    convo_counts = Counter(m.conversation for m in messages)
    daily = Counter(m.timestamp.strftime("%Y-%m-%d") for m in messages)

    return {
        "total_messages": len(messages),
        "date_range": [
            messages[0].timestamp.strftime("%Y-%m-%d"),
            messages[-1].timestamp.strftime("%Y-%m-%d"),
        ],
        "conversation_count": len(convo_counts),
        "top_contacts": [
            {"name": name, "count": count}
            for name, count in convo_counts.most_common(10)
        ],
        "volume": [
            {"date": day, "count": daily[day]} for day in sorted(daily)
        ],
    }


def list_conversations(messages: list[Message]) -> list[dict]:
    """Roster of conversations for the contact selector — name, message
    count, and date span — ordered by volume."""
    by_convo: dict[str, list[Message]] = defaultdict(list)
    for m in messages:
        by_convo[m.conversation].append(m)
    roster = [
        {
            "name": name,
            "count": len(msgs),
            "first_date": msgs[0].timestamp.strftime("%Y-%m-%d"),
            "last_date": msgs[-1].timestamp.strftime("%Y-%m-%d"),
        }
        for name, msgs in by_convo.items()
    ]
    roster.sort(key=lambda c: c["count"], reverse=True)
    return roster


def filter_by_contact(messages: list[Message], contact: str) -> list[Message]:
    """Keep only messages in the conversation with the given contact."""
    return [m for m in messages if m.conversation == contact]


def search_messages(messages: list[Message], terms: list[str]) -> list[Message]:
    """Messages whose body contains ANY of the search terms (case-insensitive).

    With no terms, returns the input unchanged.
    """
    needles = [t.lower().strip() for t in terms if t.strip()]
    if not needles:
        return list(messages)
    return [m for m in messages if any(n in m.body.lower() for n in needles)]


def with_context(messages: list[Message], matched: list[Message],
                  window: int = 2) -> list[Message]:
    """Expand matched messages to include `window` neighbors on each side
    within the same conversation.

    A search hit alone loses the surrounding exchange — the reply to
    "dinner Friday?" may not itself contain "dinner". Feeding the model the
    neighboring messages gives it the context needed for an accurate summary.
    """
    if window <= 0 or not matched:
        return list(matched)
    matched_ids = {id(m) for m in matched}
    keep: set[int] = set()
    by_convo: dict[str, list[Message]] = defaultdict(list)
    for m in messages:
        by_convo[m.conversation].append(m)
    for msgs in by_convo.values():
        for i, m in enumerate(msgs):
            if id(m) in matched_ids:
                for j in range(max(0, i - window), min(len(msgs), i + window + 1)):
                    keep.add(id(msgs[j]))
    return [m for m in messages if id(m) in keep]


def messages_to_records(messages: list[Message]) -> list[dict]:
    """Plain dicts for returning matched messages to the UI breakdown."""
    return [
        {
            "timestamp": m.timestamp.strftime("%Y-%m-%d %H:%M"),
            "sender": m.sender,
            "body": m.body,
            "conversation": m.conversation,
            "channel": m.channel,
        }
        for m in messages
    ]


# --- Email parsing ------------------------------------------------------------

_REPLY_MARKERS = (
    "\n-----Original Message-----",
    "\n________________________________",
)


def _clean_email_body(text: str) -> str:
    """Strip quoted reply history, collapse whitespace, and cap the length."""
    if not text:
        return ""
    cut = len(text)
    for marker in _REPLY_MARKERS:
        i = text.find(marker)
        if i != -1:
            cut = min(cut, i)
    m = re.search(r"\nOn .{0,200}? wrote:", text, re.DOTALL)
    if m:
        cut = min(cut, m.start())
    text = text[:cut]
    lines = [ln.strip() for ln in text.splitlines() if not ln.lstrip().startswith(">")]
    return " ".join(ln for ln in lines if ln)[:800]


def _split_mbox(text: str) -> list[str]:
    """Split an mbox file into individual raw messages."""
    chunks = re.split(r"(?m)^From .*$\n?", text)
    return [c for c in chunks if c.strip()]


def _email_to_message(msg, user_email: str) -> Message | None:
    """Convert a parsed email into a Message (channel='email')."""
    date_hdr = msg.get("Date")
    if not date_hdr:
        return None
    try:
        ts = parsedate_to_datetime(str(date_hdr))
    except (TypeError, ValueError, IndexError):
        return None
    if ts is None:
        return None

    from_name, from_addr = parseaddr(str(msg.get("From", "")))
    from_addr = from_addr.lower()
    from_me = bool(user_email) and from_addr == user_email

    body_text = ""
    try:
        part = msg.get_body(preferencelist=("plain", "html"))
        if part is not None:
            content = str(part.get_content())
            if part.get_content_type() == "text/html":
                content = re.sub(r"<[^>]+>", " ", content)
            body_text = _clean_email_body(content)
    except Exception:
        body_text = ""

    subject = str(msg.get("Subject", "")).strip()
    body = f"{subject} — {body_text}" if (subject and body_text) else (subject or body_text)
    if not body:
        return None

    attachments: list[str] = []
    try:
        for att in msg.iter_attachments():
            fn = att.get_filename()
            if fn:
                attachments.append(str(fn))
    except Exception:
        pass

    if from_me:
        sender = "Me"
        to_addrs = getaddresses([str(h) for h in (msg.get_all("To") or [])])
        conversation = next((n or a for n, a in to_addrs if (n or a)), "") or "Email"
    else:
        sender = from_name or from_addr or "Unknown sender"
        conversation = sender

    return Message(
        timestamp=ts.replace(tzinfo=None),
        sender=sender,
        body=body.replace("\n", " ").strip(),
        conversation=conversation,
        from_me=from_me,
        channel="email",
        attachments=attachments,
    )


def parse_emails(raw: bytes, filename: str, user_email: str | None = None) -> list[Message]:
    """Parse an .eml (single) or .mbox (bulk) email upload into Messages."""
    name = (filename or "").lower()
    user_email = (user_email or "").strip().lower()
    messages: list[Message] = []

    if name.endswith(".mbox"):
        text = raw.decode("utf-8", errors="replace")
        for chunk in _split_mbox(text):
            try:
                msg = email.message_from_string(chunk, policy=policy.default)
            except Exception:
                continue
            m = _email_to_message(msg, user_email)
            if m:
                messages.append(m)
    else:
        # .eml, or a single raw RFC-822 message
        try:
            msg = email.message_from_bytes(raw, policy=policy.default)
            m = _email_to_message(msg, user_email)
            if m:
                messages.append(m)
        except Exception:
            pass

    messages.sort(key=lambda m: m.timestamp)
    return messages


def _parse_cli_date(value: str | None) -> date | None:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Condense a Google Messages JSON export.")
    ap.add_argument("input", help="Path to the JSON export file")
    ap.add_argument("--start", help="Earliest date to include (YYYY-MM-DD)")
    ap.add_argument("--end", help="Latest date to include (YYYY-MM-DD)")
    ap.add_argument("-o", "--output", help="Write to this file instead of stdout")
    args = ap.parse_args(argv)

    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)

    messages = filter_by_date(
        parse_export(data), _parse_cli_date(args.start), _parse_cli_date(args.end)
    )
    if not messages:
        print("No messages matched the given range.", file=sys.stderr)
        return 1

    condensed = to_condensed_string(messages)
    stats = compute_stats(messages)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(condensed)
        print(f"Wrote {stats['total_messages']} messages to {args.output}",
              file=sys.stderr)
    else:
        print(condensed)

    print(f"\n[{stats['total_messages']} messages across "
          f"{stats['conversation_count']} conversations]", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
