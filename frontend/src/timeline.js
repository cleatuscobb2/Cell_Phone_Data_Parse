/**
 * Shared timeline model — turns a custody report into positioned swim-lane
 * data. Consumed by both the interactive <Timeline> component and the PDF
 * renderer, so the two stay in sync.
 *
 * Every event is placed by `frac` (0..1) along the report's date range.
 */

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

const DAY = 86400000;

function parseDate(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function buildTimelineModel(report, meta) {
  if (!report) return null;

  const point = (e, color, title) => {
    const date = parseDate(e.date);
    return date ? { date, color, title } : null;
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

  // Domain — widest span across every dated item plus the report's range.
  const all = [
    ...childcare.map((e) => e.date),
    ...missed.map((e) => e.date),
    ...responsibility.map((e) => e.date),
    ...thirdparty.map((e) => e.date),
    ...gaps.flatMap((g) => [g.start, g.end]),
  ];
  for (const s of meta?.date_range || []) {
    const d = parseDate(s);
    if (d) all.push(d);
  }
  if (all.length === 0) return null;

  let start = new Date(Math.min(...all.map((d) => d.getTime())));
  let end = new Date(Math.max(...all.map((d) => d.getTime())));
  if (start.getTime() === end.getTime()) {
    start = new Date(start.getTime() - 15 * DAY);
    end = new Date(end.getTime() + 15 * DAY);
  }
  const span = end.getTime() - start.getTime();
  const frac = (d) => (d.getTime() - start.getTime()) / span;

  const byKey = { childcare, missed, responsibility, thirdparty };
  const lanes = TIMELINE_LANES.map((lane) => {
    if (lane.key === "gap") {
      return {
        ...lane,
        points: [],
        spans: gaps.map((g) => ({
          startFrac: frac(g.start),
          endFrac: frac(g.end),
          title: g.title,
        })),
        count: gaps.length,
      };
    }
    const points = (byKey[lane.key] || []).map((e) => ({
      frac: frac(e.date),
      color: e.color,
      title: e.title,
    }));
    return { ...lane, points, spans: [], count: points.length };
  });

  // Month gridline ticks.
  const ticks = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    if (cursor >= start) {
      ticks.push({
        frac: frac(cursor),
        label: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
      });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return {
    start,
    end,
    startLabel: start.toISOString().slice(0, 10),
    endLabel: end.toISOString().slice(0, 10),
    lanes,
    ticks,
  };
}
