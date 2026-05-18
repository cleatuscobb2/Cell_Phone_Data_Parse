/**
 * CustodyReport — renders the output of the backend /custody-report endpoint.
 *
 * Every event is shown with its verbatim source quote and date so it can be
 * traced back to the original message. Section-specific charts surface the
 * patterns relevant to the case. This view is an organizational aid for the
 * parent and their attorney — not legal advice or court-ready evidence on
 * its own.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { pdf } from "@react-pdf/renderer";
import Timeline from "./Timeline.jsx";
import CustodyReportPDF from "./CustodyReportPDF.jsx";
import {
  carePatternData,
  custodySplitData,
  missedByTypeData,
  missedOverTimeData,
  responsibilityData,
} from "./chartData.js";

const PARENT_COLORS = {
  mother: "#6366f1",
  father: "#f97316",
  shared: "#f59e0b",
  unclear: "#94a3b8",
};

const PARENT_BADGE = {
  mother: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  father: "bg-orange-100 text-orange-700 ring-orange-200",
  shared: "bg-amber-100 text-amber-700 ring-amber-200",
  unclear: "bg-slate-100 text-slate-500 ring-slate-200",
};

const MISSED_COLOR = "#e11d48";
const MISSED_BADGE = "bg-rose-100 text-rose-700 ring-rose-200";
const CATEGORY_BADGE = "bg-sky-100 text-sky-700 ring-sky-200";

function Panel({ title, subtitle, accent, children }) {
  return (
    <section
      className={`rounded-xl border bg-white p-5 shadow-sm ${
        accent ? "border-rose-200" : "border-slate-200"
      }`}
    >
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Badge({ text, className }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${className}`}
    >
      {text}
    </span>
  );
}

function ChartCaption({ children }) {
  return <p className="mb-1 text-xs font-medium text-slate-500">{children}</p>;
}

/** One traceable event: date, label, description, and the verbatim message. */
function EvidenceRow({ date, badge, description, quote, sender }) {
  return (
    <div className="rounded-md border border-slate-100 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500">{date || "date unclear"}</span>
        {badge}
      </div>
      <p className="mt-1 text-sm text-slate-700">{description}</p>
      {quote && (
        <blockquote className="mt-1 border-l-2 border-slate-300 pl-2 text-sm italic text-slate-500">
          &ldquo;{quote}&rdquo;
          {sender ? <span className="not-italic text-slate-400"> — {sender}</span> : null}
        </blockquote>
      )}
    </div>
  );
}

function EmptyNote({ children }) {
  return <p className="text-sm text-slate-400">{children}</p>;
}

