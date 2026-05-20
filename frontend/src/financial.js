/**
 * financial.js — pure helpers that turn a list of Expense rows into the
 * shapes the report renderers need.
 *
 * The Expense entity carries `category`, `subcategory`, `payer`, `amount`,
 * and `date`. Everything below is deterministic — totals are derived
 * from those rows, no LLM call needed.
 *
 *   buildFinancialSummary(expenses)        → category, year, and cumulative
 *                                            totals + a grand total
 *   buildFinancialCrossValidation(expenses,
 *     responsibilityEvents)                → list of inconsistencies
 *                                            (claims without receipts,
 *                                            receipts without claims)
 *
 * The category labels mirror the seven court-recognized parenting
 * responsibilities used by ResponsibilityEvent, so a single labels map
 * works for both reports.
 */

import { RESPONSIBILITY_LABELS } from "./chartData.js";

export const PARTY_COLORS = {
  mother: "#6366f1",
  father: "#f97316",
  shared: "#f59e0b",
  unclear: "#94a3b8",
};

const EMPTY_PARTY_TOTALS = () => ({
  mother: 0,
  father: 0,
  shared: 0,
  unclear: 0,
});

const yearOf = (date) => {
  const m = (typeof date === "string" ? date : "").match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
};

const round = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Total amount paid by each party — for a quick {mother,father,shared,unclear}. */
function tallyParties(expenses) {
  const t = EMPTY_PARTY_TOTALS();
  for (const e of expenses) {
    if (t[e.payer] !== undefined) t[e.payer] += Number(e.amount || 0);
  }
  for (const k of Object.keys(t)) t[k] = round(t[k]);
  return t;
}

/** Per-category breakdown — one row per category that has any expense. */
function buildByCategory(expenses) {
  const map = {};
  for (const e of expenses) {
    const k = e.category || "other";
    if (!map[k]) {
      map[k] = {
        key: k,
        label: RESPONSIBILITY_LABELS[k] || "Other",
        totals: EMPTY_PARTY_TOTALS(),
        expense_count: 0,
        grand_total: 0,
      };
    }
    const amt = Number(e.amount || 0);
    if (map[k].totals[e.payer] !== undefined) map[k].totals[e.payer] += amt;
    map[k].grand_total += amt;
    map[k].expense_count += 1;
  }
  // Round to cents and compute mother / father percentage shares for charting.
  const rows = Object.values(map).map((r) => {
    for (const p of Object.keys(r.totals)) r.totals[p] = round(r.totals[p]);
    r.grand_total = round(r.grand_total);
    const mf = r.totals.mother + r.totals.father;
    r.motherPct = mf > 0 ? Math.round((r.totals.mother / mf) * 100) : 0;
    r.fatherPct = mf > 0 ? 100 - r.motherPct : 0;
    return r;
  });
  return rows.sort((a, b) => b.grand_total - a.grand_total);
}

/** Per-year breakdown — mother vs father totals each calendar year. */
function buildByYear(expenses) {
  const map = {};
  for (const e of expenses) {
    const y = yearOf(e.date);
    if (y == null) continue;
    if (!map[y]) map[y] = { year: y, ...EMPTY_PARTY_TOTALS(), grand_total: 0 };
    const amt = Number(e.amount || 0);
    if (map[y][e.payer] !== undefined) map[y][e.payer] += amt;
    map[y].grand_total += amt;
  }
  return Object.values(map)
    .map((r) => {
      for (const p of ["mother", "father", "shared", "unclear"]) r[p] = round(r[p]);
      r.grand_total = round(r.grand_total);
      return r;
    })
    .sort((a, b) => a.year - b.year);
}

/** Running mother / father totals at each expense date, for a line chart. */
function buildCumulative(expenses) {
  const sorted = [...expenses]
    .filter((e) => e.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let mother = 0;
  let father = 0;
  const points = sorted.map((e) => {
    const amt = Number(e.amount || 0);
    if (e.payer === "mother") mother += amt;
    else if (e.payer === "father") father += amt;
    return {
      date: e.date,
      mother: round(mother),
      father: round(father),
    };
  });
  return points;
}

/** Headline summary for the financial section. */
export function buildFinancialSummary(expenses = []) {
  if (!expenses.length) {
    return {
      hasExpenses: false,
      grand_total: EMPTY_PARTY_TOTALS(),
      total: 0,
      by_category: [],
      by_year: [],
      cumulative: [],
      period: null,
    };
  }
  const totals = tallyParties(expenses);
  const dates = expenses.map((e) => e.date).filter(Boolean).sort();
  return {
    hasExpenses: true,
    grand_total: totals,
    total: round(totals.mother + totals.father + totals.shared + totals.unclear),
    by_category: buildByCategory(expenses),
    by_year: buildByYear(expenses),
    cumulative: buildCumulative(expenses),
    period: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null,
  };
}

const DAY = 24 * 60 * 60 * 1000;

const parseISO = (s) => {
  const m = (typeof s === "string" ? s : "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Cross-validate messages-about-money against actual financial documents.
 *
 *   claim_without_receipt — a parent says they paid for X but no Expense
 *     of the same category exists within ±30 days
 *   receipt_without_claim — an Expense exists but no message mentions a
 *     same-category responsibility within ±14 days (lower-priority — many
 *     legit receipts never come up in messages)
 *
 * Each finding cites the refs of the document(s) involved so the user
 * can follow up immediately.
 */
export function buildFinancialCrossValidation(
  expenses = [],
  responsibilityEvents = [],
  options = {},
) {
  const claimWindow = options.claimWindow ?? 30; // days
  const receiptWindow = options.receiptWindow ?? 14;
  const findings = [];

  const expWithDate = expenses
    .map((e) => ({ ...e, _d: parseISO(e.date) }))
    .filter((e) => e._d);
  const respWithDate = responsibilityEvents
    .map((r) => ({ ...r, _d: parseISO(r.date) }))
    .filter((r) => r._d);

  // Forward: claim → receipt.  Skip "unclear" — we can't say either way.
  for (const r of respWithDate) {
    if (r.responsible_party === "unclear") continue;
    const match = expWithDate.find(
      (e) =>
        e.category === r.category &&
        e.payer === r.responsible_party &&
        Math.abs(e._d - r._d) <= claimWindow * DAY,
    );
    if (!match) {
      findings.push({
        kind: "claim_without_receipt",
        date: r.date,
        description:
          `${r.responsible_party === "mother" ? "Mother" : "Father"} claimed ` +
          `responsibility for ${RESPONSIBILITY_LABELS[r.category] || r.category}` +
          (r.subcategory ? ` (${r.subcategory})` : "") +
          ` — no matching expense within ±${claimWindow} days.`,
        refs: [r.ref].filter(Boolean),
        category: r.category,
        party: r.responsible_party,
      });
    }
  }

  // Reverse: receipt → claim.
  for (const e of expWithDate) {
    const match = respWithDate.find(
      (r) =>
        r.category === e.category &&
        Math.abs(r._d - e._d) <= receiptWindow * DAY,
    );
    if (!match) {
      findings.push({
        kind: "receipt_without_claim",
        date: e.date,
        description:
          `$${e.amount.toFixed(2)} paid by ` +
          `${e.payer === "mother" || e.payer === "father" ? e.payer : "—"} ` +
          `to ${e.vendor || "vendor"} (${RESPONSIBILITY_LABELS[e.category] || e.category})` +
          ` — not discussed in any message within ±${receiptWindow} days.`,
        refs: [e.ref].filter(Boolean),
        category: e.category,
        party: e.payer,
      });
    }
  }

  // Sort by date so the report reads chronologically.
  return findings.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
