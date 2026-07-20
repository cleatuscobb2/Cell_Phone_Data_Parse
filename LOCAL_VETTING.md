# Running a report locally (for vetting)

Run the whole app on your own machine — nothing leaves it except the calls to
the Anthropic API. Good for reviewing a report before relying on it, or
iterating quickly.

## Prerequisites (one time)

- Python venv already set up in `backend/.venv`
- Frontend deps already installed (`frontend/node_modules`)
- `backend/.env` with a working Anthropic credential (see **Auth** below)

## 1. Confirm your Anthropic auth works — before anything else

A full report is many API calls and several minutes. Check the credential
first, in seconds:

```bash
cd backend
.venv/Scripts/python.exe verify_llm_auth.py      # Windows
# .venv/bin/python verify_llm_auth.py            # macOS / Linux
```

- ✅ **SUCCESS** → your credential works; continue.
- ❌ **credit balance too low** → add credits at
  <https://console.anthropic.com> → Billing (this is the *API* account, a
  separate balance from any Claude.ai / Max subscription).

### Auth options in `backend/.env`

- `ANTHROPIC_API_KEY=sk-ant-api03-…` — the standard path; bills your API
  account's credit balance. A small top-up ($5–10) covers a scoped run.
- `ANTHROPIC_AUTH_TOKEN=…` — alternative: sends a bearer token instead of an
  API key. Whichever is set wins. (Subscription tokens from `claude
  setup-token` are gated to Claude Code and usually **won't** work for this
  app's direct API calls — `verify_llm_auth.py` will tell you in seconds.)

## 2. Start the two local servers

**Terminal 1 — backend** (holds your API key; the browser talks only to this):
```bash
cd backend
.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

**Terminal 2 — frontend**:
```bash
cd frontend
npm run dev
```

Then open **<http://localhost:5173>**. In dev mode there's **no sign-in gate**
and the app talks to your local backend automatically — no Firebase, no
deployed backend involved.

## 3. Run the report

1. Enter your email address (so your sent messages are attributed to you).
2. Add your files — large mailboxes condense in the browser; large text/JSON
   gets gzipped automatically.
3. Under **Limit to specific conversations**, pick the threads that involve
   the other parent (keep the running total under ~9,000 messages).
4. Fill in the custody fields (other parent, your role, children, jurisdiction).
5. **Build Custody Report.** It runs ~1 Opus 4.8 call per ~150-message window,
   8 in parallel — a few minutes for a scoped run.
6. Review on screen, then **Download PDF / Excel**.

## Cost note

Each window is one Opus 4.8 call. A tightly scoped vetting run (one thread, a
narrow date range, a few hundred messages) costs roughly a dollar or two; a
full ~9,000-message run is more. Scope small first to vet the *quality*, then
widen once you trust the output.

## Tips

- **Vet quality cheaply**: set a short **date range** and one conversation to
  get a representative report for ~$1 before committing to the full history.
- The **Limitations** section of the report notes anything skipped (e.g. a
  single message the model couldn't parse) — read it.
- Everything is in-memory; nothing is written to disk or a database.
