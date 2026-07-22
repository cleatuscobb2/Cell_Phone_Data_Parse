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

/**
 * Cross-cutting co-parenting themes. The court taxonomy (education, medical,
 * …) misses most of the qualitative signal, which ends up in free-text
 * "Other" responsibility entries. These patterns pull that signal back out so
 * the report can say who actually handled discipline, communication, safety,
 * follow-through, and the rest.
 *
 * Keyword-driven on purpose: it works on an already-generated report with no
 * re-analysis, and every count is traceable to the entry that produced it.
 */
export const RESP_THEMES = [
  { key: "communication", label: "Communication & responsiveness", patterns: [
    /communicat/i, /respond|reply|replied|unanswered|ignor|no answer|never (?:got )?back/i,
    /notif|inform|told me|let me know|kept me|heads up|blindsid/i] },
  { key: "schedules", label: "Scheduling & exchanges", patterns: [
    /schedul|calendar|pick.?up|drop.?off|exchange|swap|visitation|parenting time|custody time|late for/i] },
  { key: "follow_up", label: "Follow-through", patterns: [
    /follow.?up|follow.?through|forgot|failed to|never did|did ?n.?t (?:do|follow)|dropped the ball|remind|promised/i] },
  { key: "discipline", label: "Discipline", patterns: [
    /disciplin|punish|grounded|time.?out|consequence|behavio(?:u)?r plan|rules?\b|boundar/i] },
  { key: "behavior", label: "Behavior & conduct", patterns: [
    /behav|tantrum|acting out|attitude|outburst|melt ?down|argu|yell|scream|swear|curs/i] },
  { key: "planning", label: "Planning & decisions", patterns: [
    /plan(?:ning|ned)?\b|arrange|coordinat|organiz|decision|decide|agree(?:d|ment)?\b/i] },
  { key: "financial", label: "Financial", patterns: [
    /\$|paid|pay(?:ing|ment)?\b|cost|expense|reimburs|owe|bill|invoice|receipt|refund|money/i] },
  { key: "insurance", label: "Insurance & claims", patterns: [
    /insur|coverage|policy|deductible|co.?pay|\beob\b|claim/i] },
  { key: "safety", label: "Safety & supervision", patterns: [
    /\bsafe|unsafe|supervis|unattended|danger|hazard|car ?seat|seat ?belt|helmet|alcohol|drunk|drug|smok|weapon|injur/i] },
  { key: "hygiene", label: "Hygiene & basic care", patterns: [
    /hygien|bath|shower|brush|teeth|clean clothes|laundry|dirty|diaper|groom|haircut|nail/i] },
  { key: "health", label: "Health & appointments", patterns: [
    /doctor|dentist|medic|prescri|pharmac|sick|fever|ill\b|appointment|therap|counsel|vaccin|checkup/i] },
  { key: "school", label: "School & academics", patterns: [
    /school|homework|teacher|grade|class|tutor|conference|attendance|absent|report card|iep/i] },
  { key: "support", label: "Emotional support", patterns: [
    /support|comfort|reassur|encourag|there for|emotional|upset|cried|anxious|scared/i] },
  { key: "gifts", label: "Gifts & occasions", patterns: [
    /gift|present\b|birthday|christmas|holiday|easter|halloween|party\b/i] },
  { key: "transport", label: "Transportation", patterns: [
    /\bdriv|\bride\b|transport|vehicle|\bbus\b|carpool|gas money/i] },
  { key: "activities", label: "Activities & enrichment", patterns: [
    /practice|game\b|team|coach|lesson|club|camp|sport|recital|rehears/i] },
  { key: "housing", label: "Housing & environment", patterns: [
    /hous|\bhome\b|apartment|residence|bedroom|moved?\b|living (?:situation|arrangement)/i] },
];

/**
 * Per-parent picture across the themes above: counts by party plus one
 * representative quote per parent, so each theme is backed by evidence.
 * Draws on every responsibility entry, not just the "Other" category.
 */
export function responsibilityThemes(report, { maxQuote = 180 } = {}) {
  const PARTIES = ["mother", "father", "shared", "unclear"];
  const rows = RESP_THEMES.map((t) => ({
    key: t.key,
    label: t.label,
    mother: 0, father: 0, shared: 0, unclear: 0,
    total: 0,
    exemplars: {},
  }));
  const index = Object.fromEntries(rows.map((r) => [r.key, r]));
  for (const e of report.responsibility_events || []) {
    const hay = `${e.subcategory || ""} ${e.description || ""} ${e.quote || ""}`;
    if (!hay.trim()) continue;
    const party = PARTIES.includes(e.responsible_party) ? e.responsible_party : "unclear";
    for (const t of RESP_THEMES) {
      if (!t.patterns.some((p) => p.test(hay))) continue;
      const row = index[t.key];
      row[party] += 1;
      row.total += 1;
      if (!row.exemplars[party]) {
        const text = String(e.quote || e.description || "").trim();
        if (text) {
          row.exemplars[party] = {
            text: text.length > maxQuote ? `${text.slice(0, maxQuote)}…` : text,
            date: e.date || "",
          };
        }
      }
    }
  }
  return rows.filter((r) => r.total > 0).sort((a, b) => b.total - a.total);
}

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
