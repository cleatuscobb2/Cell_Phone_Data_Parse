/**
 * Pure dataset builders for the custody-report charts — shared by the
 * on-screen Recharts views and the @react-pdf chart renderers so both
 * always show identical numbers.
 */

function monthOf(date) {
  const m = (typeof date === "string" ? date : "").match(/^(\d{4}-\d{2})/);
  return m ? m[1] : null;
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Format a "YYYY-MM" key as a human label, e.g. "2024-01" -> "2024-Jan".
 * Builders sort on the raw key first, then format for display.
 */
export function monthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || "");
  if (!m) return ym || "";
  const idx = Number(m[2]) - 1;
  return idx >= 0 && idx < 12 ? `${m[1]}-${MONTH_ABBR[idx]}` : ym;
}

/** Overall custody split — counts of childcare instances per party. */
export function custodySplitData(cb) {
  return [
    { key: "mother", label: "With mother", value: cb.instances_with_mother },
    { key: "father", label: "With father", value: cb.instances_with_father },
    { key: "shared", label: "Shared", value: cb.instances_shared },
    { key: "unclear", label: "Unclear", value: cb.instances_unclear },
  ].filter((d) => d.value > 0);
}

/** Childcare instances per month, split by parent. */
export function carePatternData(report) {
  const map = {};
  for (const e of report.childcare_events || []) {
    const mo = monthOf(e.date);
    if (!mo) continue;
    map[mo] = map[mo] || { month: mo, mother: 0, father: 0 };
    if (e.parent === "mother") map[mo].mother += 1;
    else if (e.parent === "father") map[mo].father += 1;
  }
  return Object.values(map)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((d) => ({ ...d, month: monthLabel(d.month) }));
}

/**
 * The six kinds of missed/cancelled visit, in display order, each with a
 * distinct color — shared by the stacked monthly chart (on-screen and PDF)
 * so types read consistently.
 */
export const MISSED_TYPES = [
  { key: "cancellation", label: "Cancellation", color: "#e11d48" },
  { key: "no_show", label: "No-show", color: "#ea580c" },
  { key: "reschedule_request", label: "Reschedule request", color: "#ca8a04" },
  { key: "late", label: "Late", color: "#0d9488" },
  { key: "declined_time", label: "Declined time", color: "#7c3aed" },
  { key: "other", label: "Other", color: "#64748b" },
];

/**
 * Missed/cancelled visits per month, split by kind — drives the stacked
 * monthly bar chart. Each row has a `month` label plus a count per kind.
 */
export function missedByMonthAndTypeData(report) {
  const keys = MISSED_TYPES.map((t) => t.key);
  const map = {};
  for (const e of report.missed_or_cancelled || []) {
    const mo = monthOf(e.date);
    if (!mo) continue;
    if (!map[mo]) {
      map[mo] = { month: mo };
      for (const k of keys) map[mo][k] = 0;
    }
    map[mo][keys.includes(e.kind) ? e.kind : "other"] += 1;
  }
  return Object.keys(map)
    .sort()
    .map((mo) => ({ ...map[mo], month: monthLabel(mo) }));
}

/**
 * Court-recognized parenting-responsibility categories — `key` matches the
 * backend schema, `short` is for chart axes, `full` for labels and badges.
 */
export const RESPONSIBILITY_CATEGORIES = [
  { key: "education", short: "Education", full: "Education" },
  { key: "medical_dental_eye", short: "Medical", full: "Medical, Dental & Eye Care" },
  { key: "religious", short: "Religious", full: "Religious Matters" },
  { key: "child_care", short: "Child Care", full: "Child Care" },
  { key: "childrens_employment", short: "Employment", full: "Children's Employment" },
  { key: "motor_vehicle", short: "Vehicle", full: "Motor Vehicle Use" },
  { key: "activities", short: "Activities", full: "School & After-School Activities" },
  { key: "other", short: "Other", full: "Other" },
];

/** key → full display name, for badges and labels. */
export const RESPONSIBILITY_LABELS = Object.fromEntries(
  RESPONSIBILITY_CATEGORIES.map((c) => [c.key, c.full]),
);

export const MISSED_KIND_LABELS = {
  cancellation: "Cancellation",
  no_show: "No-show",
  reschedule_request: "Reschedule request",
  late: "Late",
  declined_time: "Declined time",
  other: "Other",
};

