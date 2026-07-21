/**
 * MessageSummarizer — upload a text-message history export and analyze it.
 *
 * Two modes:
 *  - General Summary: takeaways, contacts, sentiment, optional contact/search
 *    scoping.
 *  - Custody Analysis: a dated, source-quoted event log for a child-custody
 *    matter (childcare instances, missed visits, responsibilities, etc.).
 *
 * Requires: react, recharts, and Tailwind CSS configured in the host app.
 *
 * The component talks only to the local proxy (see backend/main.py). The
 * uploaded file is sent straight to that proxy and never stored in the
 * browser beyond the lifetime of this component's state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import CustodyReport from "./CustodyReport.jsx";
import LoadingAnimation from "./LoadingAnimation.jsx";
import JurisdictionSelect from "./JurisdictionSelect.jsx";
import CustodyIntake from "./CustodyIntake.jsx";
import CardLookup from "./CardLookup.jsx";
import FinancialUpload from "./FinancialUpload.jsx";
import { getStateIntake } from "./stateIntake.js";
import { parseCustodyWorkbook } from "./custodyWorkbookImport.js";
import {
  getIdToken,
  storageEnabled,
  currentUid,
  uploadToStorage,
  deleteFromStorage,
} from "./firebase.js";
import {
  condenseMboxFile,
  CONDENSE_THRESHOLD,
  gzipFile,
  shouldGzip,
} from "./mboxCondense.js";

// Stay under the backend's ~32 MB per-request cap with headroom for
// multipart framing.
// Cloud Run rejects any request body over 32 MB before it reaches the
// function — and does so without CORS headers, so the browser only sees a
// generic "Failed to fetch". Guard well under that so multipart overhead and
// the odd large field can't push a just-under upload over the real limit.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// When Storage is enabled the request body carries only a tiny manifest, so
// the 32 MB request wall no longer applies. Files still get downloaded and
// processed in a 1 GB function, so keep a generous ceiling on the (already
// condensed + gzipped) upload total. Phases 2/3 remove this too via streaming.
const STORAGE_MAX_BYTES = 200 * 1024 * 1024;

/** The effective per-request upload cap for the active transport. */
function uploadCap() {
  return storageEnabled ? STORAGE_MAX_BYTES : MAX_UPLOAD_BYTES;
}

/** Turn a raw fetch/transport failure into guidance the user can act on. */
function describeFetchError(err) {
  const msg = err?.message || "";
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return (
      "The upload didn't reach the server. This usually means the files are " +
      "too large for a single request (the service caps each request at " +
      "~32 MB). Export a narrower date range or split into smaller files. " +
      "If the files are already small, check your connection and retry."
    );
  }
  return msg || "Could not reach the analysis service.";
}

/**
 * Upload each category's files to Cloud Storage and return a manifest plus the
 * object paths (for cleanup). `categories` maps a backend form-field name to
 * its File[]. Files go under uploads/{uid}/{sessionId}/{field}/ — the backend
 * verifies that prefix so a user can only ever read their own uploads.
 */
async function uploadToStorageManifest(categories, onProgress) {
  const uid = currentUid();
  const sessionId =
    (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const manifest = {};
  const paths = [];
  for (const [field, files] of Object.entries(categories)) {
    if (!files || files.length === 0) continue;
    const entries = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const safe = (f.name || "file").replace(/[^\w.\-]+/g, "_");
      const path = `uploads/${uid}/${sessionId}/${field}/${i}-${safe}`;
      await uploadToStorage(f, path, onProgress);
      entries.push({ path, name: f.name || safe });
      paths.push(path);
    }
    manifest[field] = entries;
  }
  return { manifest, paths };
}

// Local dev defaults to the FastAPI proxy; production must set VITE_API_BASE
// to the deployed Firebase function URL. The localhost fallback applies ONLY
// to dev builds — in a production build a missing VITE_API_BASE is a
// deployment misconfiguration, and silently pointing at the visitor's own
// machine would surface as an inscrutable "Failed to fetch". Fail loudly
// instead (see the banner in the component). The dev default uses the
// explicit IPv4 loopback (127.0.0.1, not "localhost") because the backend
// binds IPv4 only — "localhost" can resolve to IPv6 (::1) and fail.
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV ? "http://127.0.0.1:8000" : "");

/**
 * fetch() against the backend, attaching the Firebase ID token when the user
 * is signed in. With auth disabled (local dev) no header is added.
 */
