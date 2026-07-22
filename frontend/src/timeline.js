/**
 * Shared timeline model — turns a custody report into positioned swim-lane
 * data. Consumed by both the interactive <Timeline> component and the PDF
 * renderer, so the two stay in sync.
 *
 * The timeline is split into one chart per calendar year, each spanning a
 * full Jan–Dec so a given month always sits at the same horizontal position.
 * That makes seasonal patterns (e.g. every August) easy to spot year over
 * year. Every event is placed by `frac` (0..1) along its year.
 */

import { refMessages, sourceRef } from "./messageRefs.js";

export const TIMELINE_LANES = [
  // `short` is used when a lane splits into per-parent sub-lanes, to keep the
  // lane-label column narrow enough to read.
  { key: "childcare", label: "Childcare", short: "Childcare", color: "#6366f1" },
  { key: "missed", label: "Missed / Cancelled", short: "Missed", color: "#e11d48" },
  { key: "responsibility", label: "Responsibilities", short: "Resp.", color: "#0ea5e9" },
  { key: "thirdparty", label: "Third-Party", color: "#64748b" },
  { key: "gap", label: "Communication Gaps", color: "#f59e0b" },
];

// Lanes that split into per-parent sub-swim-lanes, so the chart shows who did
// what rather than just that something happened.
const SPLIT_LANES = new Set(["childcare", "missed", "responsibility"]);
const SUB_ORDER = ["mother", "father", "shared", "unclear"];
const SUB_LABEL = {
  mother: "Mother",
  father: "Father",
  shared: "Shared",
  unclear: "Unclear",
};

