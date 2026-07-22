/**
 * custodyWorkbookImport — the inverse of custodyWorkbook.js. Parses an edited
 * custody-evidence .xlsx back into the { meta, custody_breakdown, report,
 * transcript } shape the report/PDF renderers consume, so a parent can fill in
 * the fields the analysis left "Unclear" (and correct anything else) and
 * regenerate the report without re-running the AI analysis.
 *
 * Case metadata + narrative come from the hidden "_source" sheet the export
 * embeds; the evidence itself is read from the visible sheets, so the user's
 * edits win. The custody split is recomputed from the edited childcare rows.
 * Runs entirely in the browser — nothing leaves the device.
 */

import ExcelJS from "exceljs";
import { RESPONSIBILITY_CATEGORIES } from "./chartData.js";

// Inverse of the forward label maps in custodyWorkbook.js. Keyed on the
// lower-cased visible label so a user typing "mother"/"Mother" both resolve.
const PARTY_MAP = {
  mother: "mother", father: "father", shared: "shared", unclear: "unclear",
};
const CHANNEL_MAP = {
  email: "email",
  text: "text",
  document: "document",
  unclear: "unclear",
};
const MISSED_MAP = {
  cancellation: "cancellation", "no-show": "no_show", "no show": "no_show",
  "reschedule request": "reschedule_request", late: "late",
  "declined time": "declined_time", other: "other",
};
const SUGGESTION_MAP = {
  attachment: "attachment", "key statement": "key_statement",
  "evidence to gather": "evidence_to_gather", "follow-up": "follow_up",
  "follow up": "follow_up", suggestion: "other", other: "other",
};
// Court category: full display name (lower-cased) → enum key.
const RESP_MAP = Object.fromEntries(
  RESPONSIBILITY_CATEGORIES.map((c) => [c.full.toLowerCase(), c.key]),
);

const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();
const party = (v) => PARTY_MAP[norm(v)] || "unclear";
const chan = (v) => CHANNEL_MAP[norm(v)] || "unclear";
const missedKind = (v) => MISSED_MAP[norm(v)] || "other";
const suggestionCat = (v) => SUGGESTION_MAP[norm(v)] || "other";
const respCat = (v) => RESP_MAP[norm(v)] || "other";

/** ExcelJS cell values may be strings, numbers, formula results, or rich text. */
function cellText(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return v.text;
    if ("result" in v) return v.result ?? "";
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return "";
  }
  return v;
}

