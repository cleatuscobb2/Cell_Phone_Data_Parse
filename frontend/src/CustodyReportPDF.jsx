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
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { buildTimelineModel } from "./timeline.js";
import {
  carePatternData,
  custodySplitData,
  missedByTypeData,
  missedOverTimeData,
  responsibilityData,
} from "./chartData.js";

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
  title: { fontSize: 18, fontFamily: "Helvetica-Bold" },
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
const MISSED_SERIES = [
  { key: "count", color: PDF_COLORS.missed, label: "Missed / cancelled" },
];
const RESP_SERIES = [
  { key: "mother", color: PDF_COLORS.mother, label: "With mother" },
  { key: "father", color: PDF_COLORS.father, label: "With father" },
  { key: "shared", color: PDF_COLORS.shared, label: "Shared" },
  { key: "unclear", color: PDF_COLORS.unclear, label: "Unclear" },
];

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

const PLOT_W = 420;
const LABEL_W = 95;
const LANE_H = 34;

function PdfTimeline({ model }) {
  if (!model) {
    return <Text style={styles.empty}>Not enough dated events to build a timeline.</Text>;
  }
  const labelEvery = model.ticks.length > 24 ? 6 : model.ticks.length > 12 ? 3 : 1;
  // Shrink markers when a lane is dense so overlap reads as a pattern.
  const totalPoints = model.lanes.reduce((s, l) => s + l.points.length, 0);
  const mk = totalPoints > 120 ? 4 : totalPoints > 60 ? 5 : 7;

  return (
    <View wrap={false} style={{ marginTop: 4 }}>
      {/* Month axis */}
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: LABEL_W }} />
        <View style={{ width: PLOT_W, height: 12 }}>
          {model.ticks.map((t, i) =>
            i % labelEvery === 0 ? (
              <Text
                key={i}
                style={{
                  position: "absolute",
                  left: t.frac * PLOT_W - 14,
                  width: 28,
                  textAlign: "center",
                  fontSize: 6,
                  color: "#94a3b8",
                }}
              >
                {t.label}
              </Text>
            ) : null,
          )}
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
      <Text style={{ fontSize: 6.5, color: "#94a3b8", marginTop: 3 }}>
        {model.startLabel} to {model.endLabel} · squares mark missed or cancelled
        visits · amber bars are communication gaps
      </Text>
    </View>
  );
}

function EvidenceItem({ date, badge, description, quote, sender }) {
  return (
    <View style={styles.evidence} wrap={false}>
      <View style={styles.evidenceHead}>
        <Text style={styles.evidenceDate}>{date || "date unclear"}</Text>
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
  const model = buildTimelineModel(report, meta);
  const custodySplit = custodySplitData(cb);
  const carePattern = carePatternData(report);
  const missedTime = missedOverTimeData(report);
  const missedTypes = missedByTypeData(report);
  const responsibilities = responsibilityData(report);
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
        <Text style={styles.title}>Co-Parenting Communication Report</Text>
        <Text style={styles.subtitle}>
          Prepared by the children&rsquo;s {meta.user_role} · Other parent: {meta.other_parent}
        </Text>
        <Text style={styles.subtitle}>
          Children: {children} · Period analyzed: {period} · Generated: {generated}
          {meta.windows > 1 ? ` · Analyzed in ${meta.windows} time windows` : ""}
        </Text>

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
        <PdfTimeline model={model} />

        <Section
          title="Missed & Cancelled Visits"
          items={report.missed_or_cancelled}
          empty="No missed or cancelled visits were identified."
          chart={
            report.missed_or_cancelled.length > 0 ? (
              <View>
                <Text style={styles.caption}>Missed / cancelled per month</Text>
                <PdfBarChart data={missedTime} labelKey="month" series={MISSED_SERIES} />
                <Text style={styles.caption}>By type</Text>
                <PdfBarChart data={missedTypes} labelKey="type" series={MISSED_SERIES} />
              </View>
            ) : null
          }
          render={(m) => (
            <EvidenceItem
              date={m.date}
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
              badge={`with ${e.parent}`}
              description={e.description}
              quote={e.quote}
              sender={e.sender}
            />
          )}
        />

        <Section
          title="Parenting Responsibilities"
          items={report.responsibility_events}
          empty="No responsibility events were identified."
          chart={
            report.responsibility_events.length > 0 ? (
              <View>
                <Text style={styles.caption}>Who handled each responsibility</Text>
                <PdfBarChart
                  data={responsibilities}
                  labelKey="category"
                  series={RESP_SERIES}
                />
              </View>
            ) : null
          }
          render={(r) => (
            <EvidenceItem
              date={r.date}
              badge={`${r.category.replace(/_/g, " ")} — ${r.responsible_party}`}
              description={r.description}
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
              badge={t.source}
              description={t.description}
              quote={t.quote}
              sender={t.source}
            />
          )}
        />

        <Text style={styles.h2}>Tone of Co-Parenting Communications</Text>
        <Text style={styles.para}>{report.sentiment_overview}</Text>

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
                {m.timestamp} · {m.sender}
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
