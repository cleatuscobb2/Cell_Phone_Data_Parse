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

import { useCallback, useRef, useState } from "react";
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

const API_BASE = "http://localhost:8000";

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

/** One file drop target. Manages its own drag state and file input. */
function DropZone({ label, hint, accept, file, onPick }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onPick(e.dataTransfer.files?.[0]);
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-7 text-center transition ${
        dragOver
          ? "border-indigo-400 bg-indigo-50"
          : "border-slate-300 hover:border-indigo-300 hover:bg-slate-50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
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
      <p className="mt-0.5 text-sm font-medium text-slate-700">
        {file ? file.name : hint}
      </p>
      <p className="text-xs text-slate-400">
        {file ? "Click to replace" : "drag & drop or click"}
      </p>
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
  const [file, setFile] = useState(null);
  const [emailFile, setEmailFile] = useState(null);
  const [userEmail, setUserEmail] = useState("");
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedContact, setSelectedContact] = useState("");
  const [searchTerms, setSearchTerms] = useState("");
  const [otherParent, setOtherParent] = useState("");
  const [userRole, setUserRole] = useState("mother");
  const [childrenNames, setChildrenNames] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  // Load the contact roster from whichever file(s) are currently chosen.
  const loadContacts = useCallback(async (textF, emailF, email) => {
    if (!textF && !emailF) {
      setContacts([]);
      return;
    }
    setContactsLoading(true);
    try {
      const form = new FormData();
      if (textF) form.append("file", textF);
      if (emailF) form.append("email_file", emailF);
      if (email?.trim()) form.append("user_email", email.trim());
      const res = await fetch(`${API_BASE}/contacts`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Failed to read file (${res.status})`);
      setContacts(data.contacts);
    } catch (err) {
      setError(err.message || "Could not read contacts from the file(s).");
    } finally {
      setContactsLoading(false);
    }
  }, []);

  // Picking either file resets scope and reloads the contact roster.
  function pickText(f) {
    if (!f) return;
    setFile(f);
    setResult(null);
    setError("");
    setSelectedContact("");
    loadContacts(f, emailFile, userEmail);
  }
  function pickEmail(f) {
    if (!f) return;
    setEmailFile(f);
    setResult(null);
    setError("");
    setSelectedContact("");
    loadContacts(file, f, userEmail);
  }

  function switchMode(m) {
    setMode(m);
    setResult(null);
    setError("");
  }

  async function handleSubmit() {
    if (!file && !emailFile) {
      setError("Add a text-message export, an email file, or both.");
      return;
    }
    if (mode === "custody" && !otherParent.trim()) {
      setError("Enter the other parent's name for the custody analysis.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);

    const form = new FormData();
    if (file) form.append("file", file);
    if (emailFile) form.append("email_file", emailFile);
    if (userEmail.trim()) form.append("user_email", userEmail.trim());
    if (startDate) form.append("start_date", startDate);
    if (endDate) form.append("end_date", endDate);
    if (selectedContact) form.append("contact", selectedContact);

    let endpoint;
    if (mode === "custody") {
      endpoint = "/custody-report";
      form.append("other_parent", otherParent.trim());
      form.append("user_role", userRole);
      if (childrenNames.trim()) form.append("children", childrenNames.trim());
    } else {
      endpoint = "/summarize";
      if (searchTerms.trim()) form.append("search_terms", searchTerms.trim());
    }

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
      setResult(data);
    } catch (err) {
      setError(err.message || "Could not reach the analysis service.");
    } finally {
      setLoading(false);
    }
  }

  const summary = result?.summary;
  const meta = result?.meta;
  const isFocused = !!(meta && (meta.contact || meta.search_terms?.length));
  const isCustody = mode === "custody";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">
          Message History Summarizer
        </h1>
        <p className="text-sm text-slate-500">
          Your messages are processed locally and never stored.
        </p>
      </header>

      {/* --- Upload + controls --- */}
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {[
            ["summary", "General Summary"],
            ["custody", "Custody Analysis"],
          ].map(([m, label]) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                mode === m
                  ? "bg-white text-indigo-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
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
            hint="Drop your text export"
            accept=".json,.csv,application/json,text/csv"
            file={file}
            onPick={pickText}
          />
          <DropZone
            label="Emails"
            hint="Drop an .eml or .mbox file"
            accept=".eml,.mbox,.json,.csv,message/rfc822"
            file={emailFile}
            onPick={pickEmail}
          />
        </div>
        <label className="flex flex-col text-xs font-medium text-slate-600">
          Your email address (optional — so we can tell which emails you sent)
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

        {/* Scope: contact (+ search terms in summary mode) */}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col text-xs font-medium text-slate-600">
            {isCustody ? "Limit to one conversation (optional)" : "Contact"}
            <select
              value={selectedContact}
              onChange={(e) => setSelectedContact(e.target.value)}
              disabled={(!file && !emailFile) || contactsLoading}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">
                {contactsLoading ? "Loading contacts…" : "All contacts"}
              </option>
              {contacts.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
          </label>
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
            className="ml-auto rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
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

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
      </div>

      {/* --- Processing animation --- */}
      {loading && <LoadingAnimation mode={mode} />}

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
  );
}
