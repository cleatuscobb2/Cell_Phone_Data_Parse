/**
 * Timeline — instances over time, readable at a glance.
 *
 * The old dot-per-event swim lanes made patterns hard to read at volume: fifty
 * overlapping markers say less than "9 in March". This view shows, per year,
 * each actor's monthly instance counts as bars (mother / father / third-party)
 * with communication gaps as shaded month bands behind them, a count label on
 * every bar, milestone chips from the free-text "Other" entries, and a
 * per-year summary table beneath — trend, volume and gaps in one look.
 * Row-level detail stays in the evidence workbook.
 */

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildYearlyTimelineModels } from "./timeline.js";

const COLORS = {
  mother: "#6366f1",
  father: "#f97316",
  thirdparty: "#64748b",
  gap: "#f59e0b",
};

const AXIS = {
  tick: { fontSize: 11, fill: "#64748b" },
  tickLine: false,
  axisLine: { stroke: "#e2e8f0" },
};

/** Count label above a bar — hidden for zero so the chart stays clean. */
function CountLabel({ x, y, width, value, fill }) {
  if (!value) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 4}
      textAnchor="middle"
      fontSize={10}
      fontWeight={600}
      fill={fill}
    >
      {value}
    </text>
  );
}

function YearChart({ model, userRole }) {
  const groups = Object.fromEntries(model.groups.map((g) => [g.key, g]));
  const rows = model.months.map((m, i) => ({
    month: m,
    mother: groups.mother?.monthly[i] ?? 0,
    father: groups.father?.monthly[i] ?? 0,
    thirdparty: groups.thirdparty?.monthly[i] ?? 0,
    gap: groups.gap?.monthly[i] ?? 0,
  }));
  const yearTotal = model.groups.reduce((s, g) => s + g.total, 0);
  const gapMonths = rows.filter((r) => r.gap > 0).map((r) => r.month);

  return (
    <div className="mb-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-bold text-slate-700">{model.year}</span>
        <span className="text-xs text-slate-400">
          {yearTotal} {yearTotal === 1 ? "entry" : "entries"}
        </span>
        <span className="text-xs font-semibold" style={{ color: COLORS.mother }}>
          {userRole} {groups.mother?.total ?? 0}
        </span>
        <span className="text-xs font-semibold" style={{ color: COLORS.father }}>
          father {groups.father?.total ?? 0}
        </span>
        {groups.thirdparty?.total > 0 && (
          <span className="text-xs font-semibold" style={{ color: COLORS.thirdparty }}>
            third-party {groups.thirdparty.total}
          </span>
        )}
        {gapMonths.length > 0 && (
          <span className="text-xs font-semibold" style={{ color: COLORS.gap }}>
            gaps: {gapMonths.join(", ")}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={rows} barCategoryGap="25%" margin={{ top: 16 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#eef2f6" vertical={false} />
          <XAxis {...AXIS} dataKey="month" interval={0} />
          <YAxis {...AXIS} allowDecimals={false} width={26} />
          {/* Communication gaps as shaded month bands behind the bars. */}
          {rows.map((r) =>
            r.gap > 0 ? (
              <ReferenceArea
                key={r.month}
                x1={r.month}
                x2={r.month}
                fill={COLORS.gap}
                fillOpacity={0.14}
              />
            ) : null,
          )}
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            cursor={{ fill: "rgba(99,102,241,0.06)" }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} />
          <Bar dataKey="mother" name={`With ${userRole}`} fill={COLORS.mother}>
            <LabelList content={<CountLabel fill={COLORS.mother} />} />
          </Bar>
          <Bar dataKey="father" name="With father" fill={COLORS.father}>
            <LabelList content={<CountLabel fill={COLORS.father} />} />
          </Bar>
          {groups.thirdparty?.total > 0 && (
            <Bar dataKey="thirdparty" name="Third-party" fill={COLORS.thirdparty}>
              <LabelList content={<CountLabel fill={COLORS.thirdparty} />} />
            </Bar>
          )}
        </BarChart>
      </ResponsiveContainer>

      {model.milestones.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {model.milestones.map((m, i) => (
            <span
              key={i}
              title={m.title}
              className="rounded-full border px-2 py-0.5 text-xs"
              style={{ borderColor: m.color, color: m.color }}
            >
              {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Timeline({ report, transcript, userRole = "mother" }) {
  const data = useMemo(
    () => buildYearlyTimelineModels(report, transcript),
    [report, transcript],
  );

  if (!data) {
    return (
      <p className="text-sm text-slate-400">
        Not enough dated events to build a timeline.
      </p>
    );
  }

  // Per-year summary — the trend across the whole record in one table.
  const summary = data.years.map((y) => {
    const g = Object.fromEntries(y.groups.map((gr) => [gr.key, gr]));
    return {
      year: y.year,
      mother: g.mother?.total ?? 0,
      father: g.father?.total ?? 0,
      thirdparty: g.thirdparty?.total ?? 0,
      gaps: g.gap?.total ?? 0,
      total: y.groups.reduce((s, gr) => s + gr.total, 0),
    };
  });

  return (
    <div>
      {data.years.map((model) => (
        <YearChart key={model.year} model={model} userRole={userRole} />
      ))}

      <div className="mt-2 overflow-x-auto">
        <p className="mb-1 text-xs font-medium text-slate-500">Summary by year</p>
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="py-1 text-left font-semibold">Year</th>
              <th className="py-1 text-right font-semibold" style={{ color: COLORS.mother }}>
                {userRole}
              </th>
              <th className="py-1 text-right font-semibold" style={{ color: COLORS.father }}>
                Father
              </th>
              <th className="py-1 text-right font-semibold" style={{ color: COLORS.thirdparty }}>
                Third-party
              </th>
              <th className="py-1 text-right font-semibold" style={{ color: COLORS.gap }}>
                Gaps
              </th>
              <th className="py-1 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((r) => (
              <tr key={r.year} className="border-b border-slate-50">
                <td className="py-1 text-slate-700">{r.year}</td>
                <td className="py-1 text-right" style={{ color: COLORS.mother }}>{r.mother}</td>
                <td className="py-1 text-right" style={{ color: COLORS.father }}>{r.father}</td>
                <td className="py-1 text-right" style={{ color: COLORS.thirdparty }}>{r.thirdparty}</td>
                <td className="py-1 text-right" style={{ color: COLORS.gap }}>{r.gaps}</td>
                <td className="py-1 text-right font-semibold text-slate-800">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-slate-400">
        Bars are each party&rsquo;s instances per month (childcare, missed and
        responsibility entries; a shared entry counts for both). Amber bands
        mark communication-gap months; chips are milestones from the free-text
        &ldquo;Other&rdquo; entries. Row-level detail is in the evidence
        workbook.
      </p>
    </div>
  );
}
