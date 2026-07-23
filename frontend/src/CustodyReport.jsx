/**
 * CustodyReport — renders the output of the backend /custody-report endpoint.
 *
 * Every event is shown with its verbatim source quote and date so it can be
 * traced back to the original message. Section-specific charts surface the
 * patterns relevant to the case. This view is an organizational aid for the
 * parent and their attorney — not legal advice or court-ready evidence on
 * its own. Charts share datasets with the PDF renderer for consistency.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { pdf } from "@react-pdf/renderer";
import Timeline from "./Timeline.jsx";
import CustodyReportPDF from "./CustodyReportPDF.jsx";
import { generateCustodyWorkbookBlob } from "./custodyWorkbook.js";
import {
  carePatternData,
  custodySplitData,
  missedByMonthAndTypeData,
  MISSED_TYPES,
  RESPONSIBILITY_LABELS,
} from "./chartData.js";
import { buildReportInsights, conciseOverview, toneByYear } from "./reportInsights.js";
import {
  requiredForms,
  FORM_EVIDENCE,
  EVIDENCE_LABELS,
} from "./custodyForms.js";

const usd = (n) =>
  `$${Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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

// Tone labels, coloured so a year's read is scannable at a glance.
const TONE_TEXT = {
  positive: "text-emerald-600",
  neutral: "text-slate-500",
  negative: "text-rose-600",
};
const MISSED_BADGE = "bg-rose-100 text-rose-700 ring-rose-200";
const CATEGORY_BADGE = "bg-sky-100 text-sky-700 ring-sky-200";


// Shared chart styling for a clean, consistent, professional look.
const AXIS = {
  tick: { fontSize: 11, fill: "#64748b" },
  tickLine: false,
  axisLine: { stroke: "#e2e8f0" },
};
const GRID = { strokeDasharray: "2 4", stroke: "#eef2f6", vertical: false };
const TOOLTIP = {
  contentStyle: {
    fontSize: 12,
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    boxShadow: "0 4px 12px rgba(15,23,42,0.08)",
  },
  cursor: { fill: "rgba(99,102,241,0.06)" },
};
const LEGEND = { fontSize: 12, paddingTop: 6 };

/**
 * Angled tick for month axes — keeps every "YYYY-Mon" label readable even
 * when a multi-year history packs many months onto one axis.
 */
function MonthTick({ x, y, payload }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        dy={9}
        textAnchor="end"
        transform="rotate(-40)"
        fontSize={11}
        fill="#64748b"
      >
        {payload.value}
      </text>
    </g>
  );
}

// Props for an X axis of month labels — all ticks shown, angled, with room.
const MONTH_X = { interval: 0, height: 56, tick: <MonthTick /> };

function Panel({ title, subtitle, accent, children }) {
  return (
    <section
      className={`rounded-2xl bg-white p-6 shadow-md shadow-indigo-100/30 ring-1 ${
        accent ? "ring-rose-200" : "ring-slate-200"
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

/** 100%-proportion bar — clean, precise, no clipped labels (unlike a pie). */
function ProportionBar({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return <EmptyNote>No childcare instances were identified.</EmptyNote>;
  }
  const pct = (v) => Math.round((v / total) * 100);
  return (
    <div>
      <div className="flex h-9 overflow-hidden rounded-lg ring-1 ring-slate-200">
        {data.map((d) => (
          <div
            key={d.key}
            style={{ flexGrow: d.value, flexBasis: 0, backgroundColor: PARENT_COLORS[d.key] }}
            className="flex items-center justify-center"
          >
            {pct(d.value) >= 10 && (
              <span className="text-xs font-bold text-white">{pct(d.value)}%</span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {data.map((d) => (
          <span key={d.key} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: PARENT_COLORS[d.key] }}
            />
            {d.label}: <span className="font-semibold text-slate-800">{d.value}</span> (
            {pct(d.value)}%)
          </span>
        ))}
      </div>
    </div>
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

/** A single headline figure, optionally tinted to a parent's colour. */
function Stat({ label, value, color }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-center shadow-sm">
      <div className="text-xl font-bold" style={color ? { color } : undefined}>
        <span className={color ? "" : "text-slate-800"}>{value}</span>
      </div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

/** Bar-end label for the themes chart: total + mother/father share. */
function ThemeCountLabel({ x, y, width, height, index, data }) {
  const row = data[index] || {};
  const mf = (row.mother || 0) + (row.father || 0);
  const mPct = mf > 0 ? Math.round(((row.mother || 0) / mf) * 100) : 0;
  return (
    <text
      x={x + width + 6}
      y={y + height / 2}
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
    >
      <tspan fill="#334155">{row.total ?? 0}</tspan>
      {mf > 0 ? (
        <>
          <tspan fill="#cbd5e1"> · </tspan>
          <tspan fill={PARENT_COLORS.mother}>{mPct}%</tspan>
          <tspan fill="#cbd5e1">/</tspan>
          <tspan fill={PARENT_COLORS.father}>{100 - mPct}%</tspan>
        </>
      ) : null}
    </text>
  );
}

/** A party name tinted to the parent, or a dash when unattributed. */
function PartyText({ party, role }) {
  if (party === "mother") {
    return <span style={{ color: PARENT_COLORS.mother }}>{role || "mother"}</span>;
  }
  if (party === "father") {
    return <span style={{ color: PARENT_COLORS.father }}>father</span>;
  }
  if (party === "shared") {
    return <span style={{ color: PARENT_COLORS.shared }}>shared</span>;
  }
  return <span className="text-slate-300">—</span>;
}

function ChartCaption({ children }) {
  return <p className="mb-1 text-xs font-medium text-slate-500">{children}</p>;
}

/**
 * Radar axis tick — shows the category name and, beneath it, each parent's
 * share of THAT category's instances (mother in indigo, father in orange).
 * `data` is the radar dataset so the tick can look up its row by index.
 */
function RadarCategoryTick({ x, y, textAnchor, payload, data }) {
  const row = data[payload.index] || {};
  return (
    <text x={x} y={y} textAnchor={textAnchor} fill="#475569">
      <tspan fontSize={11}>{payload.value}</tspan>
      <tspan x={x} dy="1.2em" fontSize={9} fontWeight={600}>
        <tspan fill={PARENT_COLORS.mother}>{row.motherPct ?? 0}%</tspan>
        <tspan fill="#cbd5e1"> · </tspan>
        <tspan fill={PARENT_COLORS.father}>{row.fatherPct ?? 0}%</tspan>
      </tspan>
    </text>
  );
}

/**
 * Bar-end label for the responsibilities chart — each parent's share of that
 * category's instances. Rendered as LabelList custom content so the two
 * percentages can be color-coded to match the parent series.
 */
function ParentSplitLabel({ x, y, width, height, index, data }) {
  const row = data[index] || {};
  return (
    <text
      x={x + width + 6}
      y={y + height / 2}
      dominantBaseline="central"
      fontSize={11}
      fontWeight={600}
    >
      <tspan fill={PARENT_COLORS.mother}>{row.motherPct ?? 0}%</tspan>
      <tspan fill="#cbd5e1"> · </tspan>
      <tspan fill={PARENT_COLORS.father}>{row.fatherPct ?? 0}%</tspan>
    </text>
  );
}

const SOURCE_TAG = {
  email: { label: "Email", className: "bg-violet-100 text-violet-700" },
  text: { label: "Text", className: "bg-sky-100 text-sky-700" },
  document: { label: "Document", className: "bg-emerald-100 text-emerald-700" },
  unclear: { label: "Source unclear", className: "bg-slate-100 text-slate-500" },
};

/** Small pill identifying whether an item came from a text message or email. */
function SourceTag({ channel }) {
  const t = SOURCE_TAG[channel];
  if (!t) return null;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${t.className}`}>
      {t.label}
    </span>
  );
}

