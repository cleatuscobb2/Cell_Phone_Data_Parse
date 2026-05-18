/**
 * generate-sample-pdfs.jsx — renders sample custody-report PDFs at several
 * data volumes so the layout can be checked for readability at scale.
 *
 * The event text is synthetic; only the SHAPE and VOLUME matter for a
 * readability check — a real analysis produces the identical layout.
 *
 * Run from the frontend/ directory:  npx tsx generate-sample-pdfs.jsx
 */

import { renderToFile } from "@react-pdf/renderer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import CustodyReportPDF from "./src/CustodyReportPDF.jsx";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(here, "..", "sample-reports");
fs.mkdirSync(OUT_DIR, { recursive: true });

const pick = (arr, i) => arr[i % arr.length];
const iso = (startMs, endMs, frac) =>
  new Date(startMs + (endMs - startMs) * frac).toISOString().slice(0, 10);

const CHILDCARE_DESC = [
  "Mother confirmed she had Emma and Liam for the weekend.",
  "Mother took the children to a birthday party.",
  "Mother kept the children on the father's scheduled night.",
  "Father picked the children up for an afternoon visit.",
  "Mother had the children overnight midweek.",
  "Mother arranged after-school care and pickup.",
];
const CHILDCARE_QUOTE = [
  "I'll keep Emma and Liam this weekend then.",
  "Picked the kids up from school, they're with me tonight.",
  "Had both kids overnight again, all good.",
  "I've got them for the party Saturday.",
  "They're staying with me through Sunday.",
];
const MISSED_DESC = [
  "Father cancelled the scheduled weekend visit.",
  "Father did not show up for the agreed pickup.",
  "Father asked to reschedule his parenting time.",
  "Father arrived significantly late for pickup.",
  "Father declined his offered weekend with the children.",
];
const MISSED_QUOTE = [
  "Something came up, can't take them this weekend.",
  "Won't make the pickup today, sorry.",
  "Can we move my weekend to later in the month?",
  "Running late, probably an hour behind.",
  "I'll pass on this weekend, you keep them.",
];
const MISSED_KINDS = [
  "cancellation",
  "no_show",
  "reschedule_request",
  "late",
  "declined_time",
];
const RESP_DESC = [
  "Mother scheduled the children's medical checkup.",
  "Mother attended the parent-teacher conference.",
  "Mother handled school drop-off.",
  "Mother arranged and paid for an activity.",
  "Mother is listed as the school emergency contact.",
];
const RESP_QUOTE = [
  "I've booked Emma's checkup for the 9th.",
  "I went to the conference for both kids today.",
  "Dropped them at school this morning.",
  "Signed Liam up for soccer, I'll cover the fee.",
  "School confirmed I'm the primary emergency contact.",
];
const RESP_CATS = [
  "medical",
  "school",
  "drop_off",
  "pick_up",
  "emergency_contact",
  "activity",
];
const THIRD_SRC = [
  "Mom (maternal grandmother)",
  "Lincoln Elementary",
  "Aunt Sarah",
  "Dr. Patel's office",
  "Soccer coach",
];
const TX_BODIES = [
  "Picking up the kids at 5 on Friday.",
  "Can we move the weekend? Something came up.",
  "Took Emma to her checkup, all went well.",
  "Liam has practice at 4 — can you take him?",
  "Running late, will be there by 7.",
  "I had both kids overnight again.",
  "Parent-teacher conference is Thursday.",
  "Sorry, can't make it this weekend.",
  "Thanks for dropping them off.",
  "Did you sign the school form yet?",
];

