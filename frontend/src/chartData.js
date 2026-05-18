/**
 * Pure dataset builders for the custody-report charts — shared by the
 * on-screen Recharts views and the @react-pdf chart renderers so both
 * always show identical numbers.
 */

function monthOf(date) {
  const m = (typeof date === "string" ? date : "").match(/^(\d{4}-\d{2})/);
  return m ? m[1] : null;
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
  return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
}

/** Count of missed/cancelled visits per month — the pattern-of-absence trend. */
export function missedOverTimeData(report) {
  const map = {};
  for (const e of report.missed_or_cancelled || []) {
    const mo = monthOf(e.date);
    if (!mo) continue;
    map[mo] = (map[mo] || 0) + 1;
  }
  return Object.keys(map)
    .sort()
    .map((mo) => ({ month: mo, count: map[mo] }));
}

/** Missed/cancelled visits broken down by kind. */
export function missedByTypeData(report) {
  const order = [
    "cancellation",
    "no_show",
    "reschedule_request",
    "late",
    "declined_time",
    "other",
  ];
  const map = {};
  for (const e of report.missed_or_cancelled || []) {
    map[e.kind] = (map[e.kind] || 0) + 1;
  }
  return order
    .filter((k) => map[k])
    .map((k) => ({ type: k.replace(/_/g, " "), count: map[k] }));
}

/** Parenting responsibilities per category, split by who handled them. */
export function responsibilityData(report) {
  const order = [
    "medical",
    "school",
    "drop_off",
    "pick_up",
    "emergency_contact",
    "activity",
    "other",
  ];
  const map = {};
  for (const e of report.responsibility_events || []) {
    const c = e.category;
    map[c] = map[c] || {
      category: c.replace(/_/g, " "),
      mother: 0,
      father: 0,
      shared: 0,
      unclear: 0,
    };
    if (e.responsible_party in map[c]) map[c][e.responsible_party] += 1;
  }
  return order.filter((c) => map[c]).map((c) => map[c]);
}
