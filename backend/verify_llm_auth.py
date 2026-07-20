"""Verify the configured LLM auth can make a real call — run this BEFORE a
long custody report so you learn in seconds (not minutes) whether the auth
works and has usable balance.

    cd backend
    .venv/Scripts/python.exe verify_llm_auth.py      # Windows
    .venv/bin/python verify_llm_auth.py              # macOS / Linux
"""

from __future__ import annotations

import os
from pathlib import Path

import anthropic
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"), override=True)

MODEL = "claude-opus-4-8"


def main() -> int:
    tok = os.getenv("ANTHROPIC_AUTH_TOKEN")
    key = os.getenv("ANTHROPIC_API_KEY")

    if tok:
        print(f"Auth: ANTHROPIC_AUTH_TOKEN (bearer), prefix {tok[:12]}…")
        client = anthropic.Anthropic(auth_token=tok)
    elif key:
        print(f"Auth: ANTHROPIC_API_KEY, prefix {key[:14]}… last4 …{key[-4:]}")
        client = anthropic.Anthropic()
    else:
        print("No ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY found in backend/.env")
        return 1

    print(f"Calling {MODEL} with a 1-token test…")
    try:
        r = client.messages.create(
            model=MODEL,
            max_tokens=16,
            messages=[{"role": "user", "content": "reply with the single word ok"}],
        )
        print(f"\n✅ SUCCESS — {MODEL} replied: {r.content[0].text.strip()!r}")
        print("This auth works. You can run the report locally.")
        return 0
    except anthropic.APIStatusError as e:
        msg = getattr(e, "message", str(e))
        print(f"\n❌ FAILED — HTTP {e.status_code}: {msg}")
        low = (msg or "").lower()
        if "credit balance" in low or "too low" in low:
            print(
                "\nThe account behind this credential is out of API credits.\n"
                "Add credits at https://console.anthropic.com → Billing, or\n"
                "switch to a different credential in backend/.env."
            )
        elif "claude code" in low or "oauth" in low or "not authorized" in low:
            print(
                "\nThis credential isn't accepted for direct Messages API calls\n"
                "(subscription tokens are gated to Claude Code). Use a standard\n"
                "API key in ANTHROPIC_API_KEY instead — a small credit top-up on\n"
                "console.anthropic.com covers a scoped vetting run."
            )
        return 1
    except Exception as e:  # noqa: BLE001
        print(f"\n❌ FAILED — {type(e).__name__}: {e}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
