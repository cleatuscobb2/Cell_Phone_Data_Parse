/**
 * CustodyReportPDF — renders a custody report as a court-ready PDF document
 * using @react-pdf/renderer. Generated entirely in the browser, so the
 * message data never leaves the device.
 *
 * Includes: case context, disclaimer, summary stats, per-actor timelines,
 * and section summaries with verbatim citations. The verbose evidence — and
 * the complete chronological message log — lives in the evidence workbook;
 * the PDF stays a concise analysis overview with no appendix.
 */

import {
  Document,
  Line,
  Page,
  Polygon,
  Polyline,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import { buildYearlyTimelineModels } from "./timeline.js";
import {
  carePatternData,
  custodySplitData,
  missedByMonthAndTypeData,
  MISSED_TYPES,
  RESPONSIBILITY_LABELS,
} from "./chartData.js";
import { buildReportInsights, conciseOverview } from "./reportInsights.js";
import {
  requiredForms,
  FORM_EVIDENCE,
  EVIDENCE_LABELS,
  INTAKE_QUESTIONS,
} from "./custodyForms.js";
import { buildEvidenceRefs } from "./messageRefs.js";

const usd = (n) =>
  `$${Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 46,
    paddingHorizontal: 40,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#1e293b",
    lineHeight: 1.4,
  },
  header: {
    marginBottom: 8,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: "#334155",
    alignItems: "center",
  },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#0f172a",
    textAlign: "center",
    letterSpacing: 0.3,
    lineHeight: 1.2,
    marginBottom: 7,
  },
  headerMeta: { fontSize: 8.5, color: "#64748b", marginTop: 4, textAlign: "center" },
  subtitle: { fontSize: 9, color: "#64748b", marginTop: 2 },
  h2: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#334155",
    marginTop: 16,
    marginBottom: 6,
  },
  para: { marginBottom: 4 },
  disclaimer: {
    borderWidth: 1,
    borderColor: "#f59e0b",
    backgroundColor: "#fffbeb",
    padding: 8,
    marginTop: 12,
  },
  disclaimerTitle: {
    fontFamily: "Helvetica-Bold",
    color: "#92400e",
    marginBottom: 3,
  },
  disclaimerItem: { color: "#92400e", marginBottom: 1.5 },
  statRow: { flexDirection: "row", marginTop: 10 },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
    padding: 6,
    marginRight: 6,
    alignItems: "center",
  },
  statValue: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  statLabel: { fontSize: 6.5, color: "#94a3b8", textTransform: "uppercase", marginTop: 2 },
  evidence: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 3,
    padding: 6,
    marginBottom: 4,
  },
  evidenceHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  evidenceDate: { fontFamily: "Helvetica-Bold", color: "#475569", fontSize: 8 },
  source: { fontFamily: "Helvetica", color: "#7c3aed" },
  badge: { fontSize: 7, color: "#be123c", fontFamily: "Helvetica-Bold" },
  quote: {
    fontStyle: "italic",
    color: "#64748b",
    marginTop: 3,
    paddingLeft: 6,
    borderLeftWidth: 2,
    borderLeftColor: "#cbd5e1",
  },
  bullet: { flexDirection: "row", marginBottom: 2 },
  bulletDot: { width: 10, color: "#f59e0b" },
  txRow: { flexDirection: "row", marginBottom: 1.5 },
  txMeta: { width: 150, color: "#64748b", fontSize: 7.5 },
  txBody: { flex: 1, fontSize: 8 },
  footer: {
    position: "absolute",
    bottom: 22,
    left: 40,
    right: 40,
    fontSize: 7,
    color: "#94a3b8",
    textAlign: "center",
  },
  empty: { color: "#94a3b8", marginBottom: 4 },
  caption: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#64748b",
    marginTop: 8,
    marginBottom: 2,
  },
});

const PDF_COLORS = {
  mother: "#6366f1",
  father: "#f97316",
  shared: "#f59e0b",
  unclear: "#94a3b8",
  missed: "#e11d48",
};

const CARE_SERIES = [
  { key: "mother", color: PDF_COLORS.mother, label: "With mother" },
  { key: "father", color: PDF_COLORS.father, label: "With father" },
];
// One stacked series per missed/cancelled kind — shared color scheme.
const MISSED_TYPE_SERIES = MISSED_TYPES.map((t) => ({
  key: t.key,
  color: t.color,
  label: t.label,
}));
const RESP_SERIES = [
  { key: "mother", color: PDF_COLORS.mother, label: "With mother" },
  { key: "father", color: PDF_COLORS.father, label: "With father" },
  { key: "shared", color: PDF_COLORS.shared, label: "Shared" },
  { key: "unclear", color: PDF_COLORS.unclear, label: "Unclear" },
];

const SUGGESTION_LABEL = {
  attachment: "Attachment",
  key_statement: "Key statement",
  evidence_to_gather: "Gather evidence",
  follow_up: "Follow-up",
  other: "Suggestion",
};

/** Horizontal proportion bar — the overall custody split. */
function PdfProportionBar({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return <Text style={styles.empty}>No childcare instances were identified.</Text>;
  }
  return (
    <View wrap={false} style={{ marginTop: 2, marginBottom: 4 }}>
      <View
        style={{
          flexDirection: "row",
          height: 22,
          borderRadius: 3,
          borderWidth: 1,
          borderColor: "#e2e8f0",
        }}
      >
        {data.map((d) => (
          <View
            key={d.key}
            style={{
              flexGrow: d.value,
              flexBasis: 0,
              backgroundColor: PDF_COLORS[d.key],
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            {d.value / total > 0.12 ? (
              <Text style={{ fontSize: 7, color: "#ffffff", fontFamily: "Helvetica-Bold" }}>
                {Math.round((d.value / total) * 100)}%
              </Text>
            ) : null}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
        {data.map((d) => (
          <View
            key={d.key}
            style={{ flexDirection: "row", alignItems: "center", marginRight: 12 }}
          >
            <View
              style={{
                width: 7,
                height: 7,
                backgroundColor: PDF_COLORS[d.key],
                borderRadius: 1.5,
                marginRight: 3,
              }}
            />
            <Text style={{ fontSize: 7.5 }}>
              {d.label}: {d.value} ({Math.round((d.value / total) * 100)}%)
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Vertical bar chart — single series, or stacked when given several. */
function PdfBarChart({ data, labelKey, series, height = 78 }) {
  if (!data || data.length === 0) {
    return <Text style={styles.empty}>Not enough dated data to chart.</Text>;
  }
  const max = Math.max(
    1,
    ...data.map((d) => series.reduce((s, sr) => s + (d[sr.key] || 0), 0)),
  );
  // Adapt to column count so multi-year (many-month) spans stay legible.
  const n = data.length;
  const barW = n > 36 ? 3 : n > 20 ? 7 : n > 12 ? 12 : 18;
  const gap = n > 36 ? 0.4 : n > 20 ? 0.8 : 1.5;
  const showValues = n <= 24;
  const labelEvery = n > 48 ? 6 : n > 24 ? 3 : n > 14 ? 2 : 1;
  return (
    <View wrap={false} style={{ marginTop: 2, marginBottom: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
        {data.map((d, i) => {
          const total = series.reduce((s, sr) => s + (d[sr.key] || 0), 0);
          return (
            <View key={i} style={{ flex: 1, alignItems: "center", marginHorizontal: gap }}>
              {showValues ? (
                <Text style={{ fontSize: 6, color: "#64748b", marginBottom: 1 }}>{total}</Text>
              ) : null}
              <View style={{ width: barW, flexDirection: "column-reverse" }}>
                {series.map((sr) => {
                  const v = d[sr.key] || 0;
                  return v > 0 ? (
                    <View
                      key={sr.key}
                      style={{
                        width: barW,
                        height: (v / max) * height,
                        backgroundColor: sr.color,
                      }}
                    />
                  ) : null;
                })}
              </View>
            </View>
          );
        })}
      </View>
      <View style={{ height: 1, backgroundColor: "#cbd5e1" }} />
      <View style={{ flexDirection: "row", marginTop: 2 }}>
        {data.map((d, i) => (
          <Text
            key={i}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 6,
              color: "#64748b",
              marginHorizontal: gap,
            }}
          >
            {i % labelEvery === 0 ? d[labelKey] : ""}
          </Text>
        ))}
      </View>
      {series.length > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
          {series.map((sr) => (
            <View
              key={sr.key}
              style={{ flexDirection: "row", alignItems: "center", marginRight: 10 }}
            >
              <View style={{ width: 7, height: 7, backgroundColor: sr.color, marginRight: 3 }} />
              <Text style={{ fontSize: 7 }}>{sr.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Horizontal bar chart — best when categories have long names. Single
    series, or stacked when given several. Each bar sits in a track so its
    share of the maximum reads at a glance. */
function PdfHBar({ data, labelKey, series, barH = 12, money = false, maxRows = 20 }) {
  if (!data || data.length === 0) {
    return <Text style={styles.empty}>Not enough data to chart.</Text>;
  }
  // Cap rows: a wrap={false} chart taller than the page gets clipped, and a
  // 40-row bar chart is unreadable anyway. Rows arrive sorted by size, so
  // the cut keeps the biggest and says how many it dropped.
  const shown = data.slice(0, maxRows);
  const dropped = data.length - shown.length;
  const fmt = (v) =>
    money
      ? `$${Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`
      : String(v);
  const max = Math.max(
    1,
    ...data.map((d) => series.reduce((s, sr) => s + (d[sr.key] || 0), 0)),
  );
  return (
    <View wrap={false} style={{ marginTop: 2, marginBottom: 4 }}>
      {shown.map((d, i) => {
        const total = series.reduce((s, sr) => s + (d[sr.key] || 0), 0);
        return (
          <View
            key={i}
            style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}
          >
            <Text
              style={{ width: 124, fontSize: 7, color: "#475569", paddingRight: 5 }}
            >
              {d[labelKey]}
            </Text>
            <View
              style={{
                flex: 1,
                flexDirection: "row",
                height: barH,
                borderRadius: 2,
                overflow: "hidden",
                backgroundColor: "#f1f5f9",
              }}
            >
              <View style={{ flexGrow: total, flexBasis: 0, flexDirection: "row" }}>
                {series.map((sr) => {
                  const v = d[sr.key] || 0;
                  return v > 0 ? (
                    <View
                      key={sr.key}
                      style={{ flexGrow: v, flexBasis: 0, backgroundColor: sr.color }}
                    />
                  ) : null;
                })}
              </View>
              <View style={{ flexGrow: Math.max(0.0001, max - total), flexBasis: 0 }} />
            </View>
            <View
              style={{
                width: d.motherPct != null ? 66 : money ? 40 : 18,
                flexDirection: "row",
                justifyContent: "flex-end",
                alignItems: "baseline",
              }}
            >
              <Text
                style={{ fontSize: 7, color: "#475569", fontFamily: "Helvetica-Bold" }}
              >
                {fmt(total)}
              </Text>
              {d.motherPct != null ? (
                <Text
                  style={{ fontSize: 6.5, fontFamily: "Helvetica-Bold", marginLeft: 4 }}
                >
                  <Text style={{ color: PDF_COLORS.mother }}>{d.motherPct}%</Text>
                  <Text style={{ color: "#cbd5e1" }}> · </Text>
                  <Text style={{ color: PDF_COLORS.father }}>{d.fatherPct}%</Text>
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
      {dropped > 0 ? (
        <Text style={{ fontSize: 6.5, color: "#94a3b8" }}>
          +{dropped} smaller {dropped === 1 ? "row" : "rows"} — full detail in
          the evidence workbook.
        </Text>
      ) : null}
      {series.length > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 3 }}>
          {series.map((sr) => (
            <View
              key={sr.key}
              style={{ flexDirection: "row", alignItems: "center", marginRight: 10 }}
            >
              <View style={{ width: 7, height: 7, backgroundColor: sr.color, marginRight: 3 }} />
              <Text style={{ fontSize: 7 }}>{sr.label}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Radar (spider) chart — overlays two series across N category axes. */
function PdfRadar({ data, series }) {
  const N = data.length;
  if (N < 3) {
    return <Text style={styles.empty}>Not enough categories to chart.</Text>;
  }
  const SIZE = 230;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const R = 72;
  const max = Math.max(
    1,
    ...data.flatMap((d) => series.map((s) => d[s.key] || 0)),
  );
  const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  const at = (i, dist) => [
    cx + dist * Math.cos(angle(i)),
    cy + dist * Math.sin(angle(i)),
  ];
  const polyPoints = (key) =>
    data
      .map((d, i) => {
        const [x, y] = at(i, ((d[key] || 0) / max) * R);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  const ringPoints = (frac) =>
    data
      .map((_, i) => {
        const [x, y] = at(i, frac * R);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <View wrap={false} style={{ marginTop: 4, marginBottom: 4, alignItems: "center" }}>
      <View style={{ width: SIZE, height: SIZE, position: "relative" }}>
        <Svg width={SIZE} height={SIZE}>
          {[0.25, 0.5, 0.75, 1].map((f, i) => (
            <Polygon key={i} points={ringPoints(f)} fill="none" stroke="#e2e8f0" strokeWidth={0.5} />
          ))}
          {data.map((_, i) => {
            const [x, y] = at(i, R);
            return (
              <Line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e2e8f0" strokeWidth={0.5} />
            );
          })}
          {series.map((s) => (
            <Polygon
              key={s.key}
              points={polyPoints(s.key)}
              fill={s.color}
              fillOpacity={0.25}
              stroke={s.color}
              strokeWidth={1.4}
            />
          ))}
        </Svg>
        {data.map((d, i) => {
          const [lx, ly] = at(i, R + 15);
          return (
            <View
              key={i}
              style={{
                position: "absolute",
                left: lx - 30,
                top: ly - 7,
                width: 60,
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 6, color: "#475569" }}>{d.category}</Text>
              <Text style={{ fontSize: 5.5, fontFamily: "Helvetica-Bold" }}>
                <Text style={{ color: PDF_COLORS.mother }}>
                  {d.motherPct ?? 0}%
                </Text>
                <Text style={{ color: "#cbd5e1" }}> · </Text>
                <Text style={{ color: PDF_COLORS.father }}>
                  {d.fatherPct ?? 0}%
                </Text>
              </Text>
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", marginTop: 2 }}>
        {series.map((s) => (
          <View
            key={s.key}
            style={{ flexDirection: "row", alignItems: "center", marginRight: 14 }}
          >
            <View style={{ width: 8, height: 8, backgroundColor: s.color, marginRight: 3 }} />
            <Text style={{ fontSize: 8 }}>{s.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const PLOT_W = 420;
const LABEL_W = 95;
const LANE_H = 34;
// Per-actor plot geometry: trend sparkline, marker row, per-month counts.
const SPARK_H = 12;
const MARK_H = 12;
const COUNT_H = 7;

/** A 12-point trend line across the year's monthly counts. */
function Sparkline({ values, width, height, color }) {
  const max = Math.max(1, ...values);
  const pts = values
    .map((v, i) => {
      const x = ((i + 0.5) / 12) * width;
      const y = height - 1 - (v / max) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <Svg width={width} height={height}>
      <Polyline points={pts} fill="none" stroke={color} strokeWidth={0.9} />
    </Svg>
  );
}

/** One actor's strip for a year: trend sparkline, dated markers, and the
    per-month instance counts underneath. */
function PdfGroupPlot({ group, plotW }) {
  const mk = group.points.length > 90 ? 3.5 : group.points.length > 45 ? 4.5 : 6;
  const max = Math.max(...group.monthly, 0);
  return (
    <View style={{ flexDirection: "row", marginBottom: 3 }} wrap={false}>
      <View style={{ width: LABEL_W, paddingRight: 4, justifyContent: "center" }}>
        <Text style={{ fontSize: 7, fontFamily: "Helvetica-Bold", color: group.color }}>
          {group.label}
        </Text>
        <Text style={{ fontSize: 6.5, color: "#94a3b8" }}>
          {group.total} {group.total === 1 ? "entry" : "entries"}
        </Text>
      </View>
      <View style={{ width: plotW }}>
        <Sparkline
          values={group.monthly}
          width={plotW}
          height={SPARK_H}
          color={group.color}
        />
        <View style={{ width: plotW, height: MARK_H }}>
          {group.monthly.map((_, m) => (
            <View
              key={`g${m}`}
              style={{
                position: "absolute",
                left: (m / 12) * plotW,
                top: 0,
                width: 0.4,
                height: MARK_H,
                backgroundColor: "#eef2f7",
              }}
            />
          ))}
          <View
            style={{
              position: "absolute",
              left: 0,
              top: MARK_H / 2,
              width: plotW,
              height: 0.4,
              backgroundColor: "#cbd5e1",
            }}
          />
          {group.spans.map((s, j) => (
            <View
              key={`s${j}`}
              style={{
                position: "absolute",
                left: s.startFrac * plotW,
                top: MARK_H / 2 - 3,
                width: Math.max(2, (s.endFrac - s.startFrac) * plotW),
                height: 6,
                backgroundColor: group.color,
                opacity: 0.5,
                borderRadius: 2,
              }}
            />
          ))}
          {group.points.map((p, j) => (
            <View
              key={`p${j}`}
              style={{
                position: "absolute",
                left: p.frac * plotW - mk / 2,
                top: MARK_H / 2 - mk / 2,
                width: mk,
                height: mk,
                backgroundColor: p.color,
                // Missed / cancelled render square so they stand out.
                borderRadius: p.kind === "missed" ? 0 : mk / 2,
                borderWidth: 0.4,
                borderColor: "#ffffff",
              }}
            />
          ))}
        </View>
        <View style={{ width: plotW, height: COUNT_H, flexDirection: "row" }}>
          {group.monthly.map((c, m) => (
            <Text
              key={`c${m}`}
              style={{
                width: plotW / 12,
                textAlign: "center",
                fontSize: 6.5,
                fontFamily: c > 0 && c === max ? "Helvetica-Bold" : "Helvetica",
                color: c === 0 ? "#cbd5e1" : c === max ? group.color : "#64748b",
              }}
            >
              {c}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

/** One year of the timeline as separate per-actor plots stacked on a page. */
function PdfTimelineYear({ model, plotW = PLOT_W }) {
  const yearTotal = model.groups.reduce((s, g) => s + g.total, 0);
  return (
    <View wrap={false} style={{ marginTop: 8 }}>
      <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: "#334155" }}>
        {model.year}{" "}
        <Text style={{ fontSize: 7, fontFamily: "Helvetica", color: "#94a3b8" }}>
          · {yearTotal} {yearTotal === 1 ? "entry" : "entries"}
        </Text>
      </Text>
      <View style={{ flexDirection: "row", marginTop: 2 }}>
        <View style={{ width: LABEL_W }} />
        <View style={{ width: plotW, flexDirection: "row" }}>
          {model.months.map((m, i) => (
            <Text
              key={i}
              style={{
                width: plotW / 12,
                textAlign: "center",
                fontSize: 7,
                color: "#64748b",
              }}
            >
              {m}
            </Text>
          ))}
        </View>
      </View>
      {model.groups.map((g) => (
        <PdfGroupPlot key={g.key} group={g} plotW={plotW} />
      ))}
      {/* This year's summary, right under its plots. */}
      <View
        style={{
          flexDirection: "row",
          marginTop: 3,
          paddingTop: 3,
          borderTopWidth: 0.5,
          borderTopColor: "#e2e8f0",
        }}
      >
        <Text style={{ width: LABEL_W, fontSize: 7, fontFamily: "Helvetica-Bold", color: "#475569" }}>
          {model.year} summary
        </Text>
        <Text style={{ flex: 1, fontSize: 7, color: "#475569" }}>
          {model.groups
            .filter((g) => g.total > 0)
            .map((g) => {
              const peak = Math.max(...g.monthly);
              const peakMonth = model.months[g.monthly.indexOf(peak)];
              return `${g.label}: ${g.total}${peak > 0 ? ` (peak ${peakMonth}, ${peak})` : ""}`;
            })
            .join(" · ") || "No entries this year."}
        </Text>
      </View>
    </View>
  );
}

const CHANNEL_LABEL = {
  email: "Email",
  text: "Text",
  document: "Document",
  unclear: "Source unclear",
};

// Medical appointment register — a compact fixed-width table.
const medStyles = StyleSheet.create({
  headRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 2,
    marginBottom: 2,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.3,
    borderBottomColor: "#f1f5f9",
    paddingVertical: 1.5,
  },
  cell: { fontSize: 6.5, paddingRight: 3 },
  head: { fontFamily: "Helvetica-Bold", color: "#475569" },
  date: { width: 46 },
  child: { width: 40 },
  type: { width: 74 },
  prov: { width: 74 },
  role: { width: 42 },
  amt: { width: 40, textAlign: "right" },
});

/** A party cell, tinted to the parent so the table scans quickly. */
function partyStyle(party) {
  if (party === "mother") return { color: PDF_COLORS.mother };
  if (party === "father") return { color: PDF_COLORS.father };
  if (party === "shared") return { color: PDF_COLORS.shared };
  return { color: "#94a3b8" };
}

/** "mother" renders as the filer's actual role word; unclear renders as a dash. */
function partyText(party, meta) {
  if (party === "mother") return meta.user_role || "mother";
  if (party === "father") return "father";
  if (party === "shared") return "shared";
  return "—";
}

function EvidenceItem({
  date,
  channel,
  badge,
  description,
  quote,
  sender,
  sourceRef,
}) {
  const src = CHANNEL_LABEL[channel];
  return (
    <View style={styles.evidence} wrap={false}>
      <View style={styles.evidenceHead}>
        <Text style={styles.evidenceDate}>
          {date || "date unclear"}
          {src ? <Text style={styles.source}> · {src}</Text> : null}
          {sourceRef ? (
            <Text style={{ fontFamily: "Helvetica-Bold", color: "#475569" }}>
              {" "}· {sourceRef}
            </Text>
          ) : null}
        </Text>
        {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      </View>
      <Text>{description}</Text>
      {quote ? (
        <Text style={styles.quote}>
          &ldquo;{quote}&rdquo;{sender ? `  — ${sender}` : ""}
        </Text>
      ) : null}
    </View>
  );
}

/** A label / value row for the provenance settings block. */
function PdfKV({ label, value }) {
  return (
    <View style={{ flexDirection: "row", marginBottom: 1.5 }}>
      <Text style={{ width: 150, color: "#64748b" }}>{label}</Text>
      <Text style={{ flex: 1, fontFamily: "Helvetica-Bold" }}>
        {value || "—"}
      </Text>
    </View>
  );
}

/**
 * Tone of co-parenting communications — a concise read by year and parent,
 * with the trend across the period and a representative message for each.
 * Reports generated before `tone_by_period` existed fall back to the single
 * narrative paragraph so older reports still render.
 */
function ToneSection({ report, meta }) {
  const periods = Array.isArray(report.tone_by_period)
    ? report.tone_by_period
    : [];
  if (periods.length === 0) {
    return (
      <View break>
        <Text style={styles.h2}>Tone of Co-Parenting Communications</Text>
        <Text style={styles.para}>{report.sentiment_overview}</Text>
      </View>
    );
  }
  const byYear = {};
  const years = [];
  for (const p of periods) {
    const y = String(p.period || "").slice(0, 4) || "—";
    if (!byYear[y]) {
      byYear[y] = [];
      years.push(y);
    }
    byYear[y].push(p);
  }
  years.sort();
  const toneColor = (label) =>
    label === "positive" ? "#059669" : label === "negative" ? "#dc2626" : "#64748b";
  return (
    <View break>
      <Text style={styles.h2}>Tone of Co-Parenting Communications</Text>
      <Text style={styles.caption}>
        Tone by year and parent — the supporting messages are in the evidence
        workbook&rsquo;s Message Log tab.
      </Text>
      {years.map((y) => (
        <View key={y} style={{ marginBottom: 5 }} wrap={false}>
          <Text style={{ fontFamily: "Helvetica-Bold", marginBottom: 1 }}>{y}</Text>
          {byYear[y].map((r, i) => (
            <View key={i} style={{ marginBottom: 2, paddingLeft: 6 }}>
              <Text>
                <Text
                  style={{
                    fontFamily: "Helvetica-Bold",
                    color:
                      r.party === "father" ? PDF_COLORS.father : PDF_COLORS.mother,
                  }}
                >
                  {r.party === "father" ? "Father" : meta.user_role}
                </Text>
                {" — "}
                <Text style={{ color: toneColor(r.label) }}>
                  {r.label || "neutral"}
                </Text>
                {r.summary ? ` · ${r.summary}` : ""}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function Section({ title, items, empty, render, chart }) {
  return (
    <View>
      <Text style={styles.h2}>{title}</Text>
      {chart || null}
      {items.length === 0 ? (
        <Text style={styles.empty}>{empty}</Text>
      ) : (
        items.map((it, i) => <View key={i}>{render(it)}</View>)
      )}
    </View>
  );
}

export default function CustodyReportPDF({ data, orientation = "portrait" }) {
  const { meta, custody_breakdown: cb, report, transcript = [] } = data;
  const landscape = orientation === "landscape";
  // Landscape gives the timeline more horizontal room — the chief reason
  // for offering the alternate layout. The plot must fit the page content
  // box: 712pt wide in landscape (792 − 80 padding), less the 95pt lane-label
  // column and a few pt of marker-label overhang on the right edge.
  const timelinePlotW = landscape ? 600 : PLOT_W;
  const timeline = buildYearlyTimelineModels(report, transcript);
  // Ref-annotated transcript + a linker from each event to its source message.
  const { refed, expenses, link } = buildEvidenceRefs(data);
  const caseProfile = meta.case_profile || {};
  const requiredFormList = Object.keys(caseProfile).length
    ? requiredForms(caseProfile)
    : [];
  const evidenceCount = {
    childcare: report.childcare_events.length,
    missed: report.missed_or_cancelled.length,
    gaps: report.communication_gaps.length,
    responsibilities: report.responsibility_events.length,
    thirdparty: report.third_party_statements.length,
  };
  const jur = meta.jurisdiction || {};
  const jurLabel = jur.county
    ? `${jur.county} County, ${jur.state || "West Virginia"}`
    : null;
  const dateFilter = meta.date_filter || {};
  const dateFilterLabel =
    dateFilter.start || dateFilter.end
      ? `${dateFilter.start || "earliest"} to ${dateFilter.end || "latest"}`
      : "None — full history";
  const custodySplit = custodySplitData(cb);
  const carePattern = carePatternData(report);
  const missedMonthly = missedByMonthAndTypeData(report);
  const missedSeries = MISSED_TYPE_SERIES.filter((s) =>
    missedMonthly.some((r) => r[s.key] > 0),
  );
  // Everything derived — financial rollup and who actually paid, the missed
  // summary, responsibility charts and themes, and the At-a-Glance findings —
  // comes from the shared insights model, so the PDF and the on-screen report
  // always state the same numbers.
  const {
    fin,
    finFindings,
    finSolePayer,
    finPayerLabel,
    finTotalShown,
    missed,
    responsibilities,
    radarData,
    respThemes,
    medical,
    medSummary,
    care,
    thirdParty,
    findings,
    sca106,
    scaNeedsAttribution,
    parentCompare,
  } = buildReportInsights(data);
  const overviewText = conciseOverview(report.overview);

  const finPayerColor =
    finSolePayer === "father" ? PDF_COLORS.father : PDF_COLORS.mother;
  // Single-series spec for the per-category sub-category charts.
  const SUB_SERIES = [{ key: "amount", color: finPayerColor, label: "Paid" }];
  // Flatten by_category for PdfHBar (which wants top-level series keys).
  const finCategoryRows = fin.by_category.map((c) => ({
    full: c.label,
    mother: c.totals.mother,
    father: c.totals.father,
    shared: c.totals.shared,
    unclear: c.totals.unclear,
  }));
  const missedStats = [
    { label: "Total missed / cancelled", value: missed.total, color: null },
    ...(missed.hasParty
      ? [
          {
            label: `By ${meta.user_role}`,
            value: missed.byParty.mother,
            color: PDF_COLORS.mother,
          },
          { label: "By father", value: missed.byParty.father, color: PDF_COLORS.father },
          ...(missed.byParty.unclear
            ? [{ label: "Unattributed", value: missed.byParty.unclear, color: null }]
            : []),
        ]
      : [{ label: "Years affected", value: missed.byYear.length, color: null }]),
  ];

  const RADAR_SERIES = [
    { key: "mother", color: PDF_COLORS.mother, label: `With ${meta.user_role}` },
    { key: "father", color: PDF_COLORS.father, label: "With father" },
  ];
  const generated = new Date().toISOString().slice(0, 10);
  const children = meta.children?.length ? meta.children.join(", ") : "not specified";
  const period =
    meta.date_range?.length === 2
      ? `${meta.date_range[0]} to ${meta.date_range[1]}`
      : "—";

  return (
    <Document title="Custodia — Care, Responsibility &amp; Expense Report">
      <Page
        size="LETTER"
        orientation={landscape ? "landscape" : "portrait"}
        style={styles.page}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Care, Responsibility &amp; Expense Report</Text>
          <Text style={styles.headerMeta}>
            Prepared by the children&rsquo;s {meta.user_role} · Other parent:{" "}
            {meta.other_parent}
          </Text>
          <Text style={styles.headerMeta}>
            Children: {children} · Period analyzed: {period} · Generated: {generated}
            {meta.windows > 1 ? ` · Analyzed in ${meta.windows} time windows` : ""}
          </Text>
        </View>

        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerTitle}>
            Nature of this document — read first
          </Text>
          <Text style={styles.disclaimerItem}>
            • This report organizes events extracted from the {meta.user_role}&rsquo;s
            own text-message history. The original messages are the evidence; every
            item below quotes its source message so it can be verified.
          </Text>
          <Text style={styles.disclaimerItem}>
            • It was produced with the assistance of automated (AI) analysis, which
            can miss or misclassify messages. All counts and percentages are
            estimates and should be independently verified.
          </Text>
          <Text style={styles.disclaimerItem}>
            • It covers text messages only — not school, medical, or court records.
          </Text>
          <Text style={styles.disclaimerItem}>
            • It is an organizational aid, not legal advice and not a substitute for
            counsel&rsquo;s review.
          </Text>
        </View>

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{meta.total_messages}</Text>
            <Text style={styles.statLabel}>Messages analyzed</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{cb.estimated_pct_mother}%</Text>
            <Text style={styles.statLabel}>Est. time with {meta.user_role}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{cb.estimated_pct_father}%</Text>
            <Text style={styles.statLabel}>Est. time with father</Text>
          </View>
          <View style={[styles.stat, { marginRight: 0 }]}>
            <Text style={styles.statValue}>{report.missed_or_cancelled.length}</Text>
            <Text style={styles.statLabel}>Missed / cancelled</Text>
          </View>
        </View>

        <Text style={styles.h2}>Overview</Text>
        <Text style={styles.para}>{overviewText.text}</Text>
        {overviewText.truncated ? (
          <Text style={[styles.caption, { color: "#94a3b8" }]}>
            Condensed — the full narrative is in the evidence workbook&rsquo;s
            Summary tab; At a Glance below carries the key findings.
          </Text>
        ) : null}

        {parentCompare ? (
          <View wrap={false} style={{ marginTop: 4 }}>
            <Text style={styles.caption}>
              Side by side — counts from the evidence in this report, not
              judgments
            </Text>
            <View
              style={{
                flexDirection: "row",
                borderBottomWidth: 0.5,
                borderBottomColor: "#cbd5e1",
                paddingBottom: 2,
                marginBottom: 2,
              }}
            >
              <Text style={{ width: 92 }} />
              <Text
                style={{
                  flex: 1,
                  fontSize: 7.5,
                  fontFamily: "Helvetica-Bold",
                  color: PDF_COLORS.mother,
                  paddingRight: 6,
                }}
              >
                {meta.user_role}
              </Text>
              <Text
                style={{
                  flex: 1,
                  fontSize: 7.5,
                  fontFamily: "Helvetica-Bold",
                  color: PDF_COLORS.father,
                }}
              >
                Father
              </Text>
            </View>
            {parentCompare.rows.map((r) => (
              <View
                key={r.key}
                style={{
                  flexDirection: "row",
                  borderBottomWidth: 0.3,
                  borderBottomColor: "#f1f5f9",
                  paddingVertical: 2,
                }}
              >
                <Text
                  style={{
                    width: 92,
                    fontSize: 7,
                    fontFamily: "Helvetica-Bold",
                    color: "#64748b",
                    paddingRight: 4,
                  }}
                >
                  {r.dim}
                </Text>
                <Text style={{ flex: 1, fontSize: 7.5, color: "#334155", paddingRight: 6 }}>
                  • {parentCompare.mother[r.key]}
                </Text>
                <Text style={{ flex: 1, fontSize: 7.5, color: "#334155" }}>
                  • {parentCompare.father[r.key]}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* The shape of the case up front, computed from the evidence below,
            so the reader gets the picture without reading the whole report. */}
        {findings.length > 0 ? (
          <View wrap={false}>
            <Text style={styles.h2}>At a Glance</Text>
            <Text style={styles.caption}>
              Computed directly from the evidence in this report — every figure
              below is supported by the detail sections and the evidence
              workbook.
            </Text>
            {findings.map((f, i) => (
              <View key={i} style={styles.bullet}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={{ flex: 1 }}>{f}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {requiredFormList.length > 0 ? (
          <View>
            <Text style={styles.h2} break>
              Required WV Filing Forms
              {jurLabel ? ` — ${jurLabel}` : ""}
            </Text>
            <Text style={styles.caption}>
              {jurLabel
                ? `The form packet to file with the Family Court in ${jurLabel}, with the report evidence supporting each`
                : "The West Virginia form packet for this case, with the report evidence supporting each"}
            </Text>
            {requiredFormList.map((f, i) => {
              const ev = FORM_EVIDENCE[f.id] || [];
              return (
                <View key={i} style={styles.evidence} wrap={false}>
                  <Text>
                    <Text style={{ fontFamily: "Helvetica-Bold" }}>
                      {f.number}
                    </Text>{" "}
                    — {f.title}
                  </Text>
                  <Text style={{ color: "#64748b" }}>{f.reason}</Text>
                  {ev.length > 0 ? (
                    <Text style={{ color: "#475569", marginTop: 2 }}>
                      Supporting evidence:{" "}
                      {ev
                        .map((k) =>
                          evidenceCount[k] != null
                            ? `${EVIDENCE_LABELS[k]} (${evidenceCount[k]})`
                            : EVIDENCE_LABELS[k],
                        )
                        .join(", ")}
                    </Text>
                  ) : null}
                </View>
              );
            })}
            <Text style={[styles.para, { color: "#94a3b8", marginTop: 2 }]}>
              Note: West Virginia&rsquo;s family-court (SCA-FC) forms are
              uniform statewide — the county determines the filing court and
              any local cover sheets or fees, not the form set itself. File the
              completed packet with the Circuit Clerk / Family Court in{" "}
              {jurLabel || "the county where the child lives"}, and confirm the
              current forms and any county-specific addenda with the court or
              counsel.
            </Text>
          </View>
        ) : null}

        <Text style={styles.h2} break>Custody Breakdown</Text>
        <Text style={styles.para}>
          Childcare instances identified — with {meta.user_role}:{" "}
          {cb.instances_with_mother}; with father: {cb.instances_with_father};
          shared: {cb.instances_shared}; unclear: {cb.instances_unclear}.
        </Text>
        <Text style={styles.para}>{report.breakdown_basis}</Text>

        <Text style={styles.caption}>Custody split — share of childcare instances</Text>
        <PdfProportionBar data={custodySplit} />
        <Text style={styles.caption}>
          Care pattern over time — childcare instances per month
        </Text>
        <PdfBarChart data={carePattern} labelKey="month" series={CARE_SERIES} />
        {care.total > 0 ? (
          <View wrap={false}>
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{care.total}</Text>
                <Text style={styles.statLabel}>Childcare instances</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: PDF_COLORS.mother }]}>
                  {care.byParty.mother}
                </Text>
                <Text style={styles.statLabel}>With {meta.user_role}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: PDF_COLORS.father }]}>
                  {care.byParty.father}
                </Text>
                <Text style={styles.statLabel}>With father</Text>
              </View>
              <View style={[styles.stat, { marginRight: 0 }]}>
                <Text style={styles.statValue}>
                  {care.busiest ? `${care.busiest.year} (${care.busiest.total})` : "—"}
                </Text>
                <Text style={styles.statLabel}>Busiest year</Text>
              </View>
            </View>
            <Text style={[styles.caption, { marginTop: 4 }]}>By year and parent</Text>
            <View style={medStyles.headRow}>
              <Text style={[medStyles.cell, { width: 60 }, medStyles.head]}>Year</Text>
              <Text style={[medStyles.cell, { width: 60 }, medStyles.head]}>Total</Text>
              <Text style={[medStyles.cell, { width: 80 }, medStyles.head, { color: PDF_COLORS.mother }]}>
                {meta.user_role}
              </Text>
              <Text style={[medStyles.cell, { width: 80 }, medStyles.head, { color: PDF_COLORS.father }]}>
                Father
              </Text>
              <Text style={[medStyles.cell, { width: 60 }, medStyles.head]}>Shared</Text>
            </View>
            {care.byYear.map((y) => (
              <View key={y.year} style={medStyles.row}>
                <Text style={[medStyles.cell, { width: 60 }]}>{y.year}</Text>
                <Text style={[medStyles.cell, { width: 60 }]}>{y.total}</Text>
                <Text style={[medStyles.cell, { width: 80, color: PDF_COLORS.mother }]}>{y.mother}</Text>
                <Text style={[medStyles.cell, { width: 80, color: PDF_COLORS.father }]}>{y.father}</Text>
                <Text style={[medStyles.cell, { width: 60 }]}>{y.shared}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={styles.h2} break>Event Timeline</Text>
        {timeline ? (
          <View>
            {/* One year per page — a year split across a page break is
                unreadable, so each starts fresh and never wraps. */}
            {timeline.years.map((ym, i) => (
              <View key={ym.year} break={i > 0} wrap={false}>
                <PdfTimelineYear model={ym} plotW={timelinePlotW} />
              </View>
            ))}
            <Text style={{ fontSize: 6.5, color: "#94a3b8", marginTop: 4 }}>
              One page per year, one plot per actor — each parent, third
              parties, and communication gaps. The line above each strip is
              that actor&rsquo;s month-by-month trend; the numbers beneath are
              the instance count per month (the year&rsquo;s peak is bold),
              with the year&rsquo;s summary under its plots. Squares mark
              missed or cancelled visits; amber bars are communication gaps. A
              shared entry appears on both strips; unattributed entries on
              neither.
            </Text>
          </View>
        ) : (
          <Text style={styles.empty}>
            Not enough dated events to build a timeline.
          </Text>
        )}

        {/* Missed & Cancelled — summarized across the timespan rather than
            listed row by row; every row is in the evidence workbook. */}
        <View>
          <Text style={styles.h2} break>Missed &amp; Cancelled Visits</Text>
          {report.missed_or_cancelled.length === 0 ? (
            <Text style={styles.empty}>
              No missed or cancelled visits were identified.
            </Text>
          ) : (
            <View>
              <Text style={styles.caption}>
                Missed / cancelled visits per month, by type
              </Text>
              <PdfBarChart
                data={missedMonthly}
                labelKey="month"
                series={missedSeries}
              />
              <View style={styles.statRow} wrap={false}>
                {missedStats.map((s, i) => (
                  <View
                    key={i}
                    style={[
                      styles.stat,
                      i === missedStats.length - 1 ? { marginRight: 0 } : null,
                    ]}
                  >
                    <Text
                      style={[styles.statValue, s.color ? { color: s.color } : null]}
                    >
                      {s.value}
                    </Text>
                    <Text style={styles.statLabel}>{s.label}</Text>
                  </View>
                ))}
              </View>
              {!missed.hasParty && (
                <Text style={[styles.caption, { color: "#94a3b8" }]}>
                  Per-parent attribution is available on reports generated after
                  this feature was added — re-run the analysis to split these by
                  parent.
                </Text>
              )}

              <Text style={styles.caption}>By type — whole period</Text>
              {missed.byType.map((t) => (
                <View key={t.kind} style={styles.bullet} wrap={false}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Helvetica-Bold" }}>{t.label}</Text>
                    {" — "}
                    {t.count} occurrence{t.count === 1 ? "" : "s"}
                  </Text>
                </View>
              ))}

              <Text style={[styles.caption, { marginTop: 4 }]}>
                By year{missed.hasParty ? " and parent" : ""}
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  borderBottomWidth: 0.5,
                  borderBottomColor: "#cbd5e1",
                  paddingBottom: 2,
                  marginBottom: 2,
                }}
              >
                <Text style={{ width: 60, fontFamily: "Helvetica-Bold" }}>Year</Text>
                <Text style={{ width: 70, fontFamily: "Helvetica-Bold" }}>Total</Text>
                {missed.hasParty && (
                  <Text
                    style={{
                      width: 90,
                      fontFamily: "Helvetica-Bold",
                      color: PDF_COLORS.mother,
                    }}
                  >
                    {meta.user_role}
                  </Text>
                )}
                {missed.hasParty && (
                  <Text
                    style={{
                      flex: 1,
                      fontFamily: "Helvetica-Bold",
                      color: PDF_COLORS.father,
                    }}
                  >
                    Father
                  </Text>
                )}
              </View>
              {missed.byYear.map((y) => (
                <View key={y.year} style={{ flexDirection: "row", marginBottom: 1 }}>
                  <Text style={{ width: 60 }}>{y.year}</Text>
                  <Text style={{ width: 70 }}>{y.total}</Text>
                  {missed.hasParty && (
                    <Text style={{ width: 90, color: PDF_COLORS.mother }}>
                      {y.mother}
                    </Text>
                  )}
                  {missed.hasParty && (
                    <Text style={{ flex: 1, color: PDF_COLORS.father }}>
                      {y.father}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        {report.responsibility_events.length > 0 ? (
          <View wrap={false} break>
            <Text style={styles.h2}>Responsibility Coverage</Text>
            <Text style={styles.caption}>
              {meta.user_role} vs. father —{" "}
              <Text style={{ color: PDF_COLORS.mother }}>mother %</Text>
              <Text> · </Text>
              <Text style={{ color: PDF_COLORS.father }}>father %</Text> is each
              parent&rsquo;s share of that category&rsquo;s instances
            </Text>
            <PdfRadar data={radarData} series={RADAR_SERIES} />
          </View>
        ) : null}

        {/* Who handled each category — chart only; the individual
            responsibility rows are in the evidence workbook. */}
        {report.responsibility_events.length > 0 ? (
          <View>
            <Text style={styles.caption}>
              Who handled each court-recognized category —{" "}
              <Text style={{ color: PDF_COLORS.mother }}>mother %</Text>
              <Text> · </Text>
              <Text style={{ color: PDF_COLORS.father }}>father %</Text> is each
              parent&rsquo;s share of that category&rsquo;s instances
            </Text>
            <PdfHBar
              data={responsibilities}
              labelKey="full"
              series={RESP_SERIES}
            />
          </View>
        ) : null}

        {/* The qualitative picture. The court categories miss most of it —
            it lives in the free-text "Other" entries — so themes are pulled
            back out and attributed per parent, each backed by a quote. */}
        {respThemes.length > 0 ? (
          <View>
            <Text style={styles.h2} break>Co-Parenting Themes — Per-Parent Picture</Text>
            <Text style={styles.caption}>
              Cross-cutting themes drawn from every responsibility entry
              (including the free-text &ldquo;Other&rdquo; items) — who handled
              discipline, communication, scheduling, safety, follow-through and
              the rest. Counts are instances mentioning that theme;{" "}
              <Text style={{ color: PDF_COLORS.mother }}>{meta.user_role}</Text>
              <Text> · </Text>
              <Text style={{ color: PDF_COLORS.father }}>father</Text>.
            </Text>
            <PdfHBar data={respThemes} labelKey="label" series={RESP_SERIES} />
            {respThemes.map((t) => (
              <View key={t.key} style={{ marginTop: 5 }} wrap={false}>
                <Text style={{ fontFamily: "Helvetica-Bold" }}>
                  {t.label}
                  {` — ${t.total} total · `}
                  <Text style={{ color: PDF_COLORS.mother }}>
                    {meta.user_role} {t.mother}
                    {t.mother + t.father > 0
                      ? ` (${Math.round((t.mother / (t.mother + t.father)) * 100)}%)`
                      : ""}
                  </Text>
                  {" · "}
                  <Text style={{ color: PDF_COLORS.father }}>
                    father {t.father}
                    {t.mother + t.father > 0
                      ? ` (${100 - Math.round((t.mother / (t.mother + t.father)) * 100)}%)`
                      : ""}
                  </Text>
                  {t.shared ? ` · shared ${t.shared}` : ""}
                  {t.unclear ? ` · unclear ${t.unclear}` : ""}
                </Text>
                {["mother", "father"].map((p) =>
                  t.exemplars[p] ? (
                    <Text key={p} style={styles.quote}>
                      {p === "father" ? "Father" : meta.user_role}:{" "}
                      &ldquo;{t.exemplars[p].text}&rdquo;
                      {t.exemplars[p].date ? ` (${t.exemplars[p].date})` : ""}
                    </Text>
                  ) : null,
                )}
              </View>
            ))}
          </View>
        ) : null}

        {/* Medical appointment register — each caregiving role attributed
            separately when the analysis captured them. */}
        {medical.rows.length > 0 ? (
          <View>
            <Text style={styles.h2} break>Medical Appointments</Text>
            <Text style={styles.caption}>
              {medical.rows.length} appointment
              {medical.rows.length === 1 ? "" : "s"} on record
              {medical.derived
                ? " · this report predates per-role capture, so it shows the one party each entry names as handling it — re-run the analysis to split planned / scheduled / took"
                : " · who planned it, who booked it, who took the child, and who paid"}
            </Text>
            <View style={styles.statRow} wrap={false}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{medSummary.total}</Text>
                <Text style={styles.statLabel}>Appointments</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: PDF_COLORS.mother }]}>
                  {medical.derived
                    ? medSummary.roleTally.handled?.mother ?? 0
                    : medSummary.roleTally.took?.mother ?? 0}
                </Text>
                <Text style={styles.statLabel}>
                  {medical.derived ? "Handled by" : "Taken by"} {meta.user_role}
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: PDF_COLORS.father }]}>
                  {medical.derived
                    ? medSummary.roleTally.handled?.father ?? 0
                    : medSummary.roleTally.took?.father ?? 0}
                </Text>
                <Text style={styles.statLabel}>
                  {medical.derived ? "Handled by" : "Taken by"} father
                </Text>
              </View>
              <View style={[styles.stat, { marginRight: 0 }]}>
                <Text style={styles.statValue}>
                  {medSummary.spend > 0 ? usd(medSummary.spend) : "—"}
                </Text>
                <Text style={styles.statLabel}>Documented spend</Text>
              </View>
            </View>
            <Text style={[styles.caption, { marginTop: 4 }]}>
              By type — split by the acting parent
              {medSummary.byChild.some((c) => c.child !== "Unspecified")
                ? " · children: " +
                  medSummary.byChild.map((c) => `${c.child} (${c.count})`).join(", ")
                : ""}
            </Text>
            <PdfHBar
              data={medSummary.byType.map((t) => ({
                type: t.type,
                mother: t.mother,
                father: t.father,
                shared: t.shared,
                unclear: t.unclear,
              }))}
              labelKey="type"
              series={RESP_SERIES}
              maxRows={20}
            />
            <Text style={[styles.caption, { color: "#94a3b8" }]}>
              The full register — date, child, provider, and who planned,
              scheduled, took and paid per appointment — is the &ldquo;Medical
              Appointments&rdquo; tab of the evidence workbook.
            </Text>
          </View>
        ) : null}

        {fin.hasExpenses && (
          <View>
            <Text style={styles.h2} break>
              Financial Contribution
              {finSolePayer ? ` — ${finPayerLabel}` : ""}
            </Text>
            <Text style={styles.caption}>
              {usd(finTotalShown)} in child-related expenses
              {fin.period ? ` · ${fin.period.start} to ${fin.period.end}` : ""}
              {" · "}{expenses.length} document{expenses.length === 1 ? "" : "s"}
              {finSolePayer
                ? ` · every document on file is ${finPayerLabel}’s payment`
                : ""}
            </Text>
            <View style={styles.statRow} wrap={false}>
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: finPayerColor }]}>
                  {usd(finTotalShown)}
                </Text>
                <Text style={styles.statLabel}>
                  {finSolePayer ? `Paid by ${finPayerLabel}` : "Total tracked"}
                </Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{fin.by_category_sub.length}</Text>
                <Text style={styles.statLabel}>Categories</Text>
              </View>
              <View style={[styles.stat, { marginRight: 0 }]}>
                <Text style={styles.statValue}>{expenses.length}</Text>
                <Text style={styles.statLabel}>Receipts / payments</Text>
              </View>
            </View>

            {/* Overall shape first, then one chart per category so each
                spending area can be read on its own. */}
            {finCategoryRows.length > 0 && (
              <View>
                <Text style={styles.caption}>
                  Dollars spent per court-recognized category
                </Text>
                <PdfHBar
                  data={
                    finSolePayer
                      ? fin.by_category_sub.map((c) => ({
                          full: c.label,
                          amount: c.totals[finSolePayer] || 0,
                        }))
                      : finCategoryRows
                  }
                  labelKey="full"
                  series={finSolePayer ? SUB_SERIES : RESP_SERIES}
                  money
                />
              </View>
            )}

            {/* Sub-category breakdown — a separate chart per category. */}
            {fin.by_category_sub.map((c) => (
              <View key={c.key} style={{ marginTop: 6 }} wrap={false}>
                <Text style={styles.caption}>
                  {c.label} —{" "}
                  {usd(finSolePayer ? c.totals[finSolePayer] || 0 : c.grand_total)}
                  {" across "}
                  {c.expense_count} payment{c.expense_count === 1 ? "" : "s"} · by
                  sub-category
                </Text>
                <PdfHBar
                  data={c.subs.map((s) => ({
                    sub: s.subcategory,
                    amount: finSolePayer ? s[finSolePayer] || 0 : s.grand_total,
                  }))}
                  labelKey="sub"
                  series={SUB_SERIES}
                  money
                  maxRows={12}
                />
              </View>
            ))}
            {fin.by_year.length > 1 && (
              <View wrap={false} style={{ marginTop: 6 }}>
                <Text style={styles.caption}>Year-over-year totals</Text>
                <View
                  style={{
                    flexDirection: "row",
                    borderBottomWidth: 0.5,
                    borderBottomColor: "#cbd5e1",
                    paddingBottom: 2,
                    marginBottom: 2,
                  }}
                >
                  <Text style={{ width: 60, fontFamily: "Helvetica-Bold" }}>
                    Year
                  </Text>
                  {finSolePayer ? (
                    <Text
                      style={{
                        flex: 1,
                        fontFamily: "Helvetica-Bold",
                        color: finPayerColor,
                      }}
                    >
                      Paid by {finPayerLabel}
                    </Text>
                  ) : (
                    <Text
                      style={{
                        width: 100,
                        fontFamily: "Helvetica-Bold",
                        color: PDF_COLORS.mother,
                      }}
                    >
                      With {meta.user_role}
                    </Text>
                  )}
                  {!finSolePayer && (
                    <Text
                      style={{
                        width: 100,
                        fontFamily: "Helvetica-Bold",
                        color: PDF_COLORS.father,
                      }}
                    >
                      With father
                    </Text>
                  )}
                  {!finSolePayer && (
                    <Text style={{ flex: 1, fontFamily: "Helvetica-Bold" }}>
                      Total
                    </Text>
                  )}
                </View>
                {fin.by_year.map((y) => (
                  <View
                    key={y.year}
                    style={{ flexDirection: "row", marginBottom: 1 }}
                  >
                    <Text style={{ width: 60 }}>{y.year}</Text>
                    {finSolePayer ? (
                      <Text style={{ flex: 1, color: finPayerColor }}>
                        {usd(y[finSolePayer] || 0)}
                      </Text>
                    ) : (
                      <Text style={{ width: 100, color: PDF_COLORS.mother }}>
                        {usd(y.mother)}
                      </Text>
                    )}
                    {!finSolePayer && (
                      <Text style={{ width: 100, color: PDF_COLORS.father }}>
                        {usd(y.father)}
                      </Text>
                    )}
                    {!finSolePayer && (
                      <Text style={{ flex: 1 }}>{usd(y.grand_total)}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}
            {finFindings.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.caption}>
                  Cross-validation findings — {finFindings.length}
                </Text>
                {finFindings.map((f, i) => (
                  <View key={i} style={styles.bullet} wrap={false}>
                    <Text style={styles.bulletDot}>▲</Text>
                    <Text style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "Helvetica-Bold" }}>
                        {f.kind === "claim_without_receipt"
                          ? "Claim without receipt"
                          : "Receipt without claim"}
                      </Text>
                      {" · "}{f.date}
                      {f.refs.length > 0 ? ` [${f.refs.join(", ")}]` : ""}
                      {" — "}{f.description}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {sca106 && (
          <View wrap={false}>
            <Text style={styles.h2} break>
              WV Financial Statement (SCA-FC-106) — Worksheet
            </Text>
            <Text style={styles.caption}>
              Child-expense lines auto-populated from the receipts and
              payments — averaged across {sca106.period.months} month
              {sca106.period.months === 1 ? "" : "s"}
              {sca106.period.start && sca106.period.end
                ? ` (${sca106.period.start} to ${sca106.period.end})`
                : ""}
              . Personal info, deductions, assets, debts, and general
              monthly expenses stay for you / your attorney to complete on
              the official form.
            </Text>
            {finSolePayer ? (
              <Text style={[styles.caption, { color: "#059669" }]}>
                Every attributed payment on file is {finPayerLabel}&rsquo;s, so
                unattributed payments are credited to {finPayerLabel} as well —
                the share columns are complete and ready to transfer to the
                form.
              </Text>
            ) : null}
            {scaNeedsAttribution ? (
              <Text style={[styles.caption, { color: "#b45309" }]}>
                The parent share columns show $0 because no payment could be
                attributed: add the card-lookup mapping (card last-4 → parent)
                or upload payer-named exports, then re-run. Totals and monthly
                averages are still correct.
              </Text>
            ) : null}
            {/* Column headers */}
            <View
              style={{
                flexDirection: "row",
                borderBottomWidth: 0.5,
                borderBottomColor: "#cbd5e1",
                paddingBottom: 2,
                marginBottom: 2,
              }}
            >
              <Text style={{ flex: 2.4, fontFamily: "Helvetica-Bold" }}>
                SCA-FC-106 line
              </Text>
              <Text
                style={{ width: 70, fontFamily: "Helvetica-Bold", textAlign: "right" }}
              >
                Monthly
              </Text>
              <Text
                style={{
                  width: 65,
                  fontFamily: "Helvetica-Bold",
                  textAlign: "right",
                  color: PDF_COLORS.mother,
                }}
              >
                {meta.user_role}
              </Text>
              <Text
                style={{
                  width: 65,
                  fontFamily: "Helvetica-Bold",
                  textAlign: "right",
                  color: PDF_COLORS.father,
                }}
              >
                father
              </Text>
              <Text
                style={{ width: 60, fontFamily: "Helvetica-Bold", textAlign: "right" }}
              >
                Share
              </Text>
              <Text
                style={{ width: 70, fontFamily: "Helvetica-Bold", textAlign: "right" }}
              >
                Period
              </Text>
            </View>
            {sca106.lines.map((row) => (
              <View
                key={row.key}
                style={{ flexDirection: "row", marginBottom: 1.5 }}
              >
                <View style={{ flex: 2.4, paddingRight: 4 }}>
                  <Text>{row.line}</Text>
                  <Text style={{ fontSize: 6.5, color: "#94a3b8" }}>
                    {row.categories.join(" · ")} · {row.count} expense
                    {row.count === 1 ? "" : "s"}
                  </Text>
                </View>
                <Text style={{ width: 70, textAlign: "right" }}>
                  {usd(row.monthly_total)}
                </Text>
                <Text
                  style={{ width: 65, textAlign: "right", color: PDF_COLORS.mother }}
                >
                  {usd(row.monthly_mother)}
                </Text>
                <Text
                  style={{ width: 65, textAlign: "right", color: PDF_COLORS.father }}
                >
                  {usd(row.monthly_father)}
                </Text>
                <Text
                  style={{ width: 60, textAlign: "right", fontSize: 7.5 }}
                >
                  <Text style={{ color: PDF_COLORS.mother }}>
                    {row.mother_share_pct}%
                  </Text>
                  <Text style={{ color: "#cbd5e1" }}> / </Text>
                  <Text style={{ color: PDF_COLORS.father }}>
                    {row.father_share_pct}%
                  </Text>
                </Text>
                <Text style={{ width: 70, textAlign: "right", color: "#475569" }}>
                  {usd(row.total)}
                </Text>
              </View>
            ))}
            {/* Total row */}
            <View
              style={{
                flexDirection: "row",
                borderTopWidth: 1,
                borderTopColor: "#475569",
                paddingTop: 2,
                marginTop: 1,
              }}
            >
              <Text
                style={{ flex: 2.4, fontFamily: "Helvetica-Bold" }}
              >
                Total monthly child expenses
              </Text>
              <Text
                style={{
                  width: 70,
                  fontFamily: "Helvetica-Bold",
                  textAlign: "right",
                }}
              >
                {usd(sca106.totals.monthly_child_expenses)}
              </Text>
              <Text
                style={{
                  width: 65,
                  fontFamily: "Helvetica-Bold",
                  textAlign: "right",
                  color: PDF_COLORS.mother,
                }}
              >
                {usd(sca106.totals.mother_monthly)}
              </Text>
              <Text
                style={{
                  width: 65,
                  fontFamily: "Helvetica-Bold",
                  textAlign: "right",
                  color: PDF_COLORS.father,
                }}
              >
                {usd(sca106.totals.father_monthly)}
              </Text>
              <Text
                style={{ width: 60, textAlign: "right", color: "#94a3b8" }}
              >
                —
              </Text>
              <Text
                style={{
                  width: 70,
                  fontFamily: "Helvetica-Bold",
                  textAlign: "right",
                }}
              >
                {usd(sca106.totals.annual_child_expenses)}
              </Text>
            </View>
            {sca106.income && (
              <View style={{ marginTop: 6 }}>
                <Text style={styles.caption}>Income context</Text>
                <PdfKV
                  label="Monthly gross income (entered)"
                  value={usd(sca106.income.monthly_gross)}
                />
                <PdfKV
                  label="Child expenses as % of monthly gross"
                  value={`${sca106.child_expenses_as_pct_of_income}%`}
                />
                <PdfKV
                  label={`Paid by ${meta.user_role} as % of monthly gross`}
                  value={`${
                    Math.round(
                      (sca106.totals.mother_monthly /
                        sca106.income.monthly_gross) *
                        1000,
                    ) / 10
                  }%`}
                />
              </View>
            )}
          </View>
        )}

        <View>
          <Text style={styles.h2} break>Third-Party Statements</Text>
          {thirdParty.total === 0 ? (
            <Text style={styles.empty}>
              No third-party statements were identified.
            </Text>
          ) : (
            <View>
              <Text style={styles.caption}>
                {thirdParty.total} statement{thirdParty.total === 1 ? "" : "s"}
                {" from "}
                {thirdParty.sources} source{thirdParty.sources === 1 ? "" : "s"}
                {thirdParty.byYear.length > 1
                  ? " · by year: " +
                    thirdParty.byYear.map((y) => `${y.year} (${y.count})`).join(", ")
                  : ""}
                {" · every statement is in the workbook's Third-Party tab"}
              </Text>
              <PdfHBar
                data={thirdParty.bySource.slice(0, 8).map((r) => ({
                  source: r.source,
                  count: r.count,
                }))}
                labelKey="source"
                series={[{ key: "count", color: "#64748b", label: "Statements" }]}
              />
              {thirdParty.highlights.map((t, i) => (
                <Text key={i} style={styles.quote}>
                  {t.source}
                  {t.date ? ` (${t.date})` : ""}: &ldquo;{t.quote}&rdquo;
                </Text>
              ))}
            </View>
          )}
        </View>

        {/* "Suggestions for Building the Case" is intentionally omitted — the
            full list is a tab in the evidence workbook. */}

        <ToneSection report={report} meta={meta} />

        <View wrap={false} break>
          <Text style={styles.h2}>Analysis Settings &amp; Provenance</Text>
          <Text style={styles.caption}>
            The inputs and settings used to produce this report — recorded so
            the basis for the analysis is transparent as the case is built.
          </Text>
          <PdfKV label="Report generated" value={generated} />
          <PdfKV label="Analysis model" value={meta.model || "claude-sonnet-5"} />
          <PdfKV
            label="Filing jurisdiction"
            value={jurLabel || "Not specified"}
          />
          <PdfKV label="Period analyzed" value={period} />
          <PdfKV
            label="Messages analyzed"
            value={String(meta.total_messages)}
          />
          <PdfKV
            label="Conversation scope"
            value={meta.contact || "All contacts"}
          />
          <PdfKV label="Date filter applied" value={dateFilterLabel} />
          <PdfKV label="Analysis windows" value={String(meta.windows)} />
          <PdfKV
            label="Message log"
            value={
              meta.transcript_truncated
                ? "In the evidence workbook (capped at the first 2,000 messages)"
                : "Complete — in the evidence workbook's Message Log tab"
            }
          />
        </View>
        {Object.keys(caseProfile).length > 0 ? (
          <View wrap={false}>
            <Text style={styles.caption}>
              WV custody intake answers (case profile)
            </Text>
            {INTAKE_QUESTIONS.map((q) => {
              const opt = q.options.find(
                (o) => o.value === caseProfile[q.id],
              );
              return (
                <View key={q.id} style={{ marginBottom: 2 }}>
                  <Text style={{ color: "#64748b" }}>{q.question}</Text>
                  <Text
                    style={{ fontFamily: "Helvetica-Bold", marginLeft: 8 }}
                  >
                    {opt ? opt.label : "Not answered"}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          Custodia · Confidential — prepared for legal
          counsel
        </Text>
      </Page>

    </Document>
  );
}