async function apiFetch(path, options = {}) {
  if (!API_BASE) {
    throw new Error(
      "This deployment has no backend configured (VITE_API_BASE is not set). " +
        "Set it in the hosting dashboard and redeploy.",
    );
  }
  const token = await getIdToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

const PRIORITY_STYLES = {
  high: "bg-red-100 text-red-700 ring-red-200",
  medium: "bg-amber-100 text-amber-700 ring-amber-200",
  low: "bg-slate-100 text-slate-600 ring-slate-200",
};

function Panel({ title, subtitle, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const UPLOAD_SVG =
  "M12 16.5V9.75m0 0l-3 3m3-3l3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 " +
  "5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z";

/** Multi-file drop target. Manages its own drag state and file input;
    additional drops append (don't replace) so a parent can build up a
    set of text exports or .eml/.mbox files across several actions. */
function DropZone({ label, hint, accept, files, onChange }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  function append(picked) {
    const arr = Array.from(picked || []);
    if (arr.length === 0) return;
    onChange([...files, ...arr]);
  }

  function remove(i) {
    onChange(files.filter((_, j) => j !== i));
  }

  const summary =
    files.length === 0
      ? hint
      : files.length === 1
        ? files[0].name
        : `${files.length} files uploaded`;

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          append(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-7 text-center transition ${
          dragOver
            ? "border-indigo-400 bg-indigo-50"
            : "border-slate-300 hover:border-indigo-300 hover:bg-slate-50/60"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => {
            append(e.target.files);
            // Let the same filename be reselected later.
            e.target.value = "";
          }}
        />
        <svg
          className="h-8 w-8 text-slate-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d={UPLOAD_SVG} />
        </svg>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-medium text-slate-700">{summary}</p>
        <p className="text-xs text-slate-400">
          {files.length === 0
            ? "drag & drop or click — multiple OK"
            : "click to add more"}
        </p>
      </div>
      {files.length > 1 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700"
            >
              <span className="truncate" title={f.name}>{f.name}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(i);
                }}
                className="ml-2 text-slate-400 hover:text-rose-600"
                aria-label={`Remove ${f.name}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Wrap any occurrences of the search terms in <mark> for the breakdown. */
function highlight(text, terms) {
  if (!terms || terms.length === 0) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const lowered = terms.map((t) => t.toLowerCase());
  return text.split(re).map((part, i) =>
    lowered.includes(part.toLowerCase()) ? (
      <mark key={i} className="rounded bg-amber-200 px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export default function MessageSummarizer() {
  const [mode, setMode] = useState("summary"); // "summary" | "custody"
  const [textFiles, setTextFiles] = useState([]);
  const [emailFiles, setEmailFiles] = useState([]);
  const [userEmail, setUserEmail] = useState("");
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [searchTerms, setSearchTerms] = useState("");
  const [otherParent, setOtherParent] = useState("");
  const [userRole, setUserRole] = useState("mother");
  const [childrenNames, setChildrenNames] = useState("");
  const [caseState, setCaseState] = useState("");
  const [caseCounty, setCaseCounty] = useState("");
  const [caseProfile, setCaseProfile] = useState({});
  const [receiptFiles, setReceiptFiles] = useState([]);
  const [eobFiles, setEobFiles] = useState([]);
  const [paymentCsvFiles, setPaymentCsvFiles] = useState([]);
  const [bankCsvFiles, setBankCsvFiles] = useState([]);
  const [cardLookup, setCardLookup] = useState({});
  const [monthlyGrossIncome, setMonthlyGrossIncome] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  // Progress line while a large mailbox is being condensed in-browser.
  const [condensing, setCondensing] = useState(null);
  // Conversation roster filter: true = only two-way threads (real people),
  // hiding one-way senders like newsletters and receipts.
  const [peopleOnly, setPeopleOnly] = useState(true);
  // Relevance filter: "auto" (on for large runs), "on", or "off".
  const [smartFilter, setSmartFilter] = useState("auto");
  // Async batch-backed job: { id, progress: {done,total} } while one runs.
  const [job, setJob] = useState(null);

  // Poll a running job until it finishes; render the report when done. The
  // batch runs server-side, so this survives a reload (see the resume effect).
  useEffect(() => {
    if (!job?.id) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await apiFetch(`/jobs/${job.id}`, { method: "GET" });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.detail || `Job failed (${res.status})`);
        if (data.status === "processing") {
          setJob((j) => (j ? { ...j, progress: data.progress } : j));
          return;
        }
        if (data.status === "error") setError(data.detail || "The analysis job failed.");
        else if (data.status === "done") setResult(data.result);
        localStorage.removeItem("casefile_job");
        setJob(null);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(describeFetchError(err));
        localStorage.removeItem("casefile_job");
        setJob(null);
        setLoading(false);
      }
    };
    tick();
    const iv = setInterval(tick, 12000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [job?.id]);

  // Resume a job that was still running when the tab was closed/reloaded.
  useEffect(() => {
    const saved = localStorage.getItem("casefile_job");
    if (saved) {
      setLoading(true);
      setJob({ id: saved, progress: null });
    }
  }, []);

  // Load the contact roster from every file currently chosen.
  const loadContacts = useCallback(async (texts, emails, email) => {
    if ((!texts || texts.length === 0) && (!emails || emails.length === 0)) {
      setContacts([]);
      return;
    }
    // Guard the roster call too — it fires the moment files are added, so an
    // over-limit upload would otherwise surface here as a bare "Failed to
    // fetch" before the user ever reaches the Analyze button's size check.
    const total = [...(texts || []), ...(emails || [])].reduce(
      (s, f) => s + f.size, 0,
    );
    if (total > uploadCap()) {
      setError(
        `These files total ${(total / 1048576).toFixed(0)} MB — over the ` +
          `${(uploadCap() / 1048576).toFixed(0)} MB limit. ` +
          `Export a narrower date range or split into smaller files.`,
      );
      setContacts([]);
      return;
    }
    setContactsLoading(true);
    // When Storage is enabled the roster call uploads to Storage too (the raw
    // files can exceed the 32 MB request limit); those transient objects are
    // deleted right after, since the report will re-upload what it needs.
    let cleanupPaths = [];
    try {
      const form = new FormData();
      if (email?.trim()) form.append("user_email", email.trim());
      if (storageEnabled) {
        const { manifest, paths } = await uploadToStorageManifest({
          file: texts || [],
          email_file: emails || [],
        });
        cleanupPaths = paths;
        form.append("storage_manifest", JSON.stringify(manifest));
      } else {
        for (const f of texts || []) form.append("file", f);
        for (const f of emails || []) form.append("email_file", f);
      }
      const res = await apiFetch("/contacts", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Failed to read file (${res.status})`);
      setContacts(data.contacts);
    } catch (err) {
      setError(describeFetchError(err));
    } finally {
      setContactsLoading(false);
      if (cleanupPaths.length) deleteFromStorage(cleanupPaths);
    }
  }, []);

  // Updating either file list resets scope and reloads the contact roster.
  async function changeTextFiles(next) {
    setResult(null);
    setError("");
    setSelectedContacts([]);
    const processed = [];
    for (const f of next) {
      processed.push(shouldGzip(f) ? await gzipFile(f) : f);
    }
    setTextFiles(processed);
    loadContacts(processed, emailFiles, userEmail);
  }

  /**
   * Large mailboxes are condensed in the browser before anything is sent:
   * the backend caps requests at ~32 MB, and a multi-GB mbox is nearly all
   * attachment payloads the analysis never reads. Only sender / date /
   * subject / cleaned text (plus attachment names) leave this device.
   */
  async function changeEmailFiles(next) {
    setResult(null);
    setError("");
    setSelectedContacts([]);
    const processed = [];
    for (const f of next) {
      const isBigMbox =
        /\.mbox$/i.test(f.name) && f.size >= CONDENSE_THRESHOLD;
      if (!isBigMbox) {
        processed.push(shouldGzip(f) ? await gzipFile(f) : f);
        continue;
      }
      try {
        const mb = (f.size / 1048576).toFixed(0);
        setCondensing(`Reading ${f.name} (${mb} MB) in your browser…`);
        const out = await condenseMboxFile(f, userEmail, (bytes, count) => {
          const pct = Math.min(100, Math.round((bytes / f.size) * 100));
          setCondensing(
            `Condensing ${f.name} — ${pct}% · ${count.toLocaleString()} emails` +
              " · your mailbox never leaves this device",
          );
        });
        processed.push(shouldGzip(out.file) ? await gzipFile(out.file) : out.file);
        if (out.truncated) {
          setError(
            `"${f.name}" is very large — kept the first ` +
              `${out.count.toLocaleString()} emails. For complete coverage, ` +
              `export a narrower date range and add it as another file.`,
          );
        }
      } catch (err) {
        setError(err.message || `Could not read ${f.name}.`);
      }
    }
    setCondensing(null);
    setEmailFiles(processed);
    loadContacts(textFiles, processed, userEmail);
  }

  /** Everything queued for upload, across all zones — for the size preflight. */
  function allQueuedFiles() {
    return [
      ...textFiles, ...emailFiles, ...receiptFiles,
      ...eobFiles, ...paymentCsvFiles, ...bankCsvFiles,
    ];
  }

  /** Reject over-cap payloads with a useful message instead of letting the
      backend's request/memory limit surface as "Failed to fetch". */
  function payloadTooLarge() {
    const files = allQueuedFiles();
    const total = files.reduce((s, f) => s + f.size, 0);
    if (total <= uploadCap()) return null;
    const biggest = files.reduce((a, b) => (a.size >= b.size ? a : b));
    return (
      `Upload total is ${(total / 1048576).toFixed(0)} MB — over the ` +
      `${(uploadCap() / 1048576).toFixed(0)} MB limit for a single report. ` +
      `The largest file is "${biggest.name}" ` +
      `(${(biggest.size / 1048576).toFixed(0)} MB); narrow the export's date ` +
      `range or split it into smaller files.`
    );
  }

  function switchMode(m) {
    setMode(m);
    setResult(null);
    setError("");
  }

  async function handleSubmit() {
    if (textFiles.length === 0 && emailFiles.length === 0) {
      setError("Add a text-message export, an email file, or both.");
      return;
    }
    if (mode === "custody" && !otherParent.trim()) {
      setError("Enter the other parent's name for the custody analysis.");
      return;
    }
    const sizeError = payloadTooLarge();
    if (sizeError) {
      setError(sizeError);
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);

    const form = new FormData();
    if (userEmail.trim()) form.append("user_email", userEmail.trim());
    if (startDate) form.append("start_date", startDate);
    if (endDate) form.append("end_date", endDate);
    for (const c of selectedContacts) form.append("contact", c);
    if (isCustody) form.append("smart_filter", smartFilter);

    // Files sent to the backend, grouped by form-field name. Message channels
    // always; financial channels only for a custody report.
    const fileCategories = { file: textFiles, email_file: emailFiles };

    let endpoint;
    if (mode === "custody") {
      endpoint = "/custody-report";
      form.append("other_parent", otherParent.trim());
      form.append("user_role", userRole);
      if (childrenNames.trim()) form.append("children", childrenNames.trim());
      if (caseState) form.append("state", caseState);
      if (caseCounty) form.append("county", caseCounty);
      if (Object.keys(caseProfile).length > 0) {
        form.append("case_profile", JSON.stringify(caseProfile));
      }
      fileCategories.receipt_files = receiptFiles;
      fileCategories.eob_files = eobFiles;
      fileCategories.payment_files = paymentCsvFiles;
      fileCategories.bank_files = bankCsvFiles;
      if (Object.keys(cardLookup).length > 0) {
        form.append("card_lookup", JSON.stringify(cardLookup));
      }
      if (monthlyGrossIncome.trim()) {
        form.append("monthly_gross_income", monthlyGrossIncome.trim());
      }
    } else {
      endpoint = "/summarize";
      if (searchTerms.trim()) form.append("search_terms", searchTerms.trim());
    }

    // With Storage enabled (production), files go to Cloud Storage and the run
    // becomes an async, batch-backed job the client polls — no window cap, and
    // it survives a closed tab. Dev with no Storage posts bodies synchronously.
    let cleanupPaths = [];
    let jobStarted = false;
    try {
      if (storageEnabled) {
        setCondensing("Uploading files to secure storage…");
        const { manifest, paths } = await uploadToStorageManifest(
          fileCategories,
          (sent, tot) => {
            if (tot) {
              setCondensing(
                `Uploading to secure storage — ${Math.round((sent / tot) * 100)}%`,
              );
            }
          },
        );
        cleanupPaths = paths;
        form.append("storage_manifest", JSON.stringify(manifest));
        form.append("job_kind", mode === "custody" ? "custody" : "summary");
        setCondensing("Submitting analysis job…");
        const res = await apiFetch("/jobs", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
        localStorage.setItem("casefile_job", data.job_id);
        setJob({ id: data.job_id, progress: { done: 0, total: data.windows || 0 } });
        jobStarted = true;
        setCondensing(null);
      } else {
        for (const [field, files] of Object.entries(fileCategories)) {
          for (const f of files) form.append(field, f);
        }
        const res = await apiFetch(endpoint, { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
        setResult(data);
      }
    } catch (err) {
      setError(describeFetchError(err));
      // The job deletes uploads when it finishes; if the request never got
      // there (upload/network failure), clean them up ourselves.
      if (cleanupPaths.length) deleteFromStorage(cleanupPaths);
    } finally {
      setCondensing(null);
      // A started job keeps the loading state; the poll effect clears it.
      if (!jobStarted) setLoading(false);
    }
  }

  // Re-import an edited custody-evidence workbook and regenerate the report
  // from it (no analysis re-run). Lets the parent fill in "Unclear" fields and
  // correct anything before producing the final PDF.
  async function importWorkbook(file) {
    if (!file) return;
    setError("");
    setResult(null);
    setJob(null);
    setLoading(true);
    try {
      const data = await parseCustodyWorkbook(file);
      setMode("custody");
      setResult(data);
    } catch (err) {
      setError(err?.message || "Could not read that workbook.");
    } finally {
      setLoading(false);
    }
  }

  const summary = result?.summary;
  const meta = result?.meta;
  const isFocused = !!(meta && (meta.contact || meta.search_terms?.length));
  const isCustody = mode === "custody";
  // The intake questionnaire is state-specific — shown only once a state
  // with a registered intake (currently West Virginia) is selected.
  const stateIntake = getStateIntake(caseState);

  // Roster shown in the conversation picker. "People" = a real correspondent:
  // a two-way thread, OR a non-automated sender (so newsletters, receipts, and
  // transactional brands are hidden even when message-direction is missing —
  // e.g. emails where the user didn't enter their own address). Falls back to
  // everything if that would be empty, and always keeps selected names visible.
  const isPerson = (c) => c.two_way || !c.looks_automated;
  const peopleContacts = contacts.filter(isPerson);
  const visibleContacts =
    !peopleOnly || peopleContacts.length === 0
      ? contacts
      : contacts.filter(
          (c) => isPerson(c) || selectedContacts.includes(c.name),
        );

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-amber-50">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <header>
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-base font-bold text-white shadow-md shadow-indigo-200">
              C
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Casefile</h1>
              <p className="text-sm text-slate-500">
                Your custody record — from your own messages, receipts, and statements.
                Processed in memory, never stored.
              </p>
            </div>
          </div>
        </header>

      {/* Round-trip entry point: regenerate a report from an edited evidence
          workbook, without re-running (or paying for) the analysis. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
        <div className="text-sm text-emerald-900">
          <p className="font-semibold">Already have an edited evidence workbook?</p>
          <p className="text-emerald-700">
            Fill in the “Unclear” fields in a downloaded Excel, then upload it
            here to regenerate the report and PDF — no re-analysis, no cost.
          </p>
        </div>
        <label className="cursor-pointer whitespace-nowrap rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-200 transition hover:bg-emerald-700">
          Import edited workbook
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              importWorkbook(f);
            }}
          />
        </label>
      </div>

      {/* Deployment misconfiguration — surface it instead of letting every
          request die with an opaque "Failed to fetch". */}
      {!API_BASE && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <p className="font-semibold">This deployment has no backend configured.</p>
          <p className="mt-1">
            The <code className="font-mono">VITE_API_BASE</code> environment
            variable was not set when this site was built, so analysis
            requests have nowhere to go. Set it to the deployed backend URL in
            the hosting dashboard and redeploy.
          </p>
        </div>
      )}

      {/* --- Upload + controls --- */}
      <div className="space-y-4 rounded-2xl bg-white p-6 shadow-lg shadow-indigo-100/40 ring-1 ring-slate-200">
        <div className="inline-flex gap-1 rounded-full bg-white p-1 text-sm shadow-sm ring-1 ring-slate-200">
          {[
            ["summary", "General Summary"],
            ["custody", "Custody Analysis"],
          ].map(([m, label]) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                mode === m
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-200"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Side-by-side import: text messages and emails. Either or both. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <DropZone
            label="Text messages"
            hint="Drop your text exports"
            accept=".json,.csv,application/json,text/csv"
            files={textFiles}
            onChange={changeTextFiles}
          />
          <DropZone
            label="Emails"
            hint="Drop .eml or .mbox files — any size"
            accept=".eml,.mbox,.json,.csv,message/rfc822"
            files={emailFiles}
            onChange={changeEmailFiles}
          />
        </div>
        {condensing && (
          <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
            {condensing}
          </div>
        )}
        <label className="flex flex-col text-xs font-medium text-slate-600">
          Your email address (optional — enter it BEFORE adding a large
          mailbox, so your sent emails are attributed to you)
          <input
            type="email"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>

        {isCustody && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            This produces an organizational aid — not legal evidence or advice.
            Every item is quoted from your own messages so you can verify it.
            Counts are estimates. Consult a family-law attorney about what is
            admissible and how to present it.
          </div>
        )}

        {/* Custody-specific case context */}
        {isCustody && (
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col text-xs font-medium text-slate-600">
              Other parent&rsquo;s name *
              <input
                type="text"
                value={otherParent}
                onChange={(e) => setOtherParent(e.target.value)}
                placeholder="as it appears in your messages"
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-slate-600">
              I am the children&rsquo;s
              <select
                value={userRole}
                onChange={(e) => setUserRole(e.target.value)}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="mother">mother</option>
                <option value="father">father</option>
                <option value="parent">parent</option>
              </select>
            </label>
            <label className="flex flex-col text-xs font-medium text-slate-600">
              Children&rsquo;s names (optional)
              <input
                type="text"
                value={childrenNames}
                onChange={(e) => setChildrenNames(e.target.value)}
                placeholder="comma-separated"
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          </div>
        )}

        {/* Court jurisdiction — scopes the evidence package to a county. */}
        {isCustody && (
          <div>
            <p className="text-xs font-medium text-slate-600">Court jurisdiction</p>
            <p className="mb-1.5 text-xs text-slate-400">
              The state and county where the case is filed — used to align the
              evidence package with that court&rsquo;s requirements.
            </p>
            <JurisdictionSelect
              state={caseState}
              county={caseCounty}
              onStateChange={(s) => {
                setCaseState(s);
                setCaseCounty("");
                // A new state has a different intake — clear stale answers.
                setCaseProfile({});
              }}
              onCountyChange={setCaseCounty}
            />
          </div>
        )}

        {/* Custody filing intake — state-specific. Shown only once a state
            with a registered intake is selected; answers drive that state's
            required form packet and tailor the analysis to the case. */}
        {isCustody && stateIntake && (
          <div>
            <p className="text-xs font-medium text-slate-600">
              {stateIntake.label}
            </p>
            <p className="mb-1.5 text-xs text-slate-400">
              {stateIntake.blurb}
            </p>
            <CustodyIntake
              intake={stateIntake}
              answers={caseProfile}
              onChange={setCaseProfile}
            />
          </div>
        )}

        {/* No intake for the selected state — explain why it's not shown. */}
        {isCustody && !stateIntake && (
          <p className="text-xs text-slate-400">
            {caseState
              ? `A custody-filing intake for ${caseState} isn't available yet.`
              : "Select a state above to answer its custody-filing intake."}
          </p>
        )}

        {/* Financial documents (optional) — receipts and payment-app
            exports. Each one becomes an Expense in the report. The
            card-lookup mapping lets us attribute a receipt to a parent. */}
        {isCustody && (
          <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
            <p className="text-xs font-medium text-slate-600">
              Financial documents (optional)
            </p>
            <p className="mb-2 text-xs text-slate-400">
              Drop receipts and Venmo / Zelle / Cash App / PayPal exports to
              add a Financial Contribution section with totals over time and
              cross-validation against the message claims.
            </p>
            <FinancialUpload
              receipts={receiptFiles}
              eobs={eobFiles}
              paymentCsvs={paymentCsvFiles}
              bankCsvs={bankCsvFiles}
              onReceiptsChange={setReceiptFiles}
              onEobsChange={setEobFiles}
              onPaymentCsvsChange={setPaymentCsvFiles}
              onBankCsvsChange={setBankCsvFiles}
            />
            <div className="mt-3 border-t border-slate-200 pt-2">
              <p className="text-xs font-medium text-slate-600">
                Card lookup (optional)
              </p>
              <CardLookup lookup={cardLookup} onChange={setCardLookup} />
            </div>
            {stateIntake && (
              <div className="mt-3 border-t border-slate-200 pt-2">
                <p className="text-xs font-medium text-slate-600">
                  Monthly gross income (optional — for SCA-FC-106)
                </p>
                <p className="text-xs text-slate-400">
                  The only income field — used to compute child expenses as
                  a percentage of income on the WV Financial Statement
                  worksheet. Everything else on SCA-FC-106 stays for the
                  user / attorney to fill in by hand.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm text-slate-500">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 6500"
                    value={monthlyGrossIncome}
                    onChange={(e) => setMonthlyGrossIncome(e.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                  <span className="text-xs text-slate-500">per month</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Scope: conversations (+ search terms in summary mode). Multi-
            select, because the other parent usually appears as several
            buckets — their text thread, their email address, name variants —
            and a case can span relatives' and the school's threads too. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col text-xs font-medium text-slate-600">
            {isCustody
              ? "Limit to specific conversations (optional — pick every thread involving the other parent)"
              : "Contacts"}
            {contacts.length > 0 && (
              <div className="mt-1 flex gap-1 self-start rounded-full bg-slate-100 p-0.5 font-normal">
                {[
                  [true, `People (${peopleContacts.length})`],
                  [false, `All senders (${contacts.length})`],
                ].map(([val, label]) => (
                  <button
                    key={String(val)}
                    type="button"
                    onClick={() => setPeopleOnly(val)}
                    className={`rounded-full px-2.5 py-0.5 transition ${
                      peopleOnly === val
                        ? "bg-white font-medium text-indigo-700 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {selectedContacts.length > 0 && (
              <span className="mt-1 font-normal text-indigo-600">
                {selectedContacts.length} selected ·{" "}
                {contacts
                  .filter((c) => selectedContacts.includes(c.name))
                  .reduce((s, c) => s + c.count, 0)
                  .toLocaleString()}{" "}
                messages
              </span>
            )}
            <div
              className={`mt-1 max-h-44 overflow-y-auto rounded-md border border-slate-300 bg-white ${
                (textFiles.length === 0 && emailFiles.length === 0) || contactsLoading
                  ? "pointer-events-none bg-slate-50 text-slate-400"
                  : ""
              }`}
            >
              {contactsLoading ? (
                <p className="px-2 py-1.5 text-slate-400">Loading contacts…</p>
              ) : contacts.length === 0 ? (
                <p className="px-2 py-1.5 text-slate-400">
                  Add files to list conversations
                </p>
              ) : (
                visibleContacts.map((c) => (
                  <label
                    key={c.name}
                    className="flex cursor-pointer items-center gap-2 px-2 py-1 font-normal hover:bg-indigo-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedContacts.includes(c.name)}
                      onChange={(e) =>
                        setSelectedContacts((prev) =>
                          e.target.checked
                            ? [...prev, c.name]
                            : prev.filter((n) => n !== c.name),
                        )
                      }
                      className="rounded border-slate-300"
                    />
                    <span className="truncate">
                      {c.name}{" "}
                      <span className="text-slate-400">
                        ({c.count.toLocaleString()})
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
            <span className="mt-1 font-normal text-slate-400">
              Nothing selected = all conversations
            </span>
          </div>
          {!isCustody && (
            <label className="flex flex-col text-xs font-medium text-slate-600">
              Search terms
              <input
                type="text"
                value={searchTerms}
                onChange={(e) => setSearchTerms(e.target.value)}
                placeholder="e.g. budget, deadline, dinner — comma-separated"
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col text-xs font-medium text-slate-600">
            Start date
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs font-medium text-slate-600">
            End date
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="ml-auto rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:from-indigo-700 hover:to-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? isCustody
                ? "Analyzing…"
                : "Summarizing…"
              : isCustody
                ? "Build Custody Report"
                : "Summarize"}
          </button>
        </div>

        {isCustody && (
          <label className="flex flex-col text-xs font-medium text-slate-600">
            Smart filter
            <select
              value={smartFilter}
              onChange={(e) => setSmartFilter(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm sm:w-72"
            >
              <option value="auto">
                Auto — filter large runs (recommended)
              </option>
              <option value="on">On — always pre-filter for relevance</option>
              <option value="off">Off — analyze every message</option>
            </select>
            <span className="mt-1 font-normal text-slate-400">
              A cheap model first drops messages unrelated to the children, so
              only the relevant slice gets the full (costly) analysis. The
              complete message log is always kept in the report. Recall-biased —
              when unsure it keeps the message.
            </span>
          </label>
        )}

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </div>

      {/* --- Processing animation (upload / sync run; the job card replaces
           it once a batch job is running) --- */}
      {loading && !job && <LoadingAnimation mode={mode} />}

      {/* --- Async job progress --- */}
      {job && (
        <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
          <div className="font-semibold">
            {job.progress?.total
              ? `Analyzing — ${job.progress.done || 0} of ${job.progress.total} windows complete`
              : "Resuming your analysis…"}
          </div>
          {job.progress?.total > 0 && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-indigo-200">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all"
                style={{
                  width: `${Math.round(
                    ((job.progress.done || 0) / job.progress.total) * 100,
                  )}%`,
                }}
              />
            </div>
          )}
          <div className="mt-2 text-indigo-700">
            This runs on the batch service to keep costs down — it can take a few
            minutes. You can leave this page and come back; the report will be
            here when it's done.
          </div>
        </div>
      )}

      {/* --- Custody report --- */}
      {result?.report && <CustodyReport data={result} />}

      {/* --- General summary results --- */}
      {result?.summary && (
        <div className="space-y-6">
          {isFocused && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm">
              <span className="font-medium text-indigo-700">Scoped to:</span>
              {meta.contact && (
                <span className="rounded-full bg-white px-2 py-0.5 text-indigo-700 ring-1 ring-indigo-200">
                  {meta.contact}
                </span>
              )}
              {meta.search_terms?.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-white px-2 py-0.5 text-amber-700 ring-1 ring-amber-200"
                >
                  &ldquo;{t}&rdquo;
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              [meta.search_terms?.length ? "Matches" : "Messages", meta.total_messages],
              ["Conversations", meta.conversation_count],
              ["From", meta.date_range?.[0] ?? "—"],
              ["To", meta.date_range?.[1] ?? "—"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm"
              >
                <div className="text-xl font-bold text-slate-800">{value}</div>
                <div className="text-xs uppercase tracking-wide text-slate-400">
                  {label}
                </div>
              </div>
            ))}
          </div>

          {summary.search_findings?.length > 0 && (
            <Panel title="Search Findings" subtitle="What the messages reveal per term">
              <div className="space-y-3">
                {summary.search_findings.map((f, i) => (
                  <div key={i} className="rounded-md border border-slate-100 p-3">
                    <div className="text-sm font-semibold text-amber-700">
                      &ldquo;{f.term}&rdquo;
                    </div>
                    <div className="mt-1 text-sm text-slate-600">{f.insight}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel title="Key Takeaways">
            <ul className="space-y-2">
              {summary.key_takeaways.map((t, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-700">
                  <span className="mt-0.5 text-indigo-500">●</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm italic text-slate-600">
              {summary.overall_sentiment}
            </p>
          </Panel>

          <Panel title="Action Items">
            {summary.action_items.length === 0 ? (
              <p className="text-sm text-slate-400">No outstanding action items found.</p>
            ) : (
              <ul className="space-y-2">
                {summary.action_items.map((a, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2"
                  >
                    <div className="text-sm text-slate-700">
                      <span className="font-medium">{a.owner}:</span> {a.description}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${
                        PRIORITY_STYLES[a.priority] ?? PRIORITY_STYLES.low
                      }`}
                    >
                      {a.priority}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className={`grid gap-6 ${meta.contact ? "" : "md:grid-cols-2"}`}>
            {!meta.contact && (
              <Panel title="Top Contacts" subtitle="By message volume">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={result.stats.top_contacts}
                    layout="vertical"
                    margin={{ left: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            )}

            <Panel
              title="Message Volume"
              subtitle={
                meta.search_terms?.length
                  ? "Matching messages per day"
                  : "Messages per day"
              }
            >
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={result.stats.volume}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#0ea5e9"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <Panel title="Sentiment Trend" subtitle="Emotional tone over time (-1 to +1)">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={summary.sentiment_trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis domain={[-1, 1]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <ReferenceLine y={0} stroke="#cbd5e1" />
                <Line
                  type="monotone"
                  dataKey="sentiment_score"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          {result.matched_messages && (
            <Panel
              title="Matched Messages"
              subtitle={
                `${meta.total_messages} message${meta.total_messages === 1 ? "" : "s"} in scope` +
                (result.matched_truncated ? " — showing the first 500" : "")
              }
            >
              <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
                {result.matched_messages.map((m, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-slate-100 px-3 py-2 text-sm"
                  >
                    <div className="flex justify-between text-xs text-slate-400">
                      <span className="font-medium text-slate-600">{m.sender}</span>
                      <span>{m.timestamp}</span>
                    </div>
                    <div className="text-slate-700">
                      {highlight(m.body, meta.search_terms)}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {summary.contact_insights.length > 0 && (
            <Panel title="Contact Insights">
              <div className="grid gap-3 sm:grid-cols-2">
                {summary.contact_insights.map((c, i) => (
                  <div key={i} className="rounded-md border border-slate-100 p-3">
                    <div className="text-sm font-semibold text-slate-800">{c.name}</div>
                    <div className="mt-1 text-sm text-slate-600">
                      {c.relationship_note}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
