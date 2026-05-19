/**
 * LoadingAnimation — a geometric processing animation shown while an
 * analysis runs.
 *
 * It draws the Fibonacci square tiling (sides 1, 1, 2, 3, 5, 8, 13, 21) on a
 * 34x21 golden-ratio canvas, with the golden spiral threaded through it as
 * eight tangent quarter-circle arcs. While it runs:
 *   - a light "counting" wave moves through the squares in Fibonacci order,
 *   - a comet traces the golden spiral from its eye outward,
 *   - the whole figure turns slowly.
 *
 * Pure SVG + CSS, no dependencies. Honors prefers-reduced-motion.
 */

import { useEffect, useState } from "react";

// Fibonacci squares as [x, y, side] — a perfect tiling of the 34x21 canvas.
const SQUARES = [
  [9, 5, 1],
  [8, 5, 1],
  [8, 6, 2],
  [10, 5, 3],
  [8, 0, 5],
  [0, 0, 8],
  [0, 8, 13],
  [13, 0, 21],
];

// The golden spiral: eight tangent quarter-circle arcs, eye -> outward.
const SPIRAL = [
  "M10 6",
  "A1 1 0 0 0 9 5",
  "A1 1 0 0 0 8 6",
  "A2 2 0 0 0 10 8",
  "A3 3 0 0 0 13 5",
  "A5 5 0 0 0 8 0",
  "A8 8 0 0 0 0 8",
  "A13 13 0 0 0 13 21",
  "A21 21 0 0 0 34 0",
].join(" ");

const SUMMARY_HINTS = [
  "Reading your conversations…",
  "Surfacing the key themes…",
  "Tracing the sentiment over time…",
  "Gathering the action items…",
];
const CUSTODY_HINTS = [
  "Reading texts and emails together…",
  "Identifying childcare instances…",
  "Flagging missed and cancelled visits…",
  "Classifying parenting responsibilities…",
  "Building the event timeline…",
];

const CYCLE_MS = 2600;

const CSS = `
.fib-sq {
  fill: #6366f1;
  fill-opacity: 0.05;
  stroke: #6366f1;
  stroke-width: 0.2;
  stroke-opacity: 0.28;
  animation: fibWave 2.6s ease-in-out infinite;
}
@keyframes fibWave {
  0%, 62%, 100% {
    stroke-opacity: 0.28;
    fill-opacity: 0.05;
    stroke-width: 0.2;
  }
  20% {
    stroke-opacity: 1;
    fill-opacity: 0.24;
    stroke-width: 0.42;
  }
}

.fib-spiral-base {
  fill: none;
  stroke: #fcd34d;
  stroke-width: 0.55;
  stroke-opacity: 0.5;
  stroke-linecap: round;
}
.fib-spiral-comet {
  fill: none;
  stroke: #f59e0b;
  stroke-width: 0.9;
  stroke-linecap: round;
  stroke-dasharray: 0.12 0.88;
  animation: fibComet 2.6s linear infinite;
}
@keyframes fibComet {
  from { stroke-dashoffset: 1; }
  to { stroke-dashoffset: 0; }
}

.fib-eye { fill: #f59e0b; animation: fibEye 2.6s ease-in-out infinite; }
@keyframes fibEye {
  0%, 100% { r: 0.5px; fill-opacity: 0.55; }
  50% { r: 0.85px; fill-opacity: 1; }
}

.fib-hint { animation: fibFade 2.6s ease-in-out; }
@keyframes fibFade {
  0% { opacity: 0; transform: translateY(3px); }
  14%, 86% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-3px); }
}

@media (prefers-reduced-motion: reduce) {
  .fib-sq, .fib-spiral-comet, .fib-eye, .fib-hint { animation: none; }
  .fib-sq { stroke-opacity: 0.55; }
}
`;

export default function LoadingAnimation({ mode = "summary" }) {
  const isCustody = mode === "custody";
  const hints = isCustody ? CUSTODY_HINTS : SUMMARY_HINTS;
  const [idx, setIdx] = useState(0);

  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    setIdx(0);
    const id = setInterval(
      () => setIdx((i) => (i + 1) % hints.length),
      CYCLE_MS,
    );
    return () => clearInterval(id);
  }, [mode, hints.length]);

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-white px-6 py-9 shadow-sm">
      <style>{CSS}</style>
      {/* The figure pivots on the spiral's eye (10, 6) — the point where
          the spiral converges, i.e. its true visual center. The viewBox is
          a 64x64 square centered on that same point; the figure's farthest
          corner sits ~28 units from the eye, so a full turn sweeps well
          inside the 32-unit half-extent with no cropping. */}
      <svg
        viewBox="-22 -26 64 64"
        width="272"
        height="272"
        role="img"
        aria-label="Processing"
      >
        <defs>
          <filter id="fibGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="0.45" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* The whole figure turns slowly. animateTransform rotates around
            the spiral's eye (10, 6) — an explicit center point, so the eye
            stays fixed and the spiral simply unwinds in place. */}
        <g>
          {!reduceMotion && (
            <animateTransform
              attributeName="transform"
              attributeType="XML"
              type="rotate"
              from="0 10 6"
              to="360 10 6"
              dur="30s"
              repeatCount="indefinite"
            />
          )}
          {SQUARES.map(([x, y, s], i) => (
            <rect
              key={i}
              className="fib-sq"
              x={x}
              y={y}
              width={s}
              height={s}
              style={{ animationDelay: `${(0.28 * i - 1.96).toFixed(2)}s` }}
            />
          ))}
          <path className="fib-spiral-base" d={SPIRAL} />
          <path
            className="fib-spiral-comet"
            d={SPIRAL}
            pathLength="1"
            filter="url(#fibGlow)"
          />
          {/* The spiral's eye — where the squares converge. */}
          <circle className="fib-eye" cx="10" cy="6" r="0.5" />
        </g>
      </svg>

      <div className="text-center">
        <p className="text-sm font-semibold text-slate-700">
          {isCustody
            ? "Building your custody report"
            : "Summarizing your messages"}
        </p>
        <p
          key={idx}
          className="fib-hint mx-auto mt-1 min-h-[1rem] text-xs text-slate-400"
        >
          {hints[idx]}
        </p>
      </div>

      <p className="max-w-sm text-center text-[11px] leading-relaxed text-slate-400">
        Everything is processed locally. Large multi-year histories are analyzed
        in time windows and can take a few minutes.
      </p>
    </div>
  );
}
