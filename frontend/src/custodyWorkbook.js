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
 *   - Timeline            — every dated event in one chronological list
 *   - Expense Ledger      — every child-related financial transaction (when receipts uploaded)
 *   - Financial Findings  — claim/receipt cross-validation (when applicable)
 *   - SCA-FC-106 Worksheet — WV Financial Statement child-expense lines (WV only)
 *   - Message Log         — the full chronological transcript
 *
 * Every evidence row carries the fields needed to trace and present it:
 * date, source channel (text/email), the tag/category, who is responsible,
 * a description, the verbatim quote, and the message sender. Each message
 * in the log gets a short reference ID (T# for texts, E# for emails); every
 * evidence and timeline row links back to the message it was quoted from
 * via that ID, so a row can be traced to its exact source.
 */

import ExcelJS from "exceljs";
import { RESPONSIBILITY_CATEGORIES, RESPONSIBILITY_LABELS } from "./chartData.js";
import {
  requiredForms,
  FORM_EVIDENCE,
  EVIDENCE_LABELS,
  INTAKE_QUESTIONS,
} from "./custodyForms.js";
import { buildEvidenceRefs } from "./messageRefs.js";
import {
  buildFinancialSummary,
  buildFinancialCrossValidation,
} from "./financial.js";
import { buildSca106Worksheet } from "./scaFc106.js";

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
  { header: "Source ref", key: "ref", width: 11 },
  { header: "Date", key: "date", width: 13 },
  { header: "Source", key: "channel", width: 9 },
  { header: "In whose care", key: "parent", width: 14 },
  { header: "Description", key: "description", width: 52 },
  { header: "Verbatim quote", key: "quote", width: 62 },
  { header: "Message sender", key: "sender", width: 18 },
];

