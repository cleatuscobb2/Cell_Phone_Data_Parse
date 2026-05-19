/**
 * CustodyReportPDF — renders a custody report as a court-ready PDF document
 * using @react-pdf/renderer. Generated entirely in the browser, so the
 * message data never leaves the device.
 *
 * Includes: case context, disclaimer, summary stats, a swim-lane timeline,
 * every extracted event with its verbatim citation, and an appendix with the
 * complete chronological message log.
 */

import {
  Document,
  Line,
  Page,
  Polygon,
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
  responsibilityData,
  responsibilityRadarData,
  RESPONSIBILITY_LABELS,
} from "./chartData.js";
import {
  requiredForms,
  FORM_EVIDENCE,
  EVIDENCE_LABELS,
  INTAKE_QUESTIONS,
} from "./custodyForms.js";

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
  },
  headerMeta: { fontSize: 8.5, color: "#64748b", marginTop: 3, textAlign: "center" },
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
function PdfHBar({ data, labelKey, series, barH = 12 }) {
  if (!data || data.length === 0) {
    return <Text style={styles.empty}>Not enough data to chart.</Text>;
  }
  const max = Math.max(
    1,
    ...data.map((d) => series.reduce((s, sr) => s + (d[sr.key] || 0), 0)),
  );
  return (
    <View wrap={false} style={{ marginTop: 2, marginBottom: 4 }}>
      {data.map((d, i) => {
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
                width: d.motherPct != null ? 66 : 18,
                flexDirection: "row",
                justifyContent: "flex-end",
                alignItems: "baseline",
              }}
            >
              <Text
                style={{ fontSize: 7, color: "#475569", fontFamily: "Helvetica-Bold" }}
              >
                {total}
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

/** One year's swim-lane timeline — a full Jan–Dec span with month gridlines. */
function PdfTimeline({ model }) {
  // Shrink markers when a lane is dense so overlap reads as a pattern.
  const totalPoints = model.lanes.reduce((s, l) => s + l.points.length, 0);
  const mk = totalPoints > 120 ? 4 : totalPoints > 60 ? 5 : 7;
  const yearTotal = model.lanes.reduce((s, l) => s + l.count, 0);

  return (
    <View wrap={false} style={{ marginTop: 8 }}>
      {/* Year heading */}
      <Text style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: "#334155" }}>
        {model.year}{" "}
        <Text style={{ fontSize: 7, fontFamily: "Helvetica", color: "#94a3b8" }}>
          · {yearTotal} {yearTotal === 1 ? "event" : "events"}
        </Text>
      </Text>
      {/* Month axis */}
      <View style={{ flexDirection: "row", marginTop: 2 }}>
        <View style={{ width: LABEL_W }} />
        <View style={{ width: PLOT_W, height: 10 }}>
          {model.ticks.map((t, i) => (
            <Text
              key={i}
              style={{
                position: "absolute",
                left: t.frac * PLOT_W + 1.5,
                width: 28,
                textAlign: "left",
                fontSize: 6,
                color: "#94a3b8",
              }}
            >
              {t.label}
            </Text>
          ))}
        </View>
      </View>

      {/* Lanes */}
      {model.lanes.map((lane, li) => (
        <View key={lane.key} style={{ flexDirection: "row" }}>
          <View
            style={{ width: LABEL_W, height: LANE_H, justifyContent: "center", paddingRight: 4 }}
          >
            <Text style={{ fontSize: 7, fontFamily: "Helvetica-Bold", color: lane.color }}>
              {lane.label}
            </Text>
            <Text style={{ fontSize: 6, color: "#94a3b8" }}>{lane.count} events</Text>
          </View>
          <View
            style={{
              width: PLOT_W,
              height: LANE_H,
              backgroundColor: li % 2 === 0 ? "#f8fafc" : "#ffffff",
              borderLeftWidth: 1,
              borderLeftColor: "#cbd5e1",
            }}
          >
            {model.ticks.map((t, i) => (
              <View
                key={`g${i}`}
                style={{
                  position: "absolute",
                  left: t.frac * PLOT_W,
                  top: 0,
                  width: 0.5,
                  height: LANE_H,
                  backgroundColor: "#e2e8f0",
                }}
              />
            ))}
            {lane.spans.map((s, j) => (
              <View
                key={`s${j}`}
                style={{
                  position: "absolute",
                  left: s.startFrac * PLOT_W,
                  top: LANE_H / 2 - 4,
                  width: Math.max(2, (s.endFrac - s.startFrac) * PLOT_W),
                  height: 8,
                  backgroundColor: lane.color,
                  opacity: 0.5,
                  borderRadius: 2,
                }}
              />
            ))}
            {lane.points.map((p, j) => (
              <View
                key={`p${j}`}
                style={{
                  position: "absolute",
                  left: p.frac * PLOT_W - mk / 2,
                  top: LANE_H / 2 - mk / 2,
                  width: mk,
                  height: mk,
                  backgroundColor: p.color,
                  // Missed/cancelled visits render as squares (milestones).
                  borderRadius: lane.key === "missed" ? 0 : mk / 2,
                  borderWidth: 0.5,
                  borderColor: "#ffffff",
                }}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const CHANNEL_LABEL = { email: "Email", text: "Text", unclear: "Source unclear" };

function EvidenceItem({ date, channel, badge, description, quote, sender }) {
  const src = CHANNEL_LABEL[channel];
  return (
    <View style={styles.evidence} wrap={false}>
      <View style={styles.evidenceHead}>
        <Text style={styles.evidenceDate}>
          {date || "date unclear"}
          {src ? <Text style={styles.source}> · {src}</Text> : null}
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

export default function CustodyReportPDF({ data }) {
  const { meta, custody_breakdown: cb, report, transcript = [] } = data;
  const timeline = buildYearlyTimelineModels(report);
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
  const responsibilities = responsibilityData(report);
  const radarData = responsibilityRadarData(report);
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

  // Manually paginate the transcript appendix into fixed-size pages.
  // Auto-paginating one very long list overflows @react-pdf's layout math.
  const TX_PER_PAGE = 52;
  const txPages = [];
  for (let i = 0; i < transcript.length; i += TX_PER_PAGE) {
    txPages.push(transcript.slice(i, i + TX_PER_PAGE));
  }
  if (txPages.length === 0) txPages.push([]);

  return (
    <Document title="Co-Parenting Communication Report">
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Co-Parenting Communication Report</Text>
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
        <Text style={styles.para}>{report.overview}</Text>

        {requiredFormList.length > 0 ? (
          <View>
            <Text style={styles.h2}>
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

        <Text style={styles.h2}>Custody Breakdown</Text>
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

        <Text style={styles.h2}>Event Timeline</Text>
        {timeline ? (
          <View>
            {timeline.years.map((ym) => (
              <PdfTimeline key={ym.year} model={ym} />
            ))}
            <Text style={{ fontSize: 6.5, color: "#94a3b8", marginTop: 4 }}>
              One chart per year · month gridlines mark seasonal patterns ·
              squares mark missed or cancelled visits · amber bars are
              communication gaps
            </Text>
          </View>
        ) : (
          <Text style={styles.empty}>
            Not enough dated events to build a timeline.
          </Text>
        )}

        <Section
          title="Missed & Cancelled Visits"
          items={report.missed_or_cancelled}
          empty="No missed or cancelled visits were identified."
          chart={
            report.missed_or_cancelled.length > 0 ? (
              <View>
                <Text style={styles.caption}>
                  Missed / cancelled visits per month, by type
                </Text>
                <PdfBarChart
                  data={missedMonthly}
                  labelKey="month"
                  series={missedSeries}
                />
              </View>
            ) : null
          }
          render={(m) => (
            <EvidenceItem
              date={m.date}
              channel={m.channel}
              badge={m.kind.replace(/_/g, " ")}
              description={m.description}
              quote={m.quote}
              sender={m.sender}
            />
          )}
        />

        <Section
          title="Communication Gaps"
          items={report.communication_gaps}
          empty="No notable communication gaps were identified."
          render={(g) => (
            <EvidenceItem
              date={`${g.start_date} to ${g.end_date}`}
              badge={`${g.days} days`}
              description={g.description}
            />
          )}
        />

        <Section
          title="Childcare Instances"
          items={report.childcare_events}
          empty="No childcare instances were identified."
          render={(e) => (
            <EvidenceItem
              date={e.date}
              channel={e.channel}
              badge={`with ${e.parent}`}
              description={e.description}
              quote={e.quote}
              sender={e.sender}
            />
          )}
        />

        {report.responsibility_events.length > 0 ? (
          <View wrap={false}>
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

        <Section
          title="Parenting Responsibilities"
          items={report.responsibility_events}
          empty="No responsibility events were identified."
          chart={
            report.responsibility_events.length > 0 ? (
              <View>
                <Text style={styles.caption}>
                  Who handled each court-recognized category —{" "}
                  <Text style={{ color: PDF_COLORS.mother }}>mother %</Text>
                  <Text> · </Text>
                  <Text style={{ color: PDF_COLORS.father }}>father %</Text> is
                  each parent&rsquo;s share of that category&rsquo;s instances
                </Text>
                <PdfHBar
                  data={responsibilities}
                  labelKey="full"
                  series={RESP_SERIES}
                />
              </View>
            ) : null
          }
          render={(r) => (
            <EvidenceItem
              date={r.date}
              channel={r.channel}
              badge={`${RESPONSIBILITY_LABELS[r.category] || "Other"} — ${r.responsible_party}`}
              description={
                r.subcategory ? `${r.subcategory} — ${r.description}` : r.description
              }
              quote={r.quote}
              sender={r.sender}
            />
          )}
        />

        <Section
          title="Third-Party Statements"
          items={report.third_party_statements}
          empty="No third-party statements were identified."
          render={(t) => (
            <EvidenceItem
              date={t.date}
              channel={t.channel}
              badge={t.source}
              description={t.description}
              quote={t.quote}
              sender={t.source}
            />
          )}
        />

        <Section
          title="Suggestions for Building the Case"
          items={report.suggestions || []}
          empty="No suggestions were generated."
          render={(s) => (
            <EvidenceItem
              date={s.related_date}
              badge={SUGGESTION_LABEL[s.category] || "Suggestion"}
              description={s.suggestion}
            />
          )}
        />

        <Text style={styles.h2}>Tone of Co-Parenting Communications</Text>
        <Text style={styles.para}>{report.sentiment_overview}</Text>

        <View wrap={false}>
          <Text style={styles.h2}>Analysis Settings &amp; Provenance</Text>
          <Text style={styles.caption}>
            The inputs and settings used to produce this report — recorded so
            the basis for the analysis is transparent as the case is built.
          </Text>
          <PdfKV label="Report generated" value={generated} />
          <PdfKV label="Analysis model" value={meta.model || "claude-opus-4-7"} />
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
                ? "Capped at the first 2,000 messages"
                : "Complete"
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

        <Text style={styles.h2}>Limitations & Caveats</Text>
        {report.limitations.map((l, i) => (
          <View key={i} style={styles.bullet}>
            <Text style={styles.bulletDot}>▲</Text>
            <Text style={{ flex: 1 }}>{l}</Text>
          </View>
        ))}

        <Text style={styles.footer} fixed>
          Co-Parenting Communication Report · Confidential — prepared for legal
          counsel
        </Text>
      </Page>

      {/* Appendix — the message log, on explicit fixed-size pages. */}
      {txPages.map((rows, pi) => (
        <Page key={`tx${pi}`} size="LETTER" style={styles.page}>
          {pi === 0 ? (
            <>
              <Text style={styles.title}>Appendix: Message Log</Text>
              <Text style={[styles.subtitle, { marginBottom: 8 }]}>
                {transcript.length} message{transcript.length === 1 ? "" : "s"},
                chronological.
                {meta.transcript_truncated
                  ? " This appendix is capped at the first 2,000 messages — the" +
                    " original export file is the authoritative complete record" +
                    " and should be provided alongside this report."
                  : ""}
              </Text>
            </>
          ) : null}
          {rows.map((m, i) => (
            <View key={i} style={styles.txRow} wrap={false}>
              <Text style={styles.txMeta}>
                {m.timestamp} · {m.channel === "email" ? "(email) " : ""}
                {m.sender}
              </Text>
              <Text style={styles.txBody}>{m.body}</Text>
            </View>
          ))}
          <Text style={styles.footer} fixed>
            Co-Parenting Communication Report · Confidential — prepared for legal
            counsel
          </Text>
        </Page>
      ))}
    </Document>
  );
}