const str = (v) => String(cellText(v)).trim();
function num(v) {
  const t = String(cellText(v)).replace(/[^0-9.\-]/g, "");
  if (t === "" || t === "-" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Read a worksheet into an array of objects keyed by its header-row text. */
function readSheet(wb, name) {
  const sheet = wb.getWorksheet(name);
  if (!sheet) return [];
  const headers = [];
  sheet.getRow(1).eachCell((c, col) => {
    headers[col] = str(c.value);
  });
  const rows = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const obj = {};
    let any = false;
    sheet.getRow(r).eachCell((c, col) => {
      const h = headers[col];
      if (!h) return;
      obj[h] = c.value;
      if (str(c.value) !== "") any = true;
    });
    if (any) rows.push(obj);
  }
  return rows;
}

/** Recompute the custody split from childcare rows (matches the backend). */
function recomputeBreakdown(childcare) {
  let mother = 0, father = 0, shared = 0, unclear = 0;
  for (const e of childcare) {
    if (e.parent === "mother") mother++;
    else if (e.parent === "father") father++;
    else if (e.parent === "shared") shared++;
    else unclear++;
  }
  const denom = mother + father + shared;
  const pct = (x) =>
    denom ? Math.round(((x + 0.5 * shared) / denom) * 1000) / 10 : 0;
  return {
    instances_with_mother: mother,
    instances_with_father: father,
    instances_shared: shared,
    instances_unclear: unclear,
    estimated_pct_mother: pct(mother),
    estimated_pct_father: pct(father),
  };
}

/**
 * Parse an edited custody-evidence workbook File into report data. Throws a
 * user-facing Error if it isn't a workbook this app produced.
 */
export async function parseCustodyWorkbook(file) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error("That file isn't a readable .xlsx workbook.");
  }
  if (!wb.getWorksheet("Childcare") && !wb.getWorksheet("Summary")) {
    throw new Error(
      "This doesn't look like a custody-evidence workbook exported by this app.",
    );
  }

  // Case metadata + narrative from the hidden round-trip payload.
  let base = {
    meta: {}, overview: "", breakdown_basis: "",
    sentiment_overview: "", limitations: [],
    tone_by_period: [], medical_appointments: [],
  };
  const src = wb.getWorksheet("_source");
  if (src) {
    let json = "";
    src.getColumn(1).eachCell((c) => { json += str(c.value); });
    try {
      base = { ...base, ...JSON.parse(json) };
    } catch { /* fall back to sheet-only reconstruction below */ }
  }

  const childcare = readSheet(wb, "Childcare").map((r) => ({
    date: str(r["Date"]),
    channel: chan(r["Source"]),
    parent: party(r["In whose care"]),
    description: str(r["Description"]),
    quote: str(r["Verbatim quote"]),
    sender: str(r["Message sender"]),
  }));
  const missed = readSheet(wb, "Missed & Cancelled").map((r) => ({
    date: str(r["Date"]),
    channel: chan(r["Source"]),
    kind: missedKind(r["Type"]),
    description: str(r["Description"]),
    quote: str(r["Verbatim quote"]),
    sender: str(r["Message sender"]),
  }));
  const gaps = readSheet(wb, "Communication Gaps").map((r) => ({
    start_date: str(r["Start date"]),
    end_date: str(r["End date"]),
    days: num(r["Length (days)"]) ?? 0,
    description: str(r["Description"]),
  }));
  const responsibility = readSheet(wb, "Responsibilities").map((r) => ({
    date: str(r["Date"]),
    channel: chan(r["Source"]),
    category: respCat(r["Court category"]),
    subcategory: str(r["Subcategory"]),
    responsible_party: party(r["Handled by"]),
    description: str(r["Description"]),
    quote: str(r["Verbatim quote"]),
    sender: str(r["Message sender"]),
  }));
  const thirdParty = readSheet(wb, "Third-Party").map((r) => ({
    date: str(r["Date"]),
    channel: chan(r["Source"]),
    source: str(r["Statement by"]),
    description: str(r["Description"]),
    quote: str(r["Verbatim quote"]),
  }));
  const suggestions = readSheet(wb, "Suggestions").map((r) => ({
    category: suggestionCat(r["Type"]),
    suggestion: str(r["Suggestion"]),
    related_date: str(r["Related date"]),
  }));
  const expenses = readSheet(wb, "Expense Ledger").map((r) => ({
    date: str(r["Date"]),
    amount: num(r["Amount (USD)"]) ?? 0,
    payer: party(r["Paid by"]),
    payer_evidence: str(r["How we know"]),
    vendor: str(r["Vendor"]),
    category: respCat(r["Court category"]),
    subcategory: str(r["Subcategory"]),
    description: str(r["Description"]),
    quote: str(r["Verbatim quote"]),
    billed_amount: num(r["Billed (EOB)"]),
    insurance_paid: num(r["Insurance paid (EOB)"]),
  }));

  // Medical register — the visible tab is editable (filling in the role
  // columns is exactly what the round-trip is for), so it wins over the
  // hidden _source copy; _source covers workbooks exported before the tab.
  const medicalRows = readSheet(wb, "Medical Appointments").map((r) => ({
    date: str(r["Date"]),
    child: str(r["Child"]),
    appointment_type: str(r["Type of medical"]),
    provider: str(r["Name of medical"]),
    planned_by: party(r["Planned by"]),
    scheduled_by: party(r["Scheduled by"]),
    taken_by: party(r["Taken by"]),
    paid_by: party(r["Paid by"]),
    amount: num(r["Amount (USD)"]),
    description: str(r["Description"]),
    quote: str(r["Verbatim quote"]),
    channel: "unclear",
  }));
  const medicalAppointments =
    medicalRows.length > 0 ? medicalRows : base.medical_appointments || [];

  const transcript = readSheet(wb, "Message Log").map((r) => ({
    ref: str(r["Ref"]),
    timestamp: str(r["Timestamp"]),
    channel: chan(r["Source"]),
    sender: str(r["Sender"]),
    conversation: str(r["Conversation"]),
    body: str(r["Message"]),
  }));

  // Narrative: honor edits made in the visible Summary sheet, else the payload.
  const summary = readSheet(wb, "Summary");
  const field = (name) => {
    const row = summary.find((r) => str(r["Field"]) === name);
    return row ? str(row["Value"]) : "";
  };

  const report = {
    overview: field("Overview") || base.overview,
    breakdown_basis: field("Custody breakdown basis") || base.breakdown_basis,
    sentiment_overview: field("Tone of communications") || base.sentiment_overview,
    limitations: base.limitations || [],
    tone_by_period: base.tone_by_period || [],
    medical_appointments: medicalAppointments,
    childcare_events: childcare,
    missed_or_cancelled: missed,
    communication_gaps: gaps,
    responsibility_events: responsibility,
    third_party_statements: thirdParty,
    suggestions,
    expenses,
  };

  return {
    meta: base.meta || {},
    custody_breakdown: recomputeBreakdown(childcare),
    report,
    transcript,
    edited: true,
  };
}
