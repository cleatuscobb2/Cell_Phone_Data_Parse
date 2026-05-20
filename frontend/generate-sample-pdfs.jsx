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
import CustodyReportPDFLandscape from "./src/CustodyReportPDFLandscape.jsx";
import { buildCustodyWorkbook } from "./src/custodyWorkbook.js";

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
// Each item is a coherent (court category + subcategory + text) bundle.
const RESP_ITEMS = [
  { category: "education", subcategory: "Teacher/parent conference",
    description: "Mother attended the parent-teacher conference for both children.",
    quote: "I went to the conference for both kids today." },
  { category: "education", subcategory: "Tuition",
    description: "Mother paid the children's school tuition.",
    quote: "Paid the tuition invoice this morning." },
  { category: "education", subcategory: "Books & clothes",
    description: "Mother bought the children's school clothes and supplies.",
    quote: "Picked up their school clothes and books." },
  { category: "medical_dental_eye", subcategory: "Scheduling & paperwork",
    description: "Mother scheduled the children's medical checkup.",
    quote: "I've booked Emma's checkup for the 9th." },
  { category: "medical_dental_eye", subcategory: "Who paid",
    description: "Mother paid the children's dental bill.",
    quote: "Covered the dentist bill today." },
  { category: "medical_dental_eye", subcategory: "Identified doctor & initiated contact",
    description: "Mother found a new pediatrician and made first contact.",
    quote: "Found a good pediatrician and called to set things up." },
  { category: "activities", subcategory: "Sports — game",
    description: "Mother took the children to a soccer game.",
    quote: "Took Liam to his soccer game Saturday." },
  { category: "activities", subcategory: "Camp",
    description: "Mother registered and paid for summer camp.",
    quote: "Signed them up for summer camp, paid the deposit." },
  { category: "activities", subcategory: "Competition dance",
    description: "Mother handled the children's dance competition logistics.",
    quote: "Handling the dance competition travel this weekend." },
  { category: "activities", subcategory: "Scouts",
    description: "Mother took the children to their Scouts meeting.",
    quote: "Took them to Scouts and stayed to help out." },
  { category: "religious", subcategory: "Religious instruction",
    description: "Mother took the children to religious services.",
    quote: "Had the kids at services Sunday morning." },
  { category: "child_care", subcategory: "Child care arrangement",
    description: "Mother arranged after-school child care.",
    quote: "Sorted out after-school care for both of them." },
  { category: "motor_vehicle", subcategory: "Driving practice",
    description: "Mother handled the children's driving practice.",
    quote: "Took Emma out for driving practice again." },
  { category: "childrens_employment", subcategory: "Work paperwork",
    description: "Mother helped with the children's work-permit paperwork.",
    quote: "Filled out Liam's work permit forms." },
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

// Synthetic expense templates — vendor, category, subcategory, typical
// amount range. The generator draws from these to build a realistic
// financial ledger across the case period.
const EXPENSE_TEMPLATES = [
  { vendor: "Pediatric Dental of WV", category: "medical_dental_eye",
    subcategory: "Dental cleaning", min: 120, max: 290, source: "receipt" },
  { vendor: "Charleston Family Medicine", category: "medical_dental_eye",
    subcategory: "Office visit copay", min: 25, max: 95, source: "receipt" },
  { vendor: "MountainView Eye Center", category: "medical_dental_eye",
    subcategory: "Eye exam", min: 80, max: 165, source: "receipt" },
  { vendor: "Lincoln Elementary PTA", category: "education",
    subcategory: "School fees", min: 35, max: 90, source: "payment_app" },
  { vendor: "Kanawha County Schools", category: "education",
    subcategory: "Tuition / fees", min: 200, max: 750, source: "receipt" },
  { vendor: "Target — school supplies", category: "education",
    subcategory: "Books & clothes", min: 45, max: 215, source: "receipt" },
  { vendor: "Camp Mountain Pines", category: "activities",
    subcategory: "Summer camp deposit", min: 250, max: 900, source: "receipt" },
  { vendor: "Charleston Soccer Club", category: "activities",
    subcategory: "Sports registration", min: 95, max: 240, source: "payment_app" },
  { vendor: "Step Up Dance Studio", category: "activities",
    subcategory: "Competition dance", min: 110, max: 320, source: "payment_app" },
  { vendor: "Brightside Childcare", category: "child_care",
    subcategory: "After-school care", min: 180, max: 420, source: "receipt" },
  { vendor: "St. Anne's Parish", category: "religious",
    subcategory: "Religious instruction", min: 30, max: 85, source: "payment_app" },
  { vendor: "WV DMV", category: "motor_vehicle",
    subcategory: "Permit / license fees", min: 25, max: 60, source: "receipt" },
  { vendor: "Driving Academy of WV", category: "motor_vehicle",
    subcategory: "Driving lessons", min: 80, max: 240, source: "receipt" },
];

function buildReport(spec) {
  const start = Date.UTC(spec.startYear, 0, 1);
  const end = Date.UTC(spec.endYear, 0, 1);
  const parentOf = (i) =>
    i % 7 === 0 ? "father" : i % 11 === 0 ? "unclear" : "mother";

  const channelOf = (i) => (i % 3 === 0 ? "email" : "text");

  const childcare = Array.from({ length: spec.childcare }, (_, i) => ({
    date: iso(start, end, i / spec.childcare),
    parent: parentOf(i),
    description: pick(CHILDCARE_DESC, i),
    quote: pick(CHILDCARE_QUOTE, i),
    sender: i % 3 === 0 ? "Dave" : "Me",
    channel: channelOf(i),
  }));

  const missed = Array.from({ length: spec.missed }, (_, i) => ({
    date: iso(start, end, i / spec.missed),
    kind: pick(MISSED_KINDS, i),
    description: pick(MISSED_DESC, i),
    quote: pick(MISSED_QUOTE, i),
    sender: i % 2 === 0 ? "Dave" : "Me",
    channel: channelOf(i),
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

  const responsibility = Array.from({ length: spec.resp }, (_, i) => {
    const item = pick(RESP_ITEMS, i);
    return {
      date: iso(start, end, i / spec.resp),
      category: item.category,
      subcategory: item.subcategory,
      responsible_party: i % 9 === 0 ? "father" : i % 13 === 0 ? "shared" : "mother",
      description: item.description,
      quote: item.quote,
      sender: "Me",
      channel: channelOf(i),
    };
  });

  // Synthetic expenses — child-related transactions, mostly mother-paid
  // (~80%), spread over the case period. Source-types rotate between
  // receipts, payment_app rows, and bank entries so R#, V#, and B#
  // refs all appear in the regenerated samples.
  let receiptIdx = 0;
  let venmoIdx = 0;
  let bankIdx = 0;
  const expenses = Array.from({ length: spec.expenses || 0 }, (_, i) => {
    const tpl = pick(EXPENSE_TEMPLATES, i);
    const payer =
      i % 11 === 0 ? "father" : i % 17 === 0 ? "shared" : "mother";
    const amount =
      Math.round((tpl.min + ((i * 37) % 100) / 100 * (tpl.max - tpl.min)) * 100) / 100;
    // Card lookup — mother's card ends in 4521, father's in 8734.
    const card =
      payer === "mother" ? "4521" : payer === "father" ? "8734" : "shared";
    // Override one in four receipts to come from a bank statement, so
    // the sample shows real B# refs alongside R# and V#.
    const source_type =
      tpl.source === "receipt" && i % 4 === 3 ? "bank" : tpl.source;
    const source_index =
      source_type === "receipt" ? receiptIdx++
      : source_type === "payment_app" ? venmoIdx++
      : bankIdx++;
    return {
      date: iso(start, end, (i + 0.5) / Math.max(1, spec.expenses)),
      amount,
      payer,
      payer_evidence:
        source_type === "payment_app"
          ? payer === "father"
            ? "Venmo from Dave"
            : "Venmo from Me"
          : source_type === "bank"
            ? `bank: card ending ${card}`
            : `card ending ${card}`,
      vendor: tpl.vendor,
      category: tpl.category,
      subcategory: tpl.subcategory,
      description: `${tpl.subcategory} at ${tpl.vendor}`,
      quote:
        source_type === "payment_app"
          ? `${tpl.subcategory} — ${tpl.vendor}`
          : source_type === "bank"
            ? `${tpl.vendor.toUpperCase()} $${amount.toFixed(2)}`
            : `${tpl.vendor}  $${amount.toFixed(2)}`,
      source_type,
      source_index,
    };
  });

  const thirdParty = Array.from({ length: spec.third }, (_, i) => ({
    date: iso(start, end, i / spec.third),
    source: pick(THIRD_SRC, i),
    description:
      "Third party describes the mother as the children's primary caregiver.",
    quote: "You're the one who's always there for Emma and Liam.",
    channel: channelOf(i),
  }));

  // Weave every event's verbatim quote into the transcript as a real, dated
  // message — so the report's source-ref linking (T#/E#) actually resolves.
  const evidenceMsgs = [...childcare, ...missed, ...responsibility, ...thirdParty].map(
    (e) => ({
      timestamp: `${e.date} 12:00`,
      sender: e.sender || "Me",
      body: e.quote,
      conversation: "Dave",
      channel: e.channel || "text",
    }),
  );
  const fillerCount = Math.max(0, spec.transcript - evidenceMsgs.length);
  const fillerMsgs = Array.from({ length: fillerCount }, (_, i) => {
    const ms = start + ((end - start) * i) / Math.max(1, fillerCount);
    const d = new Date(ms);
    return {
      timestamp: `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, "0")}:00`,
      sender: i % 2 === 0 ? "Me" : "Dave",
      body: pick(TX_BODIES, i),
      conversation: "Dave",
      channel: i % 3 === 0 ? "email" : "text",
    };
  });
  const transcript = [...evidenceMsgs, ...fillerMsgs].sort((a, b) =>
    a.timestamp.localeCompare(b.timestamp),
  );

  const suggestions = [
    { category: "attachment", related_date: iso(start, end, 0.18),
      suggestion: "An email references a dental invoice attachment — locate and preserve the PDF to show who paid." },
    { category: "attachment", related_date: iso(start, end, 0.55),
      suggestion: "A message mentions a photo of the children at the school event — save the original image with its metadata." },
    { category: "key_statement", related_date: iso(start, end, 0.3),
      suggestion: "The father's message admitting he 'can't take them this weekend' is a strong, dated statement — flag it for counsel." },
    { category: "key_statement", related_date: iso(start, end, 0.72),
      suggestion: "The maternal grandmother's note that the father 'hasn't visited in weeks' corroborates the pattern of absence." },
    { category: "evidence_to_gather", related_date: "",
      suggestion: "Obtain the children's official school attendance and report-card records — the messages reference them but they are not in this history." },
    { category: "evidence_to_gather", related_date: "",
      suggestion: "Request itemized medical and dental billing statements to independently confirm who paid for care." },
    { category: "follow_up", related_date: "",
      suggestion: "Ask the school to confirm in writing who is listed as the primary emergency contact and who attends conferences." },
    { category: "follow_up", related_date: "",
      suggestion: "Keep a contemporaneous log of pickups, drop-offs, and missed visits going forward to extend this record." },
  ];

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
      case_profile: {
        marital_status: "unmarried",
        case_type: "new",
        temporary_relief: "yes",
        child_support: "yes",
        address_safety: "no",
        other_parent_address: "known",
        military: "no",
      },
      model: "claude-opus-4-7",
      financial_inputs: { monthly_gross_income: 6500 },
      jurisdiction: { state: "West Virginia", county: "Kanawha" },
      contact: null,
      date_filter: { start: "", end: "" },
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
      suggestions,
      expenses,
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
    childcare: 28, missed: 30, resp: 20, gaps: 10, third: 8, expenses: 35,
    transcript: 600, truncated: false,
  },
  {
    file: "custody-report-5yr.pdf",
    startYear: 2019, endYear: 2024, windows: 6, totalMessages: 54800,
    childcare: 55, missed: 62, resp: 40, gaps: 18, third: 14, expenses: 70,
    transcript: 1300, truncated: false,
  },
  {
    file: "custody-report-7yr-max.pdf",
    startYear: 2017, endYear: 2024, windows: 12, totalMessages: 153000,
    childcare: 110, missed: 132, resp: 76, gaps: 32, third: 24, expenses: 140,
    transcript: 2000, truncated: true,
  },
];

for (const spec of SPECS) {
  const data = buildReport(spec);
  const out = path.join(OUT_DIR, spec.file);
  const r = data.report;
  try {
    await renderToFile(<CustodyReportPDF data={data} />, out);
    const kb = (fs.statSync(out).size / 1024).toFixed(0);
    console.log(
      `wrote ${spec.file}  (${kb} KB) — ${spec.windows} windows, ` +
        `${r.childcare_events.length + r.missed_or_cancelled.length + r.responsibility_events.length + r.communication_gaps.length + r.third_party_statements.length} events, ` +
        `${r.suggestions.length} suggestions, ${data.transcript.length} transcript rows`,
    );
  } catch (e) {
    const why = e.code === "EBUSY" ? "file is open — close it and re-run" : e.message;
    console.log(`SKIPPED ${spec.file} — ${why}`);
  }

  // Landscape variant of the same report — for a readability comparison.
  const landscapeFile = spec.file.replace(/\.pdf$/, "-landscape.pdf");
  const landscapeOut = path.join(OUT_DIR, landscapeFile);
  try {
    await renderToFile(<CustodyReportPDFLandscape data={data} />, landscapeOut);
    const kb = (fs.statSync(landscapeOut).size / 1024).toFixed(0);
    console.log(`wrote ${landscapeFile}  (${kb} KB) — landscape layout`);
  } catch (e) {
    const why = e.code === "EBUSY" ? "file is open — close it and re-run" : e.message;
    console.log(`SKIPPED ${landscapeFile} — ${why}`);
  }

  // Accompanying Excel workbook of the same evidence.
  const xlsxFile = spec.file.replace(/\.pdf$/, ".xlsx");
  const xlsxOut = path.join(OUT_DIR, xlsxFile);
  try {
    const wb = buildCustodyWorkbook(data);
    await wb.xlsx.writeFile(xlsxOut);
    const kb = (fs.statSync(xlsxOut).size / 1024).toFixed(0);
    console.log(`wrote ${xlsxFile}  (${kb} KB) — ${wb.worksheets.length} tabs`);
  } catch (e) {
    const why = e.code === "EBUSY" ? "file is open — close it and re-run" : e.message;
    console.log(`SKIPPED ${xlsxFile} — ${why}`);
  }
}
console.log(`\nSample reports written to: ${OUT_DIR}`);