function buildReport(spec) {
  const start = Date.UTC(spec.startYear, 0, 1);
  const end = Date.UTC(spec.endYear, 0, 1);
  const parentOf = (i) =>
    i % 7 === 0 ? "father" : i % 11 === 0 ? "unclear" : "mother";

  const childcare = Array.from({ length: spec.childcare }, (_, i) => ({
    date: iso(start, end, i / spec.childcare),
    parent: parentOf(i),
    description: pick(CHILDCARE_DESC, i),
    quote: pick(CHILDCARE_QUOTE, i),
    sender: i % 3 === 0 ? "Dave" : "Me",
  }));

  const missed = Array.from({ length: spec.missed }, (_, i) => ({
    date: iso(start, end, i / spec.missed),
    kind: pick(MISSED_KINDS, i),
    description: pick(MISSED_DESC, i),
    quote: pick(MISSED_QUOTE, i),
    sender: i % 2 === 0 ? "Dave" : "Me",
  }));

  const gaps = Array.from({ length: spec.gaps }, (_, i) => {
    const s = iso(start, end, i / spec.gaps);
    const e = iso(start, end, i / spec.gaps + 0.4 / spec.gaps);
    return {
      start_date: s,
      end_date: e,
      days: 14 + ((i * 9) % 40),
      description:
        "No messages from the father about the children during this period.",
    };
  });

  const responsibility = Array.from({ length: spec.resp }, (_, i) => ({
    date: iso(start, end, i / spec.resp),
    category: pick(RESP_CATS, i),
    responsible_party: i % 9 === 0 ? "father" : i % 13 === 0 ? "shared" : "mother",
    description: pick(RESP_DESC, i),
    quote: pick(RESP_QUOTE, i),
    sender: "Me",
  }));

  const thirdParty = Array.from({ length: spec.third }, (_, i) => ({
    date: iso(start, end, i / spec.third),
    source: pick(THIRD_SRC, i),
    description:
      "Third party describes the mother as the children's primary caregiver.",
    quote: "You're the one who's always there for Emma and Liam.",
  }));

  const transcript = Array.from({ length: spec.transcript }, (_, i) => {
    const ms = start + ((end - start) * i) / spec.transcript;
    const d = new Date(ms);
    return {
      timestamp: `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, "0")}:00`,
      sender: i % 2 === 0 ? "Me" : "Dave",
      body: pick(TX_BODIES, i),
      conversation: "Dave",
    };
  });

  const m = childcare.filter((e) => e.parent === "mother").length;
  const f = childcare.filter((e) => e.parent === "father").length;
  const sh = childcare.filter((e) => e.parent === "shared").length;
  const un = childcare.filter((e) => e.parent === "unclear").length;
  const denom = m + f + sh || 1;

  return {
    meta: {
      total_messages: spec.totalMessages,
      conversation_count: 3,
      date_range: [iso(start, end, 0), iso(start, end, 1)],
      windows: spec.windows,
      other_parent: "Dave",
      user_role: "mother",
      children: ["Emma", "Liam"],
      transcript_truncated: spec.truncated,
    },
    custody_breakdown: {
      instances_with_mother: m,
      instances_with_father: f,
      instances_shared: sh,
      instances_unclear: un,
      estimated_pct_mother: Math.round(((m + 0.5 * sh) / denom) * 1000) / 10,
      estimated_pct_father: Math.round(((f + 0.5 * sh) / denom) * 1000) / 10,
    },
    report: {
      overview:
        "Across the full period analyzed, the communications show the mother " +
        "coordinating the large majority of childcare, medical, and school " +
        "logistics for Emma and Liam. The father cancelled, missed, or asked " +
        "to reschedule parenting time on numerous occasions, and several " +
        "stretches show no outreach from him about the children. Multiple " +
        "third parties describe the mother as the primary caregiver.",
      breakdown_basis:
        "Childcare instances were counted from messages that explicitly state " +
        "a parent had, picked up, or was caring for a child. Counts reflect " +
        "what the messages state and do not capture every day of actual care.",
      childcare_events: childcare,
      missed_or_cancelled: missed,
      communication_gaps: gaps,
      responsibility_events: responsibility,
      third_party_statements: thirdParty,
      sentiment_overview:
        "The tone of co-parenting communication is largely logistical and " +
        "frequently strained, with recurring friction around the father's " +
        "missed and rescheduled time.",
      limitations: [
        "This report organizes events extracted from text messages; the " +
          "original messages are the evidence and must be independently verified.",
        "Automated extraction can miss or misclassify messages; counts are estimates.",
        "The analysis covers text messages only — not school, medical, or court records.",
        "This report was assembled from multiple time-windowed analysis passes; a " +
          "communication gap spanning a window boundary may be split or under-counted.",
      ],
    },
    transcript,
  };
}

const SPECS = [
  {
    file: "custody-report-3yr.pdf",
    startYear: 2021, endYear: 2024, windows: 3, totalMessages: 21900,
    childcare: 28, missed: 30, resp: 20, gaps: 10, third: 8,
    transcript: 600, truncated: false,
  },
  {
    file: "custody-report-5yr.pdf",
    startYear: 2019, endYear: 2024, windows: 6, totalMessages: 54800,
    childcare: 55, missed: 62, resp: 40, gaps: 18, third: 14,
    transcript: 1300, truncated: false,
  },
  {
    file: "custody-report-7yr-max.pdf",
    startYear: 2017, endYear: 2024, windows: 12, totalMessages: 153000,
    childcare: 110, missed: 132, resp: 76, gaps: 32, third: 24,
    transcript: 2000, truncated: true,
  },
];

for (const spec of SPECS) {
  const data = buildReport(spec);
  const out = path.join(OUT_DIR, spec.file);
  await renderToFile(<CustodyReportPDF data={data} />, out);
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  const r = data.report;
  console.log(
    `wrote ${spec.file}  (${kb} KB) — ${spec.windows} windows, ` +
      `${r.childcare_events.length + r.missed_or_cancelled.length + r.responsibility_events.length + r.communication_gaps.length + r.third_party_statements.length} events, ` +
      `${data.transcript.length} transcript rows`,
  );
}
console.log(`\nSample PDFs written to: ${OUT_DIR}`);