/** One traceable event: date, source, label, description, and the verbatim message. */
function EvidenceRow({ date, channel, badge, description, quote, sender }) {
  return (
    <div className="rounded-md border border-slate-100 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">{date || "date unclear"}</span>
          <SourceTag channel={channel} />
        </span>
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
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const [xlsxError, setXlsxError] = useState("");

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadPdf() {
    setPdfBusy(true);
    setPdfError("");
    try {
      const blob = await pdf(<CustodyReportPDF data={data} />).toBlob();
      saveBlob(blob, `custodia-report-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      setPdfError(err?.message || "Could not generate the PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  async function downloadXlsx() {
    setXlsxBusy(true);
    setXlsxError("");
    try {
      const blob = await generateCustodyWorkbookBlob(data);
      saveBlob(blob, `custodia-evidence-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      setXlsxError(err?.message || "Could not generate the Excel file.");
    } finally {
      setXlsxBusy(false);
    }
  }

  // Chart datasets — shared with the PDF renderer so the numbers match.
  const splitData = custodySplitData(cb);
  const monthly = carePatternData(report);
  const missedMonthly = missedByMonthAndTypeData(report);
  const missedPresentTypes = MISSED_TYPES.filter((t) =>
    missedMonthly.some((r) => r[t.key] > 0),
  );
  // Everything derived comes from the shared insights model, so this view and
  // the downloadable PDF always state the same numbers.
  const {
    expenses: expensesRefed,
    fin,
    finFindings,
    finSolePayer,
    finPayerLabel,
    finTotalShown,
    missed,
    responsibilities,
    radarData,
    respThemes,
    medical,
    medSummary,
    care,
    thirdParty,
    findings,
    sca106,
    scaNeedsAttribution,
    parentCompare,
  } = buildReportInsights(data);
  const finPayerColor =
    finSolePayer === "father" ? PARENT_COLORS.father : PARENT_COLORS.mother;
  const toneYears = toneByYear(report);
  const overviewText = conciseOverview(report.overview);

  // WV SCA-FC-106 Financial Statement worksheet — child-related expense
  // averages by category, plus optional % of income. Only renders when WV
  // is the filing state and there's something to populate.

  // WV filing-form packet — derived from the intake answers echoed in meta.
  const caseProfile = meta.case_profile || {};
  const hasCaseProfile = Object.keys(caseProfile).length > 0;
  const requiredFormList = hasCaseProfile ? requiredForms(caseProfile) : [];
  const jur = meta.jurisdiction || {};
  const jurLabel = jur.county
    ? `${jur.county} County, ${jur.state || "West Virginia"}`
    : null;
  const evidenceCount = {
    childcare: report.childcare_events.length,
    missed: report.missed_or_cancelled.length,
    gaps: report.communication_gaps.length,
    responsibilities: report.responsibility_events.length,
    thirdparty: report.third_party_statements.length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-slate-800">
            Care, Responsibility &amp; Expense Report
          </h2>
          {data.edited && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              Regenerated from your edited workbook
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <button
              onClick={downloadPdf}
              disabled={pdfBusy}
              className="rounded-full bg-gradient-to-r from-rose-600 to-rose-500 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-rose-200 transition hover:from-rose-700 hover:to-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pdfBusy ? "Generating PDF…" : "Download PDF Report"}
            </button>
            <button
              onClick={downloadXlsx}
              disabled={xlsxBusy}
              className="rounded-full bg-gradient-to-r from-emerald-600 to-emerald-500 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-200 transition hover:from-emerald-700 hover:to-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {xlsxBusy ? "Building Excel…" : "Download Evidence (Excel)"}
            </button>
          </div>
          {pdfError && <span className="text-xs text-red-600">{pdfError}</span>}
          {xlsxError && <span className="text-xs text-red-600">{xlsxError}</span>}
        </div>
      </div>

      {meta.windows > 1 && (
        <p className="-mt-4 text-xs text-slate-400">
          Large history — analyzed in {meta.windows} time windows and merged into
          this report.
        </p>
      )}

      {meta.filter && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-2.5 text-xs text-indigo-800">
          <span className="font-semibold">Smart filter applied.</span>{" "}
          Scanned {meta.filter.scanned.toLocaleString()} messages;{" "}
          {meta.filter.flagged_relevant.toLocaleString()} flagged as
          custody-relevant and analyzed in detail
          {meta.filter.analyzed_with_context
            ? ` (${meta.filter.analyzed_with_context.toLocaleString()} incl. surrounding context)`
            : ""}
          . The full message log is in the appendix; the filter is recall-biased
          (keeps anything plausibly relevant). Turn it off to analyze every
          message.
        </div>
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
        <p className="text-sm text-slate-700">{overviewText.text}</p>
        {overviewText.truncated && (
          <p className="mt-2 text-xs text-slate-400">
            Condensed — the full narrative is in the evidence workbook&rsquo;s
            Summary tab; the bullets below carry the key findings.
          </p>
        )}
        {parentCompare && (
          <div className="mt-4 overflow-x-auto">
            <p className="mb-1 text-xs font-medium text-slate-500">
              Side by side — counts from the evidence in this report, not
              judgments
            </p>
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs">
                  <th className="w-40 py-1 text-left font-semibold text-slate-500"></th>
                  <th
                    className="py-1 text-left font-semibold"
                    style={{ color: PARENT_COLORS.mother }}
                  >
                    {meta.user_role}
                  </th>
                  <th
                    className="py-1 text-left font-semibold"
                    style={{ color: PARENT_COLORS.father }}
                  >
                    Father
                  </th>
                </tr>
              </thead>
              <tbody>
                {parentCompare.rows.map((r) => (
                  <tr key={r.key} className="border-b border-slate-50 align-top">
                    <td className="py-1.5 pr-2 text-xs font-semibold text-slate-500">
                      {r.dim}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-700">
                      <span className="mr-1 text-indigo-400">•</span>
                      {parentCompare.mother[r.key]}
                    </td>
                    <td className="py-1.5 text-slate-700">
                      <span className="mr-1 text-orange-400">•</span>
                      {parentCompare.father[r.key]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* The shape of the case up front — same findings as the PDF. */}
      {findings.length > 0 && (
        <Panel
          title="At a Glance"
          subtitle="Computed from the evidence in this report — every figure is supported by the sections below and the evidence workbook"
        >
          <ul className="space-y-2">
            {findings.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm text-slate-700">
                <span className="mt-0.5 text-amber-500">•</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {hasCaseProfile && (
        <Panel
          title="Required WV Filing Forms"
          subtitle={
            jurLabel
              ? `Form packet to file with the Family Court in ${jurLabel} — with the supporting evidence in this report`
              : "The form packet for this case, with the report evidence that supports each"
          }
        >
          <ul className="space-y-2">
            {requiredFormList.map((f) => {
              const ev = FORM_EVIDENCE[f.id] || [];
              return (
                <li
                  key={f.id}
                  className="rounded-md border border-slate-100 px-3 py-2"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Badge
                      text={f.number}
                      className="bg-indigo-100 text-indigo-700 ring-indigo-200"
                    />
                    <span className="text-sm font-medium text-slate-700">
                      {f.title}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{f.reason}</p>
                  {ev.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      <span className="font-medium">Supporting evidence:</span>{" "}
                      {ev
                        .map((k) =>
                          evidenceCount[k] != null
                            ? `${EVIDENCE_LABELS[k]} (${evidenceCount[k]})`
                            : EVIDENCE_LABELS[k],
                        )
                        .join(", ")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-slate-400">
            File the completed packet with the Circuit Clerk / Family Court in
            the county where the child lives. This list is an organizational
            aid — confirm the current forms with the court or your attorney.
          </p>
        </Panel>
      )}

      {/* "Suggestions" is intentionally omitted here and in the PDF — the full
          list is a tab in the evidence workbook. */}

      <Panel
        title="Event Timeline"
        subtitle="Instances per month by parent, with trend, gaps and milestones — one chart per year"
      >
        <Timeline
          report={report}
          transcript={data.transcript}
          userRole={meta.user_role}
        />
      </Panel>

      {/* Custody Split, then Care Pattern full-width directly underneath —
          the monthly pattern needs the horizontal room to be readable. */}
      <Panel title="Custody Split" subtitle="Share of childcare instances">
        <ProportionBar data={splitData} />
        <p className="mt-3 text-xs text-slate-400">{report.breakdown_basis}</p>
      </Panel>

      <Panel title="Care Pattern Over Time" subtitle="Childcare instances per month">
        {monthly.length === 0 ? (
          <EmptyNote>Not enough dated instances to chart a pattern.</EmptyNote>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthly} barCategoryGap="20%">
              <CartesianGrid {...GRID} />
              <XAxis {...AXIS} {...MONTH_X} dataKey="month" />
              <YAxis {...AXIS} allowDecimals={false} width={28} />
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={LEGEND} />
              <Bar dataKey="mother" stackId="a" fill={PARENT_COLORS.mother} name="With mother" />
              <Bar
                dataKey="father"
                stackId="a"
                fill={PARENT_COLORS.father}
                name="With father"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
        {care.total > 0 && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total childcare instances" value={care.total} />
              <Stat
                label={`With ${meta.user_role}`}
                value={care.byParty.mother}
                color={PARENT_COLORS.mother}
              />
              <Stat
                label="With father"
                value={care.byParty.father}
                color={PARENT_COLORS.father}
              />
              <Stat
                label="Busiest year"
                value={care.busiest ? `${care.busiest.year} (${care.busiest.total})` : "—"}
              />
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[380px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-1 text-left font-semibold">Year</th>
                    <th className="py-1 text-right font-semibold">Total</th>
                    <th className="py-1 text-right font-semibold" style={{ color: PARENT_COLORS.mother }}>
                      {meta.user_role}
                    </th>
                    <th className="py-1 text-right font-semibold" style={{ color: PARENT_COLORS.father }}>
                      Father
                    </th>
                    <th className="py-1 text-right font-semibold">Shared</th>
                  </tr>
                </thead>
                <tbody>
                  {care.byYear.map((y) => (
                    <tr key={y.year} className="border-b border-slate-50">
                      <td className="py-1 text-slate-700">{y.year}</td>
                      <td className="py-1 text-right text-slate-800">{y.total}</td>
                      <td className="py-1 text-right" style={{ color: PARENT_COLORS.mother }}>{y.mother}</td>
                      <td className="py-1 text-right" style={{ color: PARENT_COLORS.father }}>{y.father}</td>
                      <td className="py-1 text-right text-slate-500">{y.shared}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

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
            <ChartCaption>
              Missed / cancelled visits per month, by type
            </ChartCaption>
            <ResponsiveContainer width="100%" height={290}>
              <BarChart data={missedMonthly} barCategoryGap="20%">
                <CartesianGrid {...GRID} />
                <XAxis {...AXIS} {...MONTH_X} dataKey="month" />
                <YAxis {...AXIS} allowDecimals={false} width={28} />
                <Tooltip {...TOOLTIP} />
                <Legend wrapperStyle={LEGEND} />
                {missedPresentTypes.map((t, i) => (
                  <Bar
                    key={t.key}
                    dataKey={t.key}
                    stackId="missed"
                    fill={t.color}
                    name={t.label}
                    radius={
                      i === missedPresentTypes.length - 1
                        ? [3, 3, 0, 0]
                        : undefined
                    }
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
            {/* Summarized across the timespan; every row is in the
                evidence workbook. */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total missed / cancelled" value={missed.total} />
              {missed.hasParty ? (
                <>
                  <Stat
                    label={`By ${meta.user_role}`}
                    value={missed.byParty.mother}
                    color={PARENT_COLORS.mother}
                  />
                  <Stat
                    label="By father"
                    value={missed.byParty.father}
                    color={PARENT_COLORS.father}
                  />
                  {missed.byParty.unclear > 0 && (
                    <Stat label="Unattributed" value={missed.byParty.unclear} />
                  )}
                </>
              ) : (
                <Stat label="Years affected" value={missed.byYear.length} />
              )}
            </div>
            {!missed.hasParty && (
              <p className="mt-2 text-xs text-slate-400">
                Per-parent attribution is available on reports generated after
                this feature was added — re-run the analysis to split these by
                parent.
              </p>
            )}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <ChartCaption>By type — whole period</ChartCaption>
                <ul className="space-y-1">
                  {missed.byType.map((t) => (
                    <li key={t.kind} className="flex justify-between text-sm">
                      <span className="text-slate-700">{t.label}</span>
                      <span className="font-semibold text-slate-800">
                        {t.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <ChartCaption>
                  By year{missed.hasParty ? " and parent" : ""}
                </ChartCaption>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="py-1 text-left font-semibold">Year</th>
                      <th className="py-1 text-right font-semibold">Total</th>
                      {missed.hasParty && (
                        <th
                          className="py-1 text-right font-semibold"
                          style={{ color: PARENT_COLORS.mother }}
                        >
                          {meta.user_role}
                        </th>
                      )}
                      {missed.hasParty && (
                        <th
                          className="py-1 text-right font-semibold"
                          style={{ color: PARENT_COLORS.father }}
                        >
                          Father
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {missed.byYear.map((y) => (
                      <tr key={y.year} className="border-b border-slate-50">
                        <td className="py-1 text-slate-700">{y.year}</td>
                        <td className="py-1 text-right text-slate-800">
                          {y.total}
                        </td>
                        {missed.hasParty && (
                          <td
                            className="py-1 text-right"
                            style={{ color: PARENT_COLORS.mother }}
                          >
                            {y.mother}
                          </td>
                        )}
                        {missed.hasParty && (
                          <td
                            className="py-1 text-right"
                            style={{ color: PARENT_COLORS.father }}
                          >
                            {y.father}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </Panel>

      {/* "Communication Gaps" and "Childcare Instances" row lists are
          intentionally omitted here and in the PDF — both are tabs in the
          evidence workbook, and the gaps also appear on the timeline. */}

      <Panel
        title="Responsibility Coverage"
        subtitle={`${meta.user_role} vs. father across all court-recognized categories`}
      >
        <ChartCaption>
          Each axis shows{" "}
          <span style={{ color: PARENT_COLORS.mother }}>mother %</span>
          {" · "}
          <span style={{ color: PARENT_COLORS.father }}>father %</span> — each
          parent&rsquo;s share of that category&rsquo;s instances
        </ChartCaption>
        <ResponsiveContainer width="100%" height={360}>
          <RadarChart data={radarData} outerRadius="68%">
            <PolarGrid stroke="#e2e8f0" />
            <PolarAngleAxis
              dataKey="category"
              tick={(props) => <RadarCategoryTick {...props} data={radarData} />}
            />
            {/* Radius scale hidden — the per-category % labels carry the
                numbers, and the axis ticks otherwise overlap the polygon. */}
            <PolarRadiusAxis tick={false} axisLine={false} />
            <Radar
              name={`With ${meta.user_role}`}
              dataKey="mother"
              stroke={PARENT_COLORS.mother}
              fill={PARENT_COLORS.mother}
              fillOpacity={0.3}
            />
            <Radar
              name="With father"
              dataKey="father"
              stroke={PARENT_COLORS.father}
              fill={PARENT_COLORS.father}
              fillOpacity={0.3}
            />
            <Legend wrapperStyle={LEGEND} />
            <Tooltip {...TOOLTIP} />
          </RadarChart>
        </ResponsiveContainer>

        {report.responsibility_events.length === 0 ? (
          <EmptyNote>No responsibility events were identified in the messages.</EmptyNote>
        ) : (
          <>
            <div className="mt-6">
              <ChartCaption>
                Who handled each court-recognized category —{" "}
                <span style={{ color: PARENT_COLORS.mother }}>mother %</span>
                {" · "}
                <span style={{ color: PARENT_COLORS.father }}>father %</span>{" "}
                is each parent&rsquo;s share of that category&rsquo;s instances
              </ChartCaption>
              <ResponsiveContainer
                width="100%"
                height={Math.max(200, responsibilities.length * 38 + 52)}
              >
                <BarChart
                  data={responsibilities}
                  layout="vertical"
                  margin={{ left: 4, right: 60 }}
                >
                  <CartesianGrid {...GRID} vertical horizontal={false} />
                  <XAxis {...AXIS} type="number" allowDecimals={false} />
                  <YAxis
                    {...AXIS}
                    tick={{ fontSize: 10, fill: "#475569" }}
                    type="category"
                    dataKey="full"
                    width={150}
                  />
                  <Tooltip {...TOOLTIP} />
                  <Legend wrapperStyle={LEGEND} />
                  <Bar dataKey="mother" stackId="r" fill={PARENT_COLORS.mother} name={`With ${meta.user_role}`} barSize={17} />
                  <Bar dataKey="father" stackId="r" fill={PARENT_COLORS.father} name="With father" barSize={17} />
                  <Bar dataKey="shared" stackId="r" fill={PARENT_COLORS.shared} name="Shared" barSize={17} />
                  <Bar
                    dataKey="unclear"
                    stackId="r"
                    fill={PARENT_COLORS.unclear}
                    name="Unclear"
                    barSize={17}
                    radius={[0, 3, 3, 0]}
                  >
                    <LabelList
                      content={(p) => (
                        <ParentSplitLabel {...p} data={responsibilities} />
                      )}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Panel>

      {/* The qualitative picture — the court taxonomy buries it in free-text
          "Other" entries, so themes are pulled back out and attributed. */}
      {respThemes.length > 0 && (
        <Panel
          title="Co-Parenting Themes — Per-Parent Picture"
          subtitle={`Cross-cutting themes from every responsibility entry (including the free-text "Other" items), each backed by a quote`}
        >
          <ChartCaption>
            Instances mentioning each theme —{" "}
            <span style={{ color: PARENT_COLORS.mother }}>{meta.user_role}</span>
            {" · "}
            <span style={{ color: PARENT_COLORS.father }}>father</span>
          </ChartCaption>
          <ResponsiveContainer
            width="100%"
            height={Math.max(200, respThemes.length * 26 + 52)}
          >
            <BarChart data={respThemes} layout="vertical" barCategoryGap="22%" margin={{ right: 90 }}>
              <CartesianGrid {...GRID} horizontal={false} />
              <XAxis {...AXIS} type="number" allowDecimals={false} />
              <YAxis
                {...AXIS}
                type="category"
                dataKey="label"
                width={150}
                tick={{ fontSize: 11, fill: "#475569" }}
              />
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={LEGEND} />
              <Bar dataKey="mother" stackId="t" fill={PARENT_COLORS.mother} name="Mother" barSize={14} />
              <Bar dataKey="father" stackId="t" fill={PARENT_COLORS.father} name="Father" barSize={14} />
              <Bar dataKey="shared" stackId="t" fill={PARENT_COLORS.shared} name="Shared" barSize={14} />
              <Bar
                dataKey="unclear"
                stackId="t"
                fill={PARENT_COLORS.unclear}
                name="Unclear"
                barSize={14}
                radius={[0, 3, 3, 0]}
              >
                <LabelList
                  content={(props) => (
                    <ThemeCountLabel {...props} data={respThemes} />
                  )}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-4 space-y-3">
            {respThemes.map((t) => (
              <div key={t.key} className="rounded-md border border-slate-100 px-3 py-2">
                <div className="text-sm font-semibold text-slate-800">
                  {t.label}
                  {" — "}
                  <span style={{ color: PARENT_COLORS.mother }}>
                    {meta.user_role} {t.mother}
                  </span>
                  {" · "}
                  <span style={{ color: PARENT_COLORS.father }}>
                    father {t.father}
                  </span>
                  {t.shared ? ` · shared ${t.shared}` : ""}
                  {t.unclear ? ` · unclear ${t.unclear}` : ""}
                </div>
                {["mother", "father"].map((party) =>
                  t.exemplars[party] ? (
                    <p key={party} className="mt-1 text-xs italic text-slate-500">
                      {party === "father" ? "Father" : meta.user_role}: &ldquo;
                      {t.exemplars[party].text}&rdquo;
                      {t.exemplars[party].date
                        ? ` (${t.exemplars[party].date})`
                        : ""}
                    </p>
                  ) : null,
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Medical appointment register — role-level attribution when the
          analysis captured it, otherwise the honest combined view. */}
      {medical.rows.length > 0 && (
        <Panel
          title="Medical Appointments"
          subtitle={
            medical.derived
              ? `${medical.rows.length} on record — this report predates per-role capture, so it shows the one party each entry names as handling it; re-run the analysis to split planned / scheduled / took`
              : `${medical.rows.length} on record — who planned it, who booked it, who took the child, and who paid`
          }
        >
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Appointments" value={medSummary.total} />
            <Stat
              label={medical.derived ? `Handled by ${meta.user_role}` : `Taken by ${meta.user_role}`}
              value={
                medical.derived
                  ? medSummary.roleTally.handled?.mother ?? 0
                  : medSummary.roleTally.took?.mother ?? 0
              }
              color={PARENT_COLORS.mother}
            />
            <Stat
              label={medical.derived ? "Handled by father" : "Taken by father"}
              value={
                medical.derived
                  ? medSummary.roleTally.handled?.father ?? 0
                  : medSummary.roleTally.took?.father ?? 0
              }
              color={PARENT_COLORS.father}
            />
            <Stat
              label="Documented spend"
              value={medSummary.spend > 0 ? usd(medSummary.spend) : "—"}
            />
          </div>
          <ChartCaption>
            Appointments by type — split by the acting parent
            {medSummary.byChild.some((c) => c.child !== "Unspecified")
              ? " · children: " +
                medSummary.byChild.map((c) => `${c.child} (${c.count})`).join(", ")
              : ""}
          </ChartCaption>
          <ResponsiveContainer
            width="100%"
            height={Math.max(140, Math.min(20, medSummary.byType.length) * 30 + 50)}
          >
            <BarChart
              data={medSummary.byType.slice(0, 20)}
              layout="vertical"
              barCategoryGap="24%"
              margin={{ right: 40 }}
            >
              <CartesianGrid {...GRID} vertical horizontal={false} />
              <XAxis {...AXIS} type="number" allowDecimals={false} />
              <YAxis
                {...AXIS}
                type="category"
                dataKey="type"
                width={150}
                tick={{ fontSize: 10, fill: "#475569" }}
              />
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={LEGEND} />
              <Bar dataKey="mother" stackId="m" fill={PARENT_COLORS.mother} name={meta.user_role} barSize={14} />
              <Bar dataKey="father" stackId="m" fill={PARENT_COLORS.father} name="Father" barSize={14} />
              <Bar dataKey="unclear" stackId="m" fill={PARENT_COLORS.unclear} name="Unclear" barSize={14} radius={[0, 3, 3, 0]}>
                <LabelList dataKey="total" position="right" style={{ fontSize: 11, fill: "#334155", fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {medSummary.byType.length > 20 && (
            <p className="mt-1 text-xs text-slate-400">
              Showing the top 20 appointment types of {medSummary.byType.length}.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-400">
            The full register — date, child, provider, and who planned,
            scheduled, took and paid per appointment — is the &ldquo;Medical
            Appointments&rdquo; tab in the evidence workbook, with a
            role-by-parent cross-tab in &ldquo;Pivot - Medical Roles&rdquo;.
          </p>
        </Panel>
      )}

      {fin.hasExpenses && (
        <Panel
          title={`Financial Contribution${finSolePayer ? ` — ${finPayerLabel}` : ""}`}
          subtitle={`${usd(finTotalShown)} in child-related expenses${
            fin.period ? ` from ${fin.period.start} to ${fin.period.end}` : ""
          }${
            finSolePayer
              ? ` · every document on file is ${finPayerLabel}'s payment`
              : ""
          }`}
        >
          {/* Headline totals — mirrors the PDF's stat row. */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label={finSolePayer ? `Paid by ${finPayerLabel}` : "Total tracked"}
              value={usd(finTotalShown)}
              color={finSolePayer ? finPayerColor : undefined}
            />
            <Stat label="Categories" value={fin.by_category_sub.length} />
            <Stat label="Receipts / payments" value={expensesRefed.length} />
          </div>

          {/* Spend share by court category. */}
          {fin.by_category.length > 0 && (
            <div className="mb-6">
              <ChartCaption>
                {finSolePayer ? (
                  <>
                    Dollars spent per court-recognized category — all paid by{" "}
                    <span style={{ color: finPayerColor }}>{finPayerLabel}</span>
                  </>
                ) : (
                  <>
                    Dollars spent per category —{" "}
                    <span style={{ color: PARENT_COLORS.mother }}>
                      {meta.user_role}
                    </span>
                    {" vs. "}
                    <span style={{ color: PARENT_COLORS.father }}>father</span>
                  </>
                )}
              </ChartCaption>
              <ResponsiveContainer
                width="100%"
                height={Math.max(200, fin.by_category.length * 38 + 52)}
              >
                <BarChart
                  data={fin.by_category}
                  layout="vertical"
                  margin={{ left: 4, right: 60 }}
                >
                  <CartesianGrid {...GRID} vertical horizontal={false} />
                  <XAxis
                    {...AXIS}
                    type="number"
                    tickFormatter={(v) => `$${v.toLocaleString()}`}
                  />
                  <YAxis
                    {...AXIS}
                    tick={{ fontSize: 10, fill: "#475569" }}
                    type="category"
                    dataKey="label"
                    width={150}
                  />
                  <Tooltip
                    {...TOOLTIP}
                    formatter={(v) => usd(v)}
                  />
                  <Legend wrapperStyle={LEGEND} />
                  <Bar
                    dataKey="totals.mother"
                    stackId="$"
                    fill={PARENT_COLORS.mother}
                    name={`With ${meta.user_role}`}
                    barSize={17}
                  />
                  <Bar
                    dataKey="totals.father"
                    stackId="$"
                    fill={PARENT_COLORS.father}
                    name="With father"
                    barSize={17}
                  />
                  <Bar
                    dataKey="totals.shared"
                    stackId="$"
                    fill={PARENT_COLORS.shared}
                    name="Shared"
                    barSize={17}
                  />
                  <Bar
                    dataKey="totals.unclear"
                    stackId="$"
                    fill={PARENT_COLORS.unclear}
                    name="Unclear"
                    barSize={17}
                    radius={[0, 3, 3, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* One chart per category, broken down by sub-category — the
              detail the single category chart flattens away. */}
          {fin.by_category_sub.map((c) => (
            <div key={c.key} className="mb-6">
              <ChartCaption>
                {c.label} —{" "}
                {usd(finSolePayer ? c.totals[finSolePayer] || 0 : c.grand_total)}
                {" across "}
                {c.expense_count} payment{c.expense_count === 1 ? "" : "s"} · by
                sub-category
              </ChartCaption>
              <ResponsiveContainer
                width="100%"
                height={Math.max(120, c.subs.length * 30 + 44)}
              >
                <BarChart
                  data={c.subs.map((sub) => ({
                    subcategory: sub.subcategory,
                    amount: finSolePayer
                      ? sub[finSolePayer] || 0
                      : sub.grand_total,
                  }))}
                  layout="vertical"
                  margin={{ left: 4, right: 60 }}
                >
                  <CartesianGrid {...GRID} vertical horizontal={false} />
                  <XAxis
                    {...AXIS}
                    type="number"
                    tickFormatter={(v) => `$${v.toLocaleString()}`}
                  />
                  <YAxis
                    {...AXIS}
                    type="category"
                    dataKey="subcategory"
                    width={150}
                    tick={{ fontSize: 10, fill: "#475569" }}
                  />
                  <Tooltip {...TOOLTIP} formatter={(v) => usd(v)} />
                  <Bar
                    dataKey="amount"
                    fill={finPayerColor}
                    name="Paid"
                    barSize={15}
                    radius={[0, 3, 3, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ))}

          {/* Cumulative contribution over time — running totals per parent. */}
          {fin.cumulative.length > 1 && (
            <div className="mb-6">
              <ChartCaption>
                {finSolePayer
                  ? `Cumulative contribution over time — ${finPayerLabel}'s running total`
                  : "Cumulative contribution over time — running total per parent"}
              </ChartCaption>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart
                  data={fin.cumulative}
                  margin={{ left: 4, right: 16, top: 8, bottom: 8 }}
                >
                  <CartesianGrid {...GRID} />
                  <XAxis {...AXIS} dataKey="date" minTickGap={40} />
                  <YAxis
                    {...AXIS}
                    tickFormatter={(v) => `$${v.toLocaleString()}`}
                  />
                  <Tooltip {...TOOLTIP} formatter={(v) => usd(v)} />
                  <Legend wrapperStyle={LEGEND} />
                  <Line
                    type="monotone"
                    dataKey={finSolePayer || "mother"}
                    stroke={finPayerColor}
                    strokeWidth={2}
                    dot={false}
                    name={finSolePayer ? `Paid by ${finPayerLabel}` : `With ${meta.user_role}`}
                  />
                  {!finSolePayer && (
                    <Line
                      type="monotone"
                      dataKey="father"
                      stroke={PARENT_COLORS.father}
                      strokeWidth={2}
                      dot={false}
                      name="With father"
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Cross-validation findings — claims without receipts, receipts
              without claims. */}
          {finFindings.length > 0 && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-800">
                Cross-validation findings — {finFindings.length}
              </p>
              <p className="mb-2 text-[11px] text-amber-700">
                Inconsistencies between what the messages said and what the
                financial documents prove. Worth following up with counsel.
              </p>
              <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                {finFindings.map((f, i) => (
                  <li key={i} className="text-xs text-amber-900">
                    <span className="font-semibold">
                      {f.kind === "claim_without_receipt"
                        ? "Claim without receipt"
                        : "Receipt without claim"}
                    </span>{" "}
                    · {f.date}
                    {f.refs.length > 0 && (
                      <span className="text-amber-600"> [{f.refs.join(", ")}]</span>
                    )}
                    <span className="block text-amber-800">{f.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}

      {sca106 && (
        <Panel
          title="WV Financial Statement (SCA-FC-106) Worksheet"
          subtitle={`Child-expense lines auto-populated from the receipts and payments — averaged across ${sca106.period.months} months`}
        >
          <p className="mb-3 text-xs text-slate-500">
            The other SCA-FC-106 lines (personal info, deductions, assets,
            debts, general monthly expenses) stay for you and your attorney
            to complete on the official form. These are the figures that are
            hard to compute by hand.
          </p>
          {finSolePayer && (
            <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              Every attributed payment on file is {finPayerLabel}&rsquo;s, so
              unattributed payments are credited to {finPayerLabel} as well —
              the {meta.user_role} / father share columns below are complete
              and ready to transfer to the form.
            </p>
          )}
          {scaNeedsAttribution && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
              The {meta.user_role} / father share columns show $0 because no
              payment could be attributed to a parent. To fill them: add the
              card-lookup mapping (card last-4 → parent) before running, or
              upload payment-app / bank exports that name the payer. The
              totals and monthly averages are still correct.
            </p>
          )}
          <div className="mb-3 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="border-b border-slate-200">
                <tr className="text-left text-slate-500">
                  <th className="py-1.5 pr-3">SCA-FC-106 line</th>
                  <th className="py-1.5 pr-3 text-right">Monthly total</th>
                  <th
                    className="py-1.5 pr-3 text-right"
                    style={{ color: PARENT_COLORS.mother }}
                  >
                    {meta.user_role}
                  </th>
                  <th
                    className="py-1.5 pr-3 text-right"
                    style={{ color: PARENT_COLORS.father }}
                  >
                    father
                  </th>
                  <th className="py-1.5 pr-3 text-right">Share</th>
                  <th className="py-1.5 pr-3 text-right">Period total</th>
                </tr>
              </thead>
              <tbody>
                {sca106.lines.map((row) => (
                  <tr key={row.key} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3">
                      <p className="font-medium text-slate-700">{row.line}</p>
                      <p className="text-[11px] text-slate-400">
                        {row.categories.join(" · ")} · {row.count} expense
                        {row.count === 1 ? "" : "s"}
                      </p>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium text-slate-800">
                      {usd(row.monthly_total)}
                    </td>
                    <td
                      className="py-1.5 pr-3 text-right"
                      style={{ color: PARENT_COLORS.mother }}
                    >
                      {usd(row.monthly_mother)}
                    </td>
                    <td
                      className="py-1.5 pr-3 text-right"
                      style={{ color: PARENT_COLORS.father }}
                    >
                      {usd(row.monthly_father)}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-slate-600">
                      <span style={{ color: PARENT_COLORS.mother }}>
                        {row.mother_share_pct}%
                      </span>
                      {" / "}
                      <span style={{ color: PARENT_COLORS.father }}>
                        {row.father_share_pct}%
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right text-slate-600">
                      {usd(row.total)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                  <td className="py-1.5 pr-3">Total monthly child expenses</td>
                  <td className="py-1.5 pr-3 text-right">
                    {usd(sca106.totals.monthly_child_expenses)}
                  </td>
                  <td
                    className="py-1.5 pr-3 text-right"
                    style={{ color: PARENT_COLORS.mother }}
                  >
                    {usd(sca106.totals.mother_monthly)}
                  </td>
                  <td
                    className="py-1.5 pr-3 text-right"
                    style={{ color: PARENT_COLORS.father }}
                  >
                    {usd(sca106.totals.father_monthly)}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-slate-500">—</td>
                  <td className="py-1.5 pr-3 text-right">
                    {usd(sca106.totals.annual_child_expenses)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {sca106.income && (
            <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs font-semibold text-indigo-800">
                Income context (from the form)
              </p>
              <p className="mt-1 text-xs text-indigo-900">
                Monthly gross income: <strong>{usd(sca106.income.monthly_gross)}</strong>
              </p>
              <p className="text-xs text-indigo-900">
                Monthly child-related expenses are{" "}
                <strong>{sca106.child_expenses_as_pct_of_income}%</strong>{" "}
                of monthly gross income.
              </p>
              <p className="text-xs text-indigo-900">
                Of that, {meta.user_role} is paying{" "}
                <strong>
                  {usd(sca106.totals.mother_monthly)}/month
                </strong>{" "}
                ({Math.round(
                  (sca106.totals.mother_monthly /
                    sca106.income.monthly_gross) *
                    1000,
                ) / 10}
                % of monthly gross).
              </p>
            </div>
          )}
          <p className="mt-3 text-[11px] text-slate-400">
            Averages span the case period
            {sca106.period.start && sca106.period.end
              ? ` (${sca106.period.start} to ${sca106.period.end})`
              : ""}
            . Recent twelve-month averages may differ; counsel can adjust
            using the Expense Ledger.
          </p>
        </Panel>
      )}

      <Panel
        title="Third-Party Statements"
        subtitle="Messages from others that corroborate caregiving"
      >
        {thirdParty.total === 0 ? (
          <EmptyNote>No third-party statements were identified.</EmptyNote>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Statements" value={thirdParty.total} />
              <Stat label="Distinct sources" value={thirdParty.sources} />
              <Stat
                label="Most frequent"
                value={thirdParty.bySource[0]?.source || "—"}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <ChartCaption>Statements per source</ChartCaption>
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(120, Math.min(8, thirdParty.bySource.length) * 30 + 40)}
                >
                  <BarChart
                    data={thirdParty.bySource.slice(0, 8)}
                    layout="vertical"
                    margin={{ right: 30 }}
                  >
                    <CartesianGrid {...GRID} vertical horizontal={false} />
                    <XAxis {...AXIS} type="number" allowDecimals={false} />
                    <YAxis
                      {...AXIS}
                      type="category"
                      dataKey="source"
                      width={150}
                      tick={{ fontSize: 10, fill: "#475569" }}
                    />
                    <Tooltip {...TOOLTIP} />
                    <Bar dataKey="count" fill="#64748b" barSize={14} radius={[0, 3, 3, 0]}>
                      <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: "#334155" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <ChartCaption>Statements per year</ChartCaption>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={thirdParty.byYear} barCategoryGap="30%">
                    <CartesianGrid {...GRID} />
                    <XAxis {...AXIS} dataKey="year" />
                    <YAxis {...AXIS} allowDecimals={false} width={26} />
                    <Tooltip {...TOOLTIP} />
                    <Bar dataKey="count" fill="#64748b" radius={[3, 3, 0, 0]}>
                      <LabelList dataKey="count" position="top" style={{ fontSize: 11, fill: "#334155" }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            {thirdParty.highlights.length > 0 && (
              <div className="mt-4 space-y-2">
                <ChartCaption>Highlights — most recent statements</ChartCaption>
                {thirdParty.highlights.map((t, i) => (
                  <p key={i} className="text-xs italic text-slate-500">
                    {t.source}
                    {t.date ? ` (${t.date})` : ""}: &ldquo;{t.quote}&rdquo;
                  </p>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-slate-400">
              Every statement, with its verbatim quote and source reference, is
              in the evidence workbook&rsquo;s Third-Party tab.
            </p>
          </>
        )}
      </Panel>

      {/* Structured tone by year and parent when the report carries it;
          older reports fall back to the single narrative paragraph. */}
      <Panel
        title="Tone of Co-Parenting Communications"
        subtitle={
          toneYears.length > 0
            ? "By year and parent — supporting messages are in the evidence workbook"
            : undefined
        }
      >
        {toneYears.length === 0 ? (
          <p className="text-sm text-slate-700">{report.sentiment_overview}</p>
        ) : (
          <>
            <div className="space-y-3">
              {toneYears.map(({ year, entries }) => (
                <div key={year}>
                  <p className="text-sm font-semibold text-slate-800">{year}</p>
                  {entries.map((e, i) => (
                    <div key={i} className="mt-1 pl-3">
                      <p className="text-sm">
                        <span
                          className="font-semibold"
                          style={{
                            color:
                              e.party === "father"
                                ? PARENT_COLORS.father
                                : PARENT_COLORS.mother,
                          }}
                        >
                          {e.party === "father" ? "Father" : meta.user_role}
                        </span>
                        {" — "}
                        <span className={TONE_TEXT[e.label] ?? "text-slate-500"}>
                          {e.label || "neutral"}
                        </span>
                        {e.summary ? (
                          <span className="text-slate-700"> · {e.summary}</span>
                        ) : null}
                      </p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>

    </div>
  );
}