export default function CustodyReport({ data }) {
  const { meta, custody_breakdown: cb, report } = data;
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState("");

  async function downloadPdf() {
    setPdfBusy(true);
    setPdfError("");
    try {
      const blob = await pdf(<CustodyReportPDF data={data} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `custody-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setPdfError(err?.message || "Could not generate the PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  // Chart datasets — shared with the PDF renderer so the numbers match.
  const pieData = custodySplitData(cb).map((d) => ({ ...d, name: d.label }));
  const monthly = carePatternData(report);
  const missedTime = missedOverTimeData(report);
  const missedTypes = missedByTypeData(report);
  const responsibilities = responsibilityData(report);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-800">Custody Analysis Report</h2>
        <div className="flex flex-col items-end">
          <button
            onClick={downloadPdf}
            disabled={pdfBusy}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pdfBusy ? "Generating PDF…" : "Download PDF Report"}
          </button>
          {pdfError && <span className="mt-1 text-xs text-red-600">{pdfError}</span>}
        </div>
      </div>

      {meta.windows > 1 && (
        <p className="-mt-4 text-xs text-slate-400">
          Large history — analyzed in {meta.windows} time windows and merged into
          this report.
        </p>
      )}

      {/* Disclaimer — repeated here so it travels with the report. */}
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Read before relying on this for court</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>
            Your original messages are the evidence — verify every item below
            against them before using it.
          </li>
          <li>
            AI extraction can miss or misclassify messages; treat all counts and
            percentages as estimates.
          </li>
          <li>
            This analysis covers text messages only — not school, medical, or
            court records.
          </li>
          <li>This is not legal advice. Consult a family-law attorney.</li>
        </ul>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Messages analyzed", meta.total_messages],
          [`Est. time with ${meta.user_role}`, `${cb.estimated_pct_mother}%`],
          ["Est. time with father", `${cb.estimated_pct_father}%`],
          ["Missed / cancelled", report.missed_or_cancelled.length],
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

      <Panel title="Overview">
        <p className="text-sm text-slate-700">{report.overview}</p>
      </Panel>

      <Panel
        title="Event Timeline"
        subtitle="Patterns over time by category — toggle lanes to filter"
      >
        <Timeline report={report} meta={meta} />
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Custody Split" subtitle="By count of childcare instances">
          {pieData.length === 0 ? (
            <EmptyNote>No childcare instances were identified.</EmptyNote>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={85}
                  label={(d) => `${d.name}: ${d.value}`}
                >
                  {pieData.map((d) => (
                    <Cell key={d.key} fill={PARENT_COLORS[d.key]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
          <p className="mt-2 text-xs text-slate-400">{report.breakdown_basis}</p>
        </Panel>

        <Panel title="Care Pattern Over Time" subtitle="Childcare instances per month">
          {monthly.length === 0 ? (
            <EmptyNote>Not enough dated instances to chart a pattern.</EmptyNote>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Bar dataKey="mother" stackId="a" fill={PARENT_COLORS.mother} name="With mother" />
                <Bar dataKey="father" stackId="a" fill={PARENT_COLORS.father} name="With father" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      {/* The pattern-of-absence core — emphasized. */}
      <Panel
        title="Missed & Cancelled Visits"
        subtitle="Cancellations, no-shows, reschedule requests, and declined time"
        accent
      >
        {report.missed_or_cancelled.length === 0 ? (
          <EmptyNote>No missed or cancelled visits were identified in the messages.</EmptyNote>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <ChartCaption>Missed / cancelled per month</ChartCaption>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={missedTime}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill={MISSED_COLOR} radius={[3, 3, 0, 0]} name="Missed / cancelled" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <ChartCaption>By type</ChartCaption>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={missedTypes} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="type" width={104} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill={MISSED_COLOR} radius={[0, 3, 3, 0]} name="Count" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="mt-4 max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {report.missed_or_cancelled.map((m, i) => (
                <EvidenceRow
                  key={i}
                  date={m.date}
                  badge={<Badge text={m.kind.replace(/_/g, " ")} className={MISSED_BADGE} />}
                  description={m.description}
                  quote={m.quote}
                  sender={m.sender}
                />
              ))}
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="Communication Gaps"
        subtitle="Stretches with no outreach about the children"
      >
        {report.communication_gaps.length === 0 ? (
          <EmptyNote>No notable communication gaps were identified.</EmptyNote>
        ) : (
          <div className="space-y-1.5">
            {report.communication_gaps.map((g, i) => (
              <div key={i} className="rounded-md border border-slate-100 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-500">
                    {g.start_date} → {g.end_date}
                  </span>
                  <Badge text={`${g.days} days`} className={MISSED_BADGE} />
                </div>
                <p className="mt-1 text-sm text-slate-700">{g.description}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Childcare Instances"
        subtitle="Each instance a child was shown to be in a parent's care"
      >
        {report.childcare_events.length === 0 ? (
          <EmptyNote>No childcare instances were identified.</EmptyNote>
        ) : (
          <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
            {report.childcare_events.map((e, i) => (
              <EvidenceRow
                key={i}
                date={e.date}
                badge={
                  <Badge
                    text={`with ${e.parent}`}
                    className={PARENT_BADGE[e.parent] ?? PARENT_BADGE.unclear}
                  />
                }
                description={e.description}
                quote={e.quote}
                sender={e.sender}
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Parenting Responsibilities"
        subtitle="Medical, school, drop-off/pick-up, emergency contact, activities"
      >
        {report.responsibility_events.length === 0 ? (
          <EmptyNote>No responsibility events were identified in the messages.</EmptyNote>
        ) : (
          <>
            <div className="mb-4">
              <ChartCaption>Who handled each responsibility</ChartCaption>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={responsibilities}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="category" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="mother" stackId="r" fill={PARENT_COLORS.mother} name={`With ${meta.user_role}`} />
                  <Bar dataKey="father" stackId="r" fill={PARENT_COLORS.father} name="With father" />
                  <Bar dataKey="shared" stackId="r" fill={PARENT_COLORS.shared} name="Shared" />
                  <Bar dataKey="unclear" stackId="r" fill={PARENT_COLORS.unclear} name="Unclear" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {report.responsibility_events.map((r, i) => (
                <EvidenceRow
                  key={i}
                  date={r.date}
                  badge={
                    <span className="flex shrink-0 gap-1">
                      <Badge text={r.category.replace(/_/g, " ")} className={CATEGORY_BADGE} />
                      <Badge
                        text={r.responsible_party}
                        className={PARENT_BADGE[r.responsible_party] ?? PARENT_BADGE.unclear}
                      />
                    </span>
                  }
                  description={r.description}
                  quote={r.quote}
                  sender={r.sender}
                />
              ))}
            </div>
          </>
        )}
      </Panel>

      <Panel
        title="Third-Party Statements"
        subtitle="Messages from others that corroborate caregiving"
      >
        {report.third_party_statements.length === 0 ? (
          <EmptyNote>No third-party statements were identified.</EmptyNote>
        ) : (
          <div className="space-y-1.5">
            {report.third_party_statements.map((t, i) => (
              <EvidenceRow
                key={i}
                date={t.date}
                badge={<Badge text={t.source} className="bg-slate-100 text-slate-600 ring-slate-200" />}
                description={t.description}
                quote={t.quote}
                sender={t.source}
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Tone of Co-Parenting Communications">
        <p className="text-sm text-slate-700">{report.sentiment_overview}</p>
      </Panel>

      <Panel title="Limitations & Caveats">
        <ul className="space-y-1.5">
          {report.limitations.map((l, i) => (
            <li key={i} className="flex gap-2 text-sm text-slate-600">
              <span className="mt-0.5 text-amber-500">▲</span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