const MISSED_COLS = [
  { header: "Source ref", key: "ref", width: 11 },
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
  { header: "Source ref", key: "ref", width: 11 },
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
  { header: "Source ref", key: "ref", width: 11 },
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

const REQUIRED_FORM_COLS = [
  { header: "Form number", key: "number", width: 14 },
  { header: "Form title", key: "title", width: 50 },
  { header: "Why it is required", key: "reason", width: 42 },
  { header: "Purpose", key: "purpose", width: 46 },
  { header: "Supporting evidence in this report", key: "evidence", width: 40 },
];

const LOG_COLS = [
  { header: "Ref", key: "ref", width: 9 },
  { header: "Timestamp", key: "timestamp", width: 18 },
  { header: "Source", key: "channel", width: 9 },
  { header: "Sender", key: "sender", width: 20 },
  { header: "Conversation", key: "conversation", width: 22 },
  { header: "Message", key: "body", width: 92 },
];

const TIMELINE_COLS = [
  { header: "Date", key: "date", width: 14 },
  { header: "Lane", key: "lane", width: 22 },
  { header: "Detail", key: "detail", width: 30 },
  { header: "Source ref", key: "ref", width: 11 },
  { header: "Description", key: "description", width: 62 },
  { header: "Verbatim quote", key: "quote", width: 62 },
];

const EXPENSE_COLS = [
  { header: "Source ref", key: "ref", width: 11 },
  { header: "Date", key: "date", width: 13 },
  { header: "Amount (USD)", key: "amount", width: 14 },
  { header: "Paid by", key: "payer", width: 11 },
  { header: "How we know", key: "payer_evidence", width: 28 },
  { header: "Vendor", key: "vendor", width: 28 },
  { header: "Court category", key: "category", width: 25 },
  { header: "Subcategory", key: "subcategory", width: 22 },
  { header: "Description", key: "description", width: 48 },
  { header: "Verbatim quote", key: "quote", width: 56 },
];

const FIN_FINDING_COLS = [
  { header: "Finding", key: "kind", width: 26 },
  { header: "Date", key: "date", width: 13 },
  { header: "Refs", key: "refs", width: 12 },
  { header: "Description", key: "description", width: 84 },
];

const SCA106_COLS = [
  { header: "SCA-FC-106 line", key: "line", width: 50 },
  { header: "Categories", key: "categories", width: 38 },
  { header: "Period total", key: "total", width: 14 },
  { header: "Monthly total", key: "monthly_total", width: 14 },
  { header: "Monthly — mother", key: "monthly_mother", width: 16 },
  { header: "Monthly — father", key: "monthly_father", width: 16 },
  { header: "Mother share %", key: "mother_share_pct", width: 14 },
  { header: "Father share %", key: "father_share_pct", width: 14 },
  { header: "Expenses", key: "count", width: 11 },
];

// --- Row mappers --------------------------------------------------------------

const respRow = (r, link) => ({
  ref: link(r) || "",
  date: r.date || "",
  channel: channelLabel(r.channel),
  category: RESPONSIBILITY_LABELS[r.category] || "Other",
  subcategory: r.subcategory || "",
  party: partyLabel(r.responsible_party),
  description: r.description || "",
  quote: r.quote || "",
  sender: r.sender || "",
});

const FIN_FINDING_LABEL = {
  claim_without_receipt: "Claim without receipt",
  receipt_without_claim: "Receipt without claim",
  amount_mismatch: "Amount mismatch",
};

/** Build the Summary tab — case context and headline counts. */
function buildSummarySheet(wb, meta, cb, report, fin) {
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
  const jur = meta.jurisdiction || {};
  add(
    "Filing jurisdiction",
    jur.county
      ? `${jur.county} County, ${jur.state || "West Virginia"}`
      : "Not specified",
  );
  add("Conversation scope", meta.contact || "All contacts");
  add("Analysis model", meta.model || "claude-opus-4-7");
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
  if (fin && fin.hasExpenses) {
    add("Expenses tracked", (report.expenses || []).length);
    blank();
    add("Financial total tracked", `$${fin.total.toFixed(2)}`);
    add("Financial total — mother", `$${fin.grand_total.mother.toFixed(2)}`);
    add("Financial total — father", `$${fin.grand_total.father.toFixed(2)}`);
    add("Financial total — shared", `$${fin.grand_total.shared.toFixed(2)}`);
    add("Financial total — unclear", `$${fin.grand_total.unclear.toFixed(2)}`);
    if (fin.period) {
      add(
        "Financial period covered",
        `${fin.period.start} to ${fin.period.end}`,
      );
    }
  }
  blank();
  add("Overview", report.overview);
  add("Custody breakdown basis", report.breakdown_basis);
  add("Tone of communications", report.sentiment_overview);
  blank();
  (report.limitations || []).forEach((l, i) =>
    add(i === 0 ? "Limitations & caveats" : "", l),
  );

  const profile = meta.case_profile || {};
  if (Object.keys(profile).length > 0) {
    blank();
    INTAKE_QUESTIONS.forEach((q, i) => {
      const opt = q.options.find((o) => o.value === profile[q.id]);
      add(
        i === 0 ? "WV custody intake answers" : "",
        `${q.question}  —  ${opt ? opt.label : "Not answered"}`,
      );
    });
  }

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
  const { meta = {}, custody_breakdown: cb = {}, report = {} } = data || {};
  const wb = new ExcelJS.Workbook();
  wb.creator = "Co-Parenting Communication Report";
  wb.created = new Date();

  // Ref-annotated transcript + a linker from each event to its source message.
  // `expenses` carries R#/V# refs assigned from source_type + source_index.
  const { refed, expenses, link } = buildEvidenceRefs(data);

  // Financial summary + cross-validation against responsibility events.
  const fin = buildFinancialSummary(expenses);
  const finFindings = fin.hasExpenses
    ? buildFinancialCrossValidation(expenses, report.responsibility_events || [])
    : [];

  // SCA-FC-106 worksheet — only when WV is the filing state.
  const isWV = (meta.jurisdiction?.state || "") === "West Virginia";
  const sca106 = isWV
    ? buildSca106Worksheet(expenses, cb, meta.financial_inputs || {})
    : null;

  buildSummarySheet(wb, meta, cb, report, fin);

  // Required WV filing forms — only when the case-profile intake was answered.
  const caseProfile = meta.case_profile || {};
  if (Object.keys(caseProfile).length > 0) {
    const evidenceCount = {
      childcare: (report.childcare_events || []).length,
      missed: (report.missed_or_cancelled || []).length,
      gaps: (report.communication_gaps || []).length,
      responsibilities: (report.responsibility_events || []).length,
      thirdparty: (report.third_party_statements || []).length,
    };
    dataSheet(
      wb,
      "Required Forms",
      REQUIRED_FORM_COLS,
      requiredForms(caseProfile).map((f) => ({
        number: f.number,
        title: f.title,
        reason: f.reason,
        purpose: f.purpose,
        evidence: (FORM_EVIDENCE[f.id] || [])
          .map((k) =>
            evidenceCount[k] != null
              ? `${EVIDENCE_LABELS[k]} (${evidenceCount[k]})`
              : EVIDENCE_LABELS[k],
          )
          .join("; "),
      })),
    );
  }

  dataSheet(
    wb,
    "Childcare",
    CHILDCARE_COLS,
    (report.childcare_events || []).map((e) => ({
      ref: link(e) || "",
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
      ref: link(m) || "",
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
  dataSheet(
    wb,
    "Responsibilities",
    RESP_COLS,
    respEvents.map((r) => respRow(r, link)),
  );

  // One tab per court category that actually has events.
  for (const cat of RESPONSIBILITY_CATEGORIES) {
    const evts = respEvents.filter((r) => r.category === cat.key);
    if (evts.length === 0) continue;
    dataSheet(
      wb,
      `Resp - ${cat.short}`,
      RESP_COLS,
      evts.map((r) => respRow(r, link)),
    );
  }

  dataSheet(
    wb,
    "Third-Party",
    THIRD_PARTY_COLS,
    (report.third_party_statements || []).map((t) => ({
      ref: link(t) || "",
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

  // Timeline — every dated event in one chronological list, each carrying
  // the source-message ref so a marker can be traced back to its text/email.
  const timelineRows = [
    ...(report.childcare_events || []).map((e) => ({
      date: e.date || "",
      lane: "Childcare",
      detail: `In ${partyLabel(e.parent).toLowerCase()}'s care`,
      ref: link(e) || "",
      description: e.description || "",
      quote: e.quote || "",
    })),
    ...(report.missed_or_cancelled || []).map((m) => ({
      date: m.date || "",
      lane: "Missed / Cancelled",
      detail: MISSED_KIND_LABEL[m.kind] || "Other",
      ref: link(m) || "",
      description: m.description || "",
      quote: m.quote || "",
    })),
    ...(report.responsibility_events || []).map((r) => ({
      date: r.date || "",
      lane: "Responsibilities",
      detail: `${RESPONSIBILITY_LABELS[r.category] || "Other"} — ${partyLabel(
        r.responsible_party,
      )}`,
      ref: link(r) || "",
      description: r.description || "",
      quote: r.quote || "",
    })),
    ...(report.third_party_statements || []).map((t) => ({
      date: t.date || "",
      lane: "Third-Party",
      detail: t.source || "",
      ref: link(t) || "",
      description: t.description || "",
      quote: t.quote || "",
    })),
    ...(report.communication_gaps || []).map((g) => ({
      date: g.start_date || "",
      lane: "Communication Gap",
      detail: `${g.start_date || "?"} to ${g.end_date || "?"} (${
        g.days ?? "?"
      } days)`,
      ref: "",
      description: g.description || "",
      quote: "",
    })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  dataSheet(wb, "Timeline", TIMELINE_COLS, timelineRows);

  // Expense Ledger — every dollar transaction tied to a child, with its
  // source ref so each row can be traced to the underlying document.
  if (fin.hasExpenses) {
    dataSheet(
      wb,
      "Expense Ledger",
      EXPENSE_COLS,
      expenses.map((e) => ({
        ref: e.ref || "",
        date: e.date || "",
        amount: Number(e.amount || 0),
        payer: partyLabel(e.payer),
        payer_evidence: e.payer_evidence || "",
        vendor: e.vendor || "",
        category: RESPONSIBILITY_LABELS[e.category] || "Other",
        subcategory: e.subcategory || "",
        description: e.description || "",
        quote: e.quote || "",
      })),
    );
    if (finFindings.length > 0) {
      dataSheet(
        wb,
        "Financial Findings",
        FIN_FINDING_COLS,
        finFindings.map((f) => ({
          kind: FIN_FINDING_LABEL[f.kind] || f.kind,
          date: f.date || "",
          refs: (f.refs || []).join(", "),
          description: f.description || "",
        })),
      );
    }
  }

  // WV SCA-FC-106 Financial Statement worksheet — child-expense lines
  // averaged across the case period, per-parent split.
  if (sca106) {
    const rows = sca106.lines.map((r) => ({
      line: r.line,
      categories: r.categories.join("; "),
      total: r.total,
      monthly_total: r.monthly_total,
      monthly_mother: r.monthly_mother,
      monthly_father: r.monthly_father,
      mother_share_pct: r.mother_share_pct,
      father_share_pct: r.father_share_pct,
      count: r.count,
    }));
    rows.push({
      line: "Total monthly child expenses",
      categories: "",
      total: sca106.totals.annual_child_expenses,
      monthly_total: sca106.totals.monthly_child_expenses,
      monthly_mother: sca106.totals.mother_monthly,
      monthly_father: sca106.totals.father_monthly,
      mother_share_pct: "",
      father_share_pct: "",
      count: "",
    });
    if (sca106.income) {
      rows.push({
        line: "Monthly gross income (entered)",
        categories: "",
        total: "",
        monthly_total: sca106.income.monthly_gross,
        monthly_mother: "",
        monthly_father: "",
        mother_share_pct: "",
        father_share_pct: "",
        count: "",
      });
      rows.push({
        line: "Child expenses as % of monthly gross income",
        categories: "",
        total: "",
        monthly_total: sca106.child_expenses_as_pct_of_income,
        monthly_mother: "",
        monthly_father: "",
        mother_share_pct: "",
        father_share_pct: "",
        count: "",
      });
    }
    dataSheet(wb, "SCA-FC-106 Worksheet", SCA106_COLS, rows);
  }

  dataSheet(
    wb,
    "Message Log",
    LOG_COLS,
    (refed || []).map((m) => ({
      ref: m.ref || "",
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
