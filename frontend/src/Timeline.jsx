/**
 * Timeline — an interactive swim-lane timeline of custody-relevant events.
 *
 * The history is broken into one chart per calendar year, each spanning a
 * full Jan–Dec with a vertical gridline per month, so seasonal patterns line
 * up across years. One lane per category; point events are markers
 * (missed/cancelled visits use diamond "milestone" markers) and
 * communication gaps are spans. Lanes can be toggled to isolate a pattern.
 */

import { useMemo, useState } from "react";
import { buildYearlyTimelineModels } from "./timeline.js";

// viewBox coordinate space — the SVG scales to its container width.
const W = 1000;
const LABEL_W = 172;
const PLOT_X0 = LABEL_W;
const PLOT_X1 = 985;
const PLOT_W = PLOT_X1 - PLOT_X0;
const AXIS_H = 24;
const LANE_H = 44;

const xOf = (frac) => PLOT_X0 + Math.max(0, Math.min(1, frac)) * PLOT_W;

function Marker({ lane, point }) {
  const cx = xOf(point.frac);
  const cy = lane._yMid;
  // Lanes may be split into per-parent sub-lanes, so match on the base lane.
  const isMilestone = (lane.baseKey || lane.key) === "missed";
  return (
    <g style={{ cursor: "pointer" }}>
      <title>{point.title}</title>
      {isMilestone ? (
        <polygon
          points={`${cx},${cy - 7} ${cx + 7},${cy} ${cx},${cy + 7} ${cx - 7},${cy}`}
          fill={point.color}
          stroke="#ffffff"
          strokeWidth={1.5}
        />
      ) : (
        <circle cx={cx} cy={cy} r={6} fill={point.color} stroke="#ffffff" strokeWidth={1.5} />
      )}
    </g>
  );
}

/** One year's swim-lane chart — a full Jan–Dec span with month gridlines. */
function YearChart({ model, hidden }) {
  // The filter chips are per base lane; hiding one hides all its sub-lanes.
  const visible = model.lanes.filter((l) => !hidden.has(l.baseKey || l.key));
  visible.forEach((lane, i) => {
    lane._yTop = AXIS_H + i * LANE_H;
    lane._yMid = lane._yTop + LANE_H / 2;
  });
  const height = AXIS_H + visible.length * LANE_H + 8;
  const yearTotal = model.lanes.reduce((s, l) => s + l.count, 0);

  return (
    <div className="mb-4">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-sm font-bold text-slate-700">{model.year}</span>
        <span className="text-xs text-slate-400">
          {yearTotal} {yearTotal === 1 ? "event" : "events"}
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-slate-400">All lanes hidden — re-enable one above.</p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${height}`}
          width="100%"
          role="img"
          aria-label={`Event timeline for ${model.year}`}
        >
          {/* Lane bands + labels */}
          {visible.map((lane, i) => (
            <g key={lane.key}>
              <rect
                x={0}
                y={lane._yTop}
                width={W}
                height={LANE_H}
                fill={i % 2 === 0 ? "#f8fafc" : "#ffffff"}
              />
              <text
                x={12}
                y={lane._yMid - 3}
                fontSize={12}
                fontWeight={600}
                fill={lane.color}
              >
                {lane.label}
              </text>
              <text x={12} y={lane._yMid + 11} fontSize={9} fill="#94a3b8">
                {lane.count} {lane.count === 1 ? "event" : "events"}
              </text>
            </g>
          ))}

          {/* Month gridlines + labels */}
          {model.ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={xOf(t.frac)}
                y1={AXIS_H}
                x2={xOf(t.frac)}
                y2={height - 8}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text
                x={xOf(t.frac) + 3}
                y={16}
                fontSize={9}
                fill="#94a3b8"
                textAnchor="start"
              >
                {t.label}
              </text>
            </g>
          ))}

          {/* Plot boundary */}
          <line
            x1={PLOT_X0}
            y1={AXIS_H}
            x2={PLOT_X0}
            y2={height - 8}
            stroke="#cbd5e1"
            strokeWidth={1}
          />

          {/* Events */}
          {visible.map((lane) => (
            <g key={`${lane.key}-events`}>
              {lane.spans.map((s, j) => {
                const x = xOf(s.startFrac);
                const w = Math.max(3, xOf(s.endFrac) - x);
                return (
                  <g key={j} style={{ cursor: "pointer" }}>
                    <title>{s.title}</title>
                    <rect
                      x={x}
                      y={lane._yMid - 7}
                      width={w}
                      height={14}
                      rx={2}
                      fill={lane.color}
                      fillOpacity={0.45}
                      stroke={lane.color}
                      strokeWidth={1}
                    />
                  </g>
                );
              })}
              {lane.points.map((p, j) => (
                <Marker key={j} lane={lane} point={p} />
              ))}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

export default function Timeline({ report, transcript }) {
  const data = useMemo(
    () => buildYearlyTimelineModels(report, transcript),
    [report, transcript],
  );
  const [hidden, setHidden] = useState(() => new Set());

  if (!data) {
    return (
      <p className="text-sm text-slate-400">
        Not enough dated events to build a timeline.
      </p>
    );
  }

  const toggle = (key) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div>
      {/* Filter chips — apply across every year */}
      <div className="mb-3 flex flex-wrap gap-2">
        {data.laneTotals.map((lane) => {
          const off = hidden.has(lane.key);
          return (
            <button
              key={lane.key}
              onClick={() => toggle(lane.key)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                off
                  ? "border-slate-200 bg-slate-50 text-slate-400 line-through"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: off ? "#cbd5e1" : lane.color }}
              />
              {lane.label} ({lane.count})
            </button>
          );
        })}
      </div>

      {data.years.map((model) => (
        <YearChart key={model.year} model={model} hidden={hidden} />
      ))}

      <p className="mt-1 text-xs text-slate-400">
        One chart per year · month gridlines mark seasonal patterns · diamonds
        mark missed or cancelled visits · hover any marker for detail.
      </p>
    </div>
  );
}
