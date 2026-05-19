/**
 * custodyWorkbook — compiles a custody report into a multi-tab Excel
 * workbook so the parent and their attorney can sort, filter, and
 * cross-reference every piece of evidence. Built entirely in the browser
 * (and in Node for the sample generator); the data never leaves the device.
 *
 * Tabs:
 *   - Summary             — case context, headline counts, narrative
 *   - Childcare           — every childcare instance
 *   - Missed & Cancelled  — missed / cancelled visits
 *   - Communication Gaps  — stretches with no outreach
 *   - Responsibilities    — all parenting-responsibility events
 *   - Resp - <Category>   — one tab per court category that has events
 *   - Third-Party         — corroborating statements from others
 *   - Suggestions         — case-building action items
 *   - Message Log         — the full chronological transcript
 *
 * Every evidence row carries the fields needed to trace and present it:
 * date, source channel (text/email), the tag/category, who is responsible,
 * a description, the verbatim quote, and the message sender.
 */

import ExcelJS from "exceljs";
import { RESPONSIBILITY_CATEGORIES, RESPONSIBILITY_LABELS } from "./chartData.js";

const CHANNEL_LABEL = { email: "Email", text: "Text", unclear: "Unclear" };
const MISSED_KIND_LABEL = {
  cancellation: "Cancellation",
  no_show: "No-show",
  reschedule_request: "Reschedule request",
  late: "Late",
  declined_time: "Declined time",
  other: "Other",
};
const SUGGESTION_LABEL = {
  attachment: "Attachment",
  key_statement: "Key statement",
  evidence_to_gather: "Evidence to gather",
  follow_up: "Follow-up",
  other: "Suggestion",
};
const PARTY_LABEL = {
  mother: "Mother",
  father: "Father",
  shared: "Shared",
  unclear: "Unclear",
};

const HEADER_FILL = "FF334155"; // slate-700

const channelLabel = (c) => CHANNEL_LABEL[c] || "Unclear";
const partyLabel = (p) => PARTY_LABEL[p] || "Unclear";

/** Apply the shared look: bold header, frozen top row, auto-filter, wrap. */
function styleSheet(sheet, colCount) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: HEADER_FILL },
  };
  header.alignment = { vertical: "middle" };
  header.height = 20;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: colCount },
  };
  sheet.eachRow((row, i) => {
    if (i === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
  });
}

/** Add a styled data sheet from column defs + plain-object rows. */
function dataSheet(wb, name, columns, rows) {
  const sheet = wb.addWorksheet(name);
  sheet.columns = columns;
  rows.forEach((r) => sheet.addRow(r));
  styleSheet(sheet, columns.length);
  return sheet;
}

// --- Column definitions -------------------------------------------------------

const CHILDCARE_COLS = [
  { header: "Date", key: "date", width: 13 },
  { header: "Source", key: "channel", width: 9 },
  { header: "In whose care", key: "parent", width: 14 },
  { header: "Description", key: "description", width: 52 },
  { header: "Verbatim quote", key: "quote", width: 62 },
  { header: "Message sender", key: "sender", width: 18 },
];

const MISSED_COLS = [
  { header: "Date", key: "date", width: 13 },
  { header: "Source", key: "channel", width: 9 },
  { header: "Type", key: "kind", width: 19 },
  { header: "Description", key: "description", width: 52 },
  { header: "Verbatim quote", key: "quote", width: 62 },
  { header: "Message sender", key: "sender", width: 18 },
];

const GAP_COLS = [
  { header: "Start date", key: "start", width: 13 },
  { header: "End date", key: "end", width: 13 },
  { header: "Length (days)", key: "days", width: 14 },
  { header: "Description", key: "description", width: 80 },
];

const RESP_COLS = [
  { header: "Date", key: "date", width: 13 },
  { header: "Source", key: "channel", width: 9 },
  { header: "Court category", key: "category", width: 25 },
  { header: "Subcategory", key: "subcategory", width: 24 },
  { header: "Handled by", key: "party", width: 12 },
  { header: "Description", key: "description", width: 46 },
  { header: "Verbatim quote", key: "quote", width: 56 },
  { header: "Message sender", key: "sender", width: 18 },
];

const THIRD_PARTY_COLS = [
  { header: "Date", key: "date", width: 13 },
  { header: "Source", key: "channel", width: 9 },
  { header: "Statement by", key: "source", width: 22 },
  { header: "Description", key: "description", width: 52 },
  { header: "Verbatim quote", key: "quote", width: 62 },
];

const SUGGESTION_COLS = [
  { header: "Type", key: "type", width: 20 },
  { header: "Suggestion", key: "suggestion", width: 86 },
  { header: "Related date", key: "related", width: 15 },
];

const LOG_COLS = [
  { header: "Timestamp", key: "timestamp", width: 18 },
  { header: "Source", key: "channel", width: 9 },
  { header: "Sender", key: "sender", width: 20 },
  { header: "Conversation", key: "conversation", width: 22 },
  { header: "Message", key: "body", width: 92 },
];

// --- Row mappers --------------------------------------------------------------

const respRow = (r) => ({
  date: r.date || "",
  channel: channelLabel(r.channel),
  category: RESPONSIBILITY_LABELS[r.category] || "Other",
  subcategory: r.subcategory || "",
  party: partyLabel(r.responsible_party),
  description: r.description || "",
  quote: r.quote || "",
  sender: r.sender || "",
});

