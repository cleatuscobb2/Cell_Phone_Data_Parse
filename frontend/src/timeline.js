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
  { key: "childcare", label: "Childcare", color: "#6366f1" },
  { key: "missed", label: "Missed / Cancelled", color: "#e11d48" },
  { key: "responsibility", label: "Responsibilities", color: "#0ea5e9" },
  { key: "thirdparty", label: "Third-Party", color: "#64748b" },
  { key: "gap", label: "Communication Gaps", color: "#f59e0b" },
];

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
  const point = (e, color, title) => {
    const date = parseDate(e.date);
    if (!date) return null;
    return { date, color, title, ref: sourceRef(e.quote, e.date, refed) };
  };

  const childcare = (report.childcare_events || [])
    .map((e) =>
      point(
        e,
        PARENT_MARKER[e.parent] ?? PARENT_MARKER.unclear,
        `${e.date} · with ${e.parent} — ${e.description}`,
      ),
    )
    .filter(Boolean);

  const missed = (report.missed_or_cancelled || [])
    .map((e) =>
      point(e, "#e11d48", `${e.date} · ${e.kind.replace(/_/g, " ")} — ${e.description}`),
    )
    .filter(Boolean);

  const responsibility = (report.responsibility_events || [])
    .map((e) =>
      point(
        e,
        "#0ea5e9",
        `${e.date} · ${e.category.replace(/_/g, " ")} (${e.responsible_party}) — ${e.description}`,
      ),
    )
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

  const models = years.map((year) => {
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59);
    const span = end.getTime() - start.getTime();
    const frac = (d) =>
      Math.max(0, Math.min(1, (d.getTime() - start.getTime()) / span));
    const inYear = (d) => d.getFullYear() === year;

    const lanes = TIMELINE_LANES.map((lane) => {
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
        return { ...lane, points: [], spans, count: spans.length };
      }
      const points = (byKey[lane.key] || [])
        .filter((e) => inYear(e.date))
        .map((e) => ({
          frac: frac(e.date),
          color: e.color,
          title: e.ref ? `${e.ref} · ${e.title}` : e.title,
          ref: e.ref,
        }));
      return { ...lane, points, spans: [], count: points.length };
    });

    // Twelve month gridlines — one per month, plus a final Dec-31 boundary.
    const ticks = MONTHS.map((label, m) => ({
      frac: frac(new Date(year, m, 1)),
      label,
    }));

    return {
      year,
      lanes,
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