const PARENT_MARKER = {
  mother: "#6366f1",
  father: "#f97316",
  shared: "#f59e0b",
  unclear: "#94a3b8",
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function parseDate(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Pull every dated event out of the report, keeping raw Date objects so the
 * yearly builder can re-bucket them. Point events carry a color, hover
 * title, and `ref` — the source text/email ID. Communication gaps are spans.
 */
function extractEvents(report, refed) {
  // `party` drives the per-parent sub-lanes. Missed visits only carry an
  // attribution on reports generated after MissedVisit gained that field.
  const point = (e, color, title, party) => {
    const date = parseDate(e.date);
    if (!date) return null;
    return {
      date,
      color,
      title,
      party: party || null,
      ref: sourceRef(e.quote, e.date, refed),
    };
  };

  const childcare = (report.childcare_events || [])
    .map((e) =>
      point(
        e,
        PARENT_MARKER[e.parent] ?? PARENT_MARKER.unclear,
        `${e.date} · with ${e.parent} — ${e.description}`,
        e.parent,
      ),
    )
    .filter(Boolean);

  const missed = (report.missed_or_cancelled || [])
    .map((e) =>
      point(
        e,
        "#e11d48",
        `${e.date} · ${e.kind.replace(/_/g, " ")} — ${e.description}`,
        e.responsible_party,
      ),
    )
    .filter(Boolean);

  const responsibility = (report.responsibility_events || [])
    .map((e) => {
      const p = point(
        e,
        "#0ea5e9",
        `${e.date} · ${e.category.replace(/_/g, " ")} (${e.responsible_party}) — ${e.description}`,
        e.responsible_party,
      );
      if (!p) return null;
      // The free-text "Other" category is where activities, milestones and
      // one-off events land — surfaced as labelled markers on the timeline.
      p.isOther = String(e.category || "") === "other";
      p.milestoneLabel = String(e.subcategory || e.description || "")
        .trim()
        .slice(0, 26);
      return p;
    })
    .filter(Boolean);

  const thirdparty = (report.third_party_statements || [])
    .map((e) => point(e, "#64748b", `${e.date} · ${e.source} — ${e.description}`))
    .filter(Boolean);

  const gaps = (report.communication_gaps || [])
    .map((g) => {
      const start = parseDate(g.start_date);
      const end = parseDate(g.end_date);
      return start && end
        ? {
            start,
            end,
            title: `${g.start_date} → ${g.end_date} (${g.days} days) — ${g.description}`,
          }
        : null;
    })
    .filter(Boolean);

  return { childcare, missed, responsibility, thirdparty, gaps };
}

/**
 * Build one timeline model per calendar year that contains events.
 *
 * Returns `{ years: [...], laneTotals: [...] }`, where each year model has
 * the same shape the renderers expect (`lanes`, `ticks`) plus a `year`.
 * `laneTotals` carries the overall per-lane counts for the filter chips.
 */
export function buildYearlyTimelineModels(report, transcript) {
  if (!report) return null;
  const events = extractEvents(report, refMessages(transcript || []));

  // Every year touched by any event (gaps count both endpoints' years).
  const pointDates = [
    ...events.childcare,
    ...events.missed,
    ...events.responsibility,
    ...events.thirdparty,
  ].map((e) => e.date);
  const yearsTouched = new Set(pointDates.map((d) => d.getFullYear()));
  for (const g of events.gaps) {
    for (let y = g.start.getFullYear(); y <= g.end.getFullYear(); y++) {
      yearsTouched.add(y);
    }
  }
  const years = [...yearsTouched].sort((a, b) => a - b);
  if (years.length === 0) return null;

  const byKey = {
    childcare: events.childcare,
    missed: events.missed,
    responsibility: events.responsibility,
    thirdparty: events.thirdparty,
  };

  // Sub-lane plan, computed once from ALL events so the lanes line up across
  // every year. A lane only splits when its events actually carry a parent
  // attribution — otherwise splitting would just relabel everything "Unclear".
  const subPlan = {};
  for (const lane of TIMELINE_LANES) {
    if (!SPLIT_LANES.has(lane.key)) continue;
    const evts = byKey[lane.key] || [];
    const present = SUB_ORDER.filter((p) => evts.some((e) => e.party === p));
    if (present.some((p) => p !== "unclear")) subPlan[lane.key] = present;
  }

  const models = years.map((year) => {
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59);
    const span = end.getTime() - start.getTime();
    const frac = (d) =>
      Math.max(0, Math.min(1, (d.getTime() - start.getTime()) / span));
    const inYear = (d) => d.getFullYear() === year;

    const toPoint = (e) => ({
      frac: frac(e.date),
      color: e.color,
      title: e.ref ? `${e.ref} · ${e.title}` : e.title,
      ref: e.ref,
    });

    const lanes = TIMELINE_LANES.flatMap((lane) => {
      if (lane.key === "gap") {
        // A gap straddling a year boundary is clipped into each year it covers.
        const spans = events.gaps
          .filter(
            (g) => g.start.getFullYear() <= year && g.end.getFullYear() >= year,
          )
          .map((g) => ({
            startFrac: frac(g.start < start ? start : g.start),
            endFrac: frac(g.end > end ? end : g.end),
            title: g.title,
          }));
        return [
          { ...lane, baseKey: lane.key, points: [], spans, count: spans.length },
        ];
      }
      const all = (byKey[lane.key] || []).filter((e) => inYear(e.date));
      const plan = subPlan[lane.key];
      if (!plan) {
        const points = all.map(toPoint);
        return [
          { ...lane, baseKey: lane.key, points, spans: [], count: points.length },
        ];
      }
      // One sub-swim-lane per parent, so the chart shows who did what.
      return plan.map((p) => {
        const points = all.filter((e) => e.party === p).map(toPoint);
        return {
          ...lane,
          key: `${lane.key}:${p}`,
          baseKey: lane.key,
          label: `${lane.short || lane.label} · ${SUB_LABEL[p]}`,
          color: PARENT_MARKER[p] || lane.color,
          points,
          spans: [],
          count: points.length,
        };
      });
    });

    // --- Per-actor plots -------------------------------------------------
    // A second view of the same year: one plot per actor (each parent, third
    // parties, communication gaps) rather than one per event type, so a
    // reader can see each party's year on its own strip. Each carries a
    // 12-month count series to drive a trend sparkline.
    const tally = (items) => {
      const m = new Array(12).fill(0);
      for (const it of items) m[it.date.getMonth()] += 1;
      return m;
    };
    // A "shared" event involved both parents, so it appears on both strips.
    const forParty = (party) => {
      const pick = (arr, kind) =>
        arr
          .filter(
            (e) => inYear(e.date) && (e.party === party || e.party === "shared"),
          )
          .map((e) => ({ ...e, kind }));
      return [
        ...pick(events.childcare, "childcare"),
        ...pick(events.missed, "missed"),
        ...pick(events.responsibility, "responsibility"),
      ].sort((a, b) => a.date - b.date);
    };
    const groupOf = (key, label, color, raw) => ({
      key,
      label,
      color,
      points: raw.map((e) => ({
        ...toPoint(e),
        kind: e.kind || key,
      })),
      spans: [],
      monthly: tally(raw),
      total: raw.length,
    });

    const gapSpans = events.gaps
      .filter((g) => g.start.getFullYear() <= year && g.end.getFullYear() >= year)
      .map((g) => {
        const s = g.start < start ? start : g.start;
        const e = g.end > end ? end : g.end;
        return {
          startFrac: frac(s),
          endFrac: frac(e),
          title: g.title,
          startMonth: s.getMonth(),
          endMonth: e.getMonth(),
        };
      });
    const gapMonthly = new Array(12).fill(0);
    for (const s of gapSpans) {
      for (let m = s.startMonth; m <= s.endMonth; m++) gapMonthly[m] += 1;
    }

    const groups = [
      groupOf("mother", "Mother", PARENT_MARKER.mother, forParty("mother")),
      groupOf("father", "Father", PARENT_MARKER.father, forParty("father")),
      groupOf(
        "thirdparty",
        "Third-Party",
        "#64748b",
        events.thirdparty
          .filter((e) => inYear(e.date))
          .map((e) => ({ ...e, kind: "thirdparty" })),
      ),
      {
        key: "gap",
        label: "Comm. Gaps",
        color: "#f59e0b",
        points: [],
        spans: gapSpans,
        monthly: gapMonthly,
        total: gapSpans.length,
      },
    ];

    // Milestones — the free-text "Other" responsibility entries, where
    // activities, milestones and one-off events end up. Capped so the strip
    // stays legible.
    const milestones = events.responsibility
      .filter((e) => inYear(e.date) && e.isOther && e.milestoneLabel)
      .sort((a, b) => a.date - b.date)
      .slice(0, 14)
      .map((e) => ({
        frac: frac(e.date),
        label: e.milestoneLabel,
        party: e.party || "unclear",
        color: PARENT_MARKER[e.party] ?? PARENT_MARKER.unclear,
        title: e.ref ? `${e.ref} · ${e.title}` : e.title,
      }));

    // Twelve month gridlines — one per month, plus a final Dec-31 boundary.
    const ticks = MONTHS.map((label, m) => ({
      frac: frac(new Date(year, m, 1)),
      label,
    }));

    return {
      year,
      lanes,
      groups,
      milestones,
      months: MONTHS,
      ticks,
      startLabel: `${year}-01-01`,
      endLabel: `${year}-12-31`,
    };
  });

  // Overall counts for the filter chips (gaps counted once each).
  const laneTotals = TIMELINE_LANES.map((lane) => ({
    key: lane.key,
    label: lane.label,
    color: lane.color,
    count:
      lane.key === "gap"
        ? events.gaps.length
        : (byKey[lane.key] || []).length,
  }));

  return { years: models, laneTotals };
}