/**
 * Missed / cancelled visits summarized across the whole timespan — by parent,
 * by type, and by year — so the report can state who missed what instead of
 * listing every row (the full rows live in the evidence workbook).
 *
 * `responsible_party` is only present on reports generated after that field
 * was added; `hasParty` tells the renderer whether a per-parent split is
 * meaningful or whether it should fall back to type/year only.
 */
export function missedSummary(items = []) {
  const PARTIES = ["mother", "father", "shared", "unclear"];
  const blank = () => ({ mother: 0, father: 0, shared: 0, unclear: 0 });
  const byParty = blank();
  const byType = {};
  const byYearMap = {};
  for (const m of items) {
    const p = PARTIES.includes(m.responsible_party) ? m.responsible_party : "unclear";
    byParty[p] += 1;
    const k = m.kind || "other";
    byType[k] = (byType[k] || 0) + 1;
    const y = String(m.date || "").slice(0, 4) || "—";
    if (!byYearMap[y]) byYearMap[y] = { year: y, total: 0, ...blank() };
    byYearMap[y].total += 1;
    byYearMap[y][p] += 1;
  }
  return {
    total: items.length,
    byParty,
    byType: Object.keys(MISSED_KIND_LABELS)
      .filter((k) => byType[k])
      .map((k) => ({ kind: k, label: MISSED_KIND_LABELS[k], count: byType[k] })),
    byYear: Object.values(byYearMap).sort((a, b) =>
      String(a.year).localeCompare(String(b.year)),
    ),
    hasParty: items.some(
      (m) => m.responsible_party && m.responsible_party !== "unclear",
    ),
  };
}

/**
 * Parenting responsibilities per court category, split by who handled them.
 * Each row carries `total` instances plus `motherPct`/`fatherPct` — each
 * parent's share of THAT category's instances — for on-chart labels.
 */
export function responsibilityData(report) {
  const map = {};
  for (const e of report.responsibility_events || []) {
    const c = e.category;
    map[c] = map[c] || { mother: 0, father: 0, shared: 0, unclear: 0 };
    if (e.responsible_party in map[c]) map[c][e.responsible_party] += 1;
  }
  return RESPONSIBILITY_CATEGORIES.filter((c) => map[c.key]).map((c) => {
    const m = map[c.key];
    const total = m.mother + m.father + m.shared + m.unclear;
    return {
      category: c.short,
      full: c.full,
      ...m,
      total,
      motherPct: total ? Math.round((m.mother / total) * 100) : 0,
      fatherPct: total ? Math.round((m.father / total) * 100) : 0,
    };
  });
}

/**
 * Mother-vs-father coverage across ALL court categories — for the radar
 * chart. Every category is included (even zero ones) so the radar shape is
 * consistent and coverage gaps are visible.
 *
 * The plotted `mother`/`father` values count shared instances toward both
 * parents, so the polygon reflects who was involved. `motherPct`/`fatherPct`
 * are each parent's share of THAT category's total instances (from a clean
 * partition, no double counting) — for the per-parent on-chart labels.
 */
export function responsibilityRadarData(report) {
  const map = {}; // shared counted toward both — drives the polygon shape
  const raw = {}; // clean partition — drives the per-parent percentages
  for (const e of report.responsibility_events || []) {
    const c = e.category;
    map[c] = map[c] || { mother: 0, father: 0 };
    raw[c] = raw[c] || { mother: 0, father: 0, shared: 0, unclear: 0 };
    if (e.responsible_party in raw[c]) raw[c][e.responsible_party] += 1;
    if (e.responsible_party === "mother") map[c].mother += 1;
    else if (e.responsible_party === "father") map[c].father += 1;
    else if (e.responsible_party === "shared") {
      map[c].mother += 1;
      map[c].father += 1;
    }
  }
  return RESPONSIBILITY_CATEGORIES.map((c) => {
    const r = raw[c.key] || { mother: 0, father: 0, shared: 0, unclear: 0 };
    const total = r.mother + r.father + r.shared + r.unclear;
    return {
      category: c.short,
      full: c.full,
      mother: map[c.key]?.mother || 0,
      father: map[c.key]?.father || 0,
      total,
      motherPct: total ? Math.round((r.mother / total) * 100) : 0,
      fatherPct: total ? Math.round((r.father / total) * 100) : 0,
    };
  });
}