/** Build the Summary tab — case context and headline counts. */
function buildSummarySheet(wb, meta, cb, report) {
  const sheet = wb.addWorksheet("Summary");
  sheet.columns = [
    { header: "Field", key: "field", width: 34 },
    { header: "Value", key: "value", width: 95 },
  ];
  const add = (field, value) =>
    sheet.addRow({ field, value: value == null ? "" : String(value) });
  const blank = () => sheet.addRow({});
  const dr = meta.date_range;

  add("Report compiled", new Date().toISOString().slice(0, 10));
  add("Prepared for", `The children's ${meta.user_role || "parent"}`);
  add("Other parent", meta.other_parent || "—");
  add(
    "Children",
    meta.children && meta.children.length
      ? meta.children.join(", ")
      : "Not specified",
  );
  add(
    "Period analyzed",
    dr && dr.length === 2 ? `${dr[0]} to ${dr[1]}` : "—",
  );
  add("Messages analyzed", meta.total_messages);
  add("Conversations", meta.conversation_count);
  add("Analysis windows", meta.windows);
  if (meta.transcript_truncated) {
    add(
      "Note",
      "The Message Log tab is capped at the first 2,000 messages — the " +
        "original export file is the authoritative complete record.",
    );
  }
  blank();
  add("Estimated % time with mother", `${cb.estimated_pct_mother ?? 0}%`);
  add("Estimated % time with father", `${cb.estimated_pct_father ?? 0}%`);
  add("Childcare instances — with mother", cb.instances_with_mother ?? 0);
  add("Childcare instances — with father", cb.instances_with_father ?? 0);
  add("Childcare instances — shared", cb.instances_shared ?? 0);
  add("Childcare instances — unclear", cb.instances_unclear ?? 0);
  blank();
  add("Childcare events recorded", (report.childcare_events || []).length);
  add(
    "Missed / cancelled visits recorded",
    (report.missed_or_cancelled || []).length,
  );
  add(
    "Communication gaps recorded",
    (report.communication_gaps || []).length,
  );
  add(
    "Responsibility events recorded",
    (report.responsibility_events || []).length,
  );
  add(
    "Third-party statements recorded",
    (report.third_party_statements || []).length,
  );
  add("Suggestions recorded", (report.suggestions || []).length);
  blank();
  add("Overview", report.overview);
  add("Custody breakdown basis", report.breakdown_basis);
  add("Tone of communications", report.sentiment_overview);
  blank();
  (report.limitations || []).forEach((l, i) =>
    add(i === 0 ? "Limitations & caveats" : "", l),
  );

  styleSheet(sheet, 2);
  // Bold the field column, then restore the header styling it overwrote.
  sheet.getColumn("field").font = { bold: true, color: { argb: "FF334155" } };
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
}

/**
 * Build the full custody-evidence workbook. Returns an ExcelJS Workbook;
 * callers turn it into a Blob (browser) or write it to disk (Node).
 */
export function buildCustodyWorkbook(data) {
  const {
    meta = {},
    custody_breakdown: cb = {},
    report = {},
    transcript = [],
  } = data || {};
  const wb = new ExcelJS.Workbook();
  wb.creator = "Co-Parenting Communication Report";
  wb.created = new Date();

  buildSummarySheet(wb, meta, cb, report);

  dataSheet(
    wb,
    "Childcare",
    CHILDCARE_COLS,
    (report.childcare_events || []).map((e) => ({
      date: e.date || "",
      channel: channelLabel(e.channel),
      parent: partyLabel(e.parent),
      description: e.description || "",
      quote: e.quote || "",
      sender: e.sender || "",
    })),
  );

  dataSheet(
    wb,
    "Missed & Cancelled",
    MISSED_COLS,
    (report.missed_or_cancelled || []).map((m) => ({
      date: m.date || "",
      channel: channelLabel(m.channel),
      kind: MISSED_KIND_LABEL[m.kind] || "Other",
      description: m.description || "",
      quote: m.quote || "",
      sender: m.sender || "",
    })),
  );

  dataSheet(
    wb,
    "Communication Gaps",
    GAP_COLS,
    (report.communication_gaps || []).map((g) => ({
      start: g.start_date || "",
      end: g.end_date || "",
      days: g.days ?? "",
      description: g.description || "",
    })),
  );

  const respEvents = report.responsibility_events || [];
  dataSheet(wb, "Responsibilities", RESP_COLS, respEvents.map(respRow));

  // One tab per court category that actually has events.
  for (const cat of RESPONSIBILITY_CATEGORIES) {
    const evts = respEvents.filter((r) => r.category === cat.key);
    if (evts.length === 0) continue;
    dataSheet(wb, `Resp - ${cat.short}`, RESP_COLS, evts.map(respRow));
  }

  dataSheet(
    wb,
    "Third-Party",
    THIRD_PARTY_COLS,
    (report.third_party_statements || []).map((t) => ({
      date: t.date || "",
      channel: channelLabel(t.channel),
      source: t.source || "",
      description: t.description || "",
      quote: t.quote || "",
    })),
  );

  dataSheet(
    wb,
    "Suggestions",
    SUGGESTION_COLS,
    (report.suggestions || []).map((s) => ({
      type: SUGGESTION_LABEL[s.category] || "Suggestion",
      suggestion: s.suggestion || "",
      related: s.related_date || "",
    })),
  );

  dataSheet(
    wb,
    "Message Log",
    LOG_COLS,
    (transcript || []).map((m) => ({
      timestamp: m.timestamp || "",
      channel: channelLabel(m.channel),
      sender: m.sender || "",
      conversation: m.conversation || "",
      body: m.body || "",
    })),
  );

  return wb;
}

/** Build the workbook and return it as a downloadable .xlsx Blob. */
export async function generateCustodyWorkbookBlob(data) {
  const wb = buildCustodyWorkbook(data);
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
