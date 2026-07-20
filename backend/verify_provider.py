"""Verify a configured LLM provider can handle the custody app's ACTUAL call
pattern — streaming + forced tool_choice + a nested JSON schema — before you
switch the app over to it.

Point the app at an Anthropic-compatible endpoint (DeepSeek, Moonshot/Kimi,
etc.) via backend/.env:

    ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
    ANTHROPIC_API_KEY=<the provider's key>
    ANALYSIS_MODEL=<the provider's model id, e.g. deepseek-reasoner>

Then run:

    cd backend
    .venv/Scripts/python.exe verify_provider.py       # Windows
    # .venv/bin/python verify_provider.py             # macOS / Linux

It runs three escalating checks and tells you exactly what works, so you know
whether the app's structured extraction will run on this provider.
"""

from __future__ import annotations

import os
from pathlib import Path

import anthropic
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"), override=True)

MODEL = os.getenv("ANALYSIS_MODEL", "claude-opus-4-7")
BASE_URL = os.getenv("ANTHROPIC_BASE_URL", "(default Anthropic)")
IS_ANTHROPIC = "anthropic.com" in BASE_URL or BASE_URL == "(default Anthropic)"

# A small nested schema — the same *shape* the real extraction relies on.
SCHEMA = {
    "type": "object",
    "properties": {
        "overview": {"type": "string"},
        "events": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "date": {"type": "string"},
                    "who": {"type": "string"},
                    "note": {"type": "string"},
                },
            },
        },
    },
    "required": ["overview", "events"],
}

SAMPLE = (
    "The mother wrote: 'I picked up Emma from school on 2024-03-15 and took "
    "her to the dentist.' The father replied: 'ok'."
)


def _system_blocks(text: str) -> list[dict]:
    b: dict = {"type": "text", "text": text}
    if IS_ANTHROPIC:
        b["cache_control"] = {"type": "ephemeral"}
    return [b]


def main() -> int:
    key = os.getenv("ANTHROPIC_API_KEY")
    tok = os.getenv("ANTHROPIC_AUTH_TOKEN")
    print(f"Base URL : {BASE_URL}")
    print(f"Model    : {MODEL}")
    print(f"Auth     : {'AUTH_TOKEN' if tok else 'API_KEY'} "
          f"{'(' + (tok or key or '')[:12] + '…)' if (tok or key) else '(none!)'}")
    print(f"cache_control sent: {IS_ANTHROPIC}\n")
    if not (key or tok):
        print("No ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN in backend/.env")
        return 1

    client = (anthropic.Anthropic(auth_token=tok) if tok
              else anthropic.Anthropic())

    # 1) Plain call — connectivity + valid model id.
    print("[1/3] plain message …", end=" ", flush=True)
    try:
        r = client.messages.create(
            model=MODEL, max_tokens=64,
            messages=[{"role": "user", "content": "reply with the single word ok"}],
        )
        txt = "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
        print(f"OK ({txt.strip()[:20]!r})")
    except Exception as e:  # noqa: BLE001
        print("FAILED")
        print(f"      {type(e).__name__}: {str(e)[:240]}")
        print("\nThe provider rejected a basic call — check base URL, key, and "
              "model id. Nothing else can work until this passes.")
        return 1

    # 2) Forced tool_choice, non-streaming — the core of structured output.
    print("[2/3] forced tool-use (structured output) …", end=" ", flush=True)
    tool = [{"name": "submit", "description": "Submit the analysis.",
             "input_schema": SCHEMA}]
    try:
        r = client.messages.create(
            model=MODEL, max_tokens=1024,
            system=_system_blocks("Extract events into the submit tool."),
            messages=[{"role": "user", "content": SAMPLE}],
            tools=tool, tool_choice={"type": "tool", "name": "submit"},
        )
        tu = next((b for b in r.content
                   if getattr(b, "type", "") == "tool_use"), None)
        if tu is None:
            print("NO TOOL CALL")
            print("      The model answered in prose instead of calling the "
                  "tool. This provider/model can't do forced tool-use, which "
                  "the app's structured extraction requires.")
            return 2
        n = len((tu.input or {}).get("events", []))
        print(f"OK (parsed {n} event(s))")
    except Exception as e:  # noqa: BLE001
        print("FAILED")
        print(f"      {type(e).__name__}: {str(e)[:240]}")
        print("\nForced tool_choice isn't supported here. Reasoning models "
              "often reject it. Options: use a non-reasoning chat model that "
              "supports tools, or keep the current provider.")
        return 2

    # 3) Streaming + forced tool_choice — exactly what _structured_extract does.
    print("[3/3] streaming + forced tool-use …", end=" ", flush=True)
    try:
        with client.messages.stream(
            model=MODEL, max_tokens=1024,
            system=_system_blocks("Extract events into the submit tool."),
            messages=[{"role": "user", "content": SAMPLE}],
            tools=tool, tool_choice={"type": "tool", "name": "submit"},
        ) as stream:
            final = stream.get_final_message()
        tu = next((b for b in final.content
                   if getattr(b, "type", "") == "tool_use"), None)
        print("OK" if tu else "NO TOOL CALL")
        if tu is None:
            print("      Streaming path returned prose, not a tool call.")
            return 3
    except Exception as e:  # noqa: BLE001
        print("FAILED")
        print(f"      {type(e).__name__}: {str(e)[:240]}")
        print("\nStreaming tool-use failed though non-streaming worked. The "
              "app can be switched to non-streaming for this provider — tell "
              "me and I'll wire it.")
        return 3

    print("\n✅ All three checks passed. This provider can run the custody "
          "extraction. Set the same three env vars in production (Firebase "
          "functions config) to switch the deployed app too.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
