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
  responsibilityData,
  responsibilityRadarData,
  RESPONSIBILITY_LABELS,
} from "./chartData.js";
import {
  requiredForms,
  FORM_EVIDENCE,
  EVIDENCE_LABELS,
} from "./custodyForms.js";
import {
  buildFinancialSummary,
  buildFinancialCrossValidation,
} from "./financial.js";
import { refExpenses } from "./messageRefs.js";

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

const MISSED_BADGE = "bg-rose-100 text-rose-700 ring-rose-200";
const CATEGORY_BADGE = "bg-sky-100 text-sky-700 ring-sky-200";

const SUGGESTION_LABELS = {
  attachment: "Attachment",
  key_statement: "Key statement",
  evidence_to_gather: "Gather evidence",
  follow_up: "Follow-up",
  other: "Suggestion",
};
const SUGGESTION_BADGE = {
  attachment: "bg-amber-100 text-amber-700 ring-amber-200",
  key_statement: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  evidence_to_gather: "bg-sky-100 text-sky-700 ring-sky-200",
  follow_up: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  other: "bg-slate-100 text-slate-600 ring-slate-200",
};

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
      saveBlob(blob, `custody-report-${new Date().toISOString().slice(0, 10)}.pdf`);
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
      saveBlob(blob, `custody-evidence-${new Date().toISOString().slice(0, 10)}.xlsx`);
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
  const responsibilities = responsibilityData(report);
  const radarData = responsibilityRadarData(report);

  // Financial Contribution — totals + cross-validation against the
  // ResponsibilityEvent list. Empty by default; rendered only when the
  // user uploaded receipts or payment-app exports.
  const expensesRefed = refExpenses(report.expenses || []);
  const fin = buildFinancialSummary(expensesRefed);
  const finFindings = fin.hasExpenses
    ? buildFinancialCrossValidation(
        expensesRefed,
        report.responsibility_events || [],
      )
    : [];

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
        <h2 className="text-lg font-bold text-slate-800">Custody Analysis Report</h2>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <button
              onClick={downloadPdf}
              disabled={pdfBusy}
              className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pdfBusy ? "Generating PDF…" : "Download PDF Report"}
            </button>
            <button
              onClick={downloadXlsx}
              disabled={xlsxBusy}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
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

      {report.suggestions?.length > 0 && (
        <Panel
          title="Suggestions"
          subtitle="Actions to help you and your attorney build the case"
        >
          <div className="space-y-1.5">
            {report.suggestions.map((s, i) => (
              <div
                key={i}
                className="flex gap-2 rounded-md border border-slate-100 px-3 py-2"
              >
                <Badge
                  text={SUGGESTION_LABELS[s.category] ?? "Suggestion"}
                  className={`self-start ${SUGGESTION_BADGE[s.category] ?? SUGGESTION_BADGE.other}`}
                />
                <p className="text-sm text-slate-700">
                  {s.suggestion}
                  {s.related_date ? (
                    <span className="text-slate-400"> ({s.related_date})</span>
                  ) : null}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel
        title="Event Timeline"
        subtitle="One chart per year with month gridlines — toggle lanes to filter"
      >
        <Timeline report={report} transcript={data.transcript} />
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Custody Split" subtitle="Share of childcare instances">
          <ProportionBar data={splitData} />
          <p className="mt-3 text-xs text-slate-400">{report.breakdown_basis}</p>
        </Panel>

        <Panel title="Care Pattern Over Time" subtitle="Childcare instances per month">
          {monthly.length === 0 ? (
            <EmptyNote>Not enough dated instances to chart a pattern.</EmptyNote>
          ) : (
            <ResponsiveContainer width="100%" height={268}>
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
            <div className="mt-4 max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {report.missed_or_cancelled.map((m, i) => (
                <EvidenceRow
                  key={i}
                  date={m.date}
                  channel={m.channel}
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
                channel={e.channel}
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
      </Panel>

      <Panel
        title="Parenting Responsibilities"
        subtitle="Classified into the court-recognized categories"
      >
        {report.responsibility_events.length === 0 ? (
          <EmptyNote>No responsibility events were identified in the messages.</EmptyNote>
        ) : (
          <>
            <div className="mb-4">
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
            <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
              {report.responsibility_events.map((r, i) => (
                <EvidenceRow
                  key={i}
                  date={r.date}
                  channel={r.channel}
                  badge={
                    <span className="flex shrink-0 flex-wrap justify-end gap-1">
                      <Badge
                        text={RESPONSIBILITY_LABELS[r.category] ?? "Other"}
                        className={CATEGORY_BADGE}
                      />
                      <Badge
                        text={r.responsible_party}
                        className={PARENT_BADGE[r.responsible_party] ?? PARENT_BADGE.unclear}
                      />
                    </span>
                  }
                  description={
                    r.subcategory ? `${r.subcategory} — ${r.description}` : r.description
                  }
                  quote={r.quote}
                  sender={r.sender}
                />
              ))}
            </div>
          </>
        )}
      </Panel>

      {fin.hasExpenses && (
        <Panel
          title="Financial Contribution"
          subtitle={`Total of ${usd(fin.total)} in child-related expenses${
            fin.period ? ` from ${fin.period.start} to ${fin.period.end}` : ""
          }`}
        >
          {/* Headline totals — same look as the stat cards on the PDF. */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Total tracked</p>
              <p className="text-lg font-bold text-slate-800">{usd(fin.total)}</p>
            </div>
            <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3">
              <p className="text-xs text-indigo-600">Paid by {meta.user_role}</p>
              <p className="text-lg font-bold text-indigo-800">
                {usd(fin.grand_total.mother)}
              </p>
            </div>
            <div className="rounded-md border border-orange-200 bg-orange-50 p-3">
              <p className="text-xs text-orange-600">Paid by father</p>
              <p className="text-lg font-bold text-orange-800">
                {usd(fin.grand_total.father)}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <p className="text-xs text-slate-500">Receipts / payments</p>
              <p className="text-lg font-bold text-slate-800">
                {expensesRefed.length}
              </p>
            </div>
          </div>

          {/* Spend share by court category. */}
          {fin.by_category.length > 0 && (
            <div className="mb-6">
              <ChartCaption>
                Dollars spent per category —{" "}
                <span style={{ color: PARENT_COLORS.mother }}>{meta.user_role}</span>
                {" vs. "}
                <span style={{ color: PARENT_COLORS.father }}>father</span>
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

          {/* Cumulative contribution over time — running totals per parent. */}
          {fin.cumulative.length > 1 && (
            <div className="mb-6">
              <ChartCaption>
                Cumulative contribution over time — running total per parent
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
                    dataKey="mother"
                    stroke={PARENT_COLORS.mother}
                    strokeWidth={2}
                    dot={false}
                    name={`With ${meta.user_role}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="father"
                    stroke={PARENT_COLORS.father}
                    strokeWidth={2}
                    dot={false}
                    name="With father"
                  />
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
                channel={t.channel}
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
