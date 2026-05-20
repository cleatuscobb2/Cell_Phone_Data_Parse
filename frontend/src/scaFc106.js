/**
 * scaFc106.js — pure helper that builds a WV SCA-FC-106 Financial-Statement
 * worksheet from the data the report already has.
 *
 * The official SCA-FC-106 form has many fields the court system fills in
 * by hand: personal info, deductions, assets, debts. What the data
 * uniquely supports is the *expenses for the children* section —
 * monthly averages by category, who actually paid, and the share each
 * parent contributed. That is the hard-to-compute part of the form.
 *
 * Output is a deterministic JSON shape consumed by the web report,
 * the PDF, and the Excel workbook. No LLM call.
 */

import { RESPONSIBILITY_LABELS } from "./chartData.js";

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

const parseISO = (s) => {
  const m = (typeof s === "string" ? s : "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};

const monthsBetween = (start, end) => {
  if (!start || !end) return 0;
  const y = end.getFullYear() - start.getFullYear();
  const m = end.getMonth() - start.getMonth();
  return Math.max(1, y * 12 + m + 1); // inclusive
};

// SCA-FC-106 groups child-related categories into broad lines.
// We map the project's court categories into those lines.
export const SCA106_LINES = [
  {
    key: "child_care",
    line: "Work-related child care",
    categories: ["child_care"],
  },
  {
    key: "health",
    line: "Health insurance & uninsured medical / dental / vision",
    categories: ["medical_dental_eye"],
  },
  {
    key: "education",
    line: "Tuition, books, school fees",
    categories: ["education"],
  },
  {
    key: "extraordinary",
    line: "Extraordinary activities & lessons",
    categories: ["activities", "religious", "motor_vehicle", "childrens_employment"],
  },
  {
    key: "other",
    line: "Other (uncategorized)",
    categories: ["other"],
  },
];

/**
 * Build the SCA-FC-106 worksheet from the report's expenses plus an
 * optional `inputs.monthly_gross_income` the user supplies (since the
 * income side of the form is not derivable from messages).
 *
 *   expenses:    refed Expense list (with .ref)
 *   custodyBreakdown:  { estimated_pct_mother, estimated_pct_father }
 *   inputs:      { monthly_gross_income?: number }
 *
 * Returns null when there is no financial data to populate the form
 * (so callers can skip rendering the section entirely).
 */
export function buildSca106Worksheet(
  expenses = [],
  custodyBreakdown = {},
  inputs = {},
) {
  if (!expenses.length && !inputs.monthly_gross_income) return null;

  const dates = expenses
    .map((e) => parseISO(e.date))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const start = dates[0] || null;
  const end = dates[dates.length - 1] || null;
  const months = start && end ? monthsBetween(start, end) : 12;

  // Group expenses by category, then by SCA-FC-106 line.
  const catTotals = {};
  for (const e of expenses) {
    const c = e.category || "other";
    if (!catTotals[c]) {
      catTotals[c] = { mother: 0, father: 0, shared: 0, unclear: 0, count: 0 };
    }
    const amt = Number(e.amount || 0);
    if (catTotals[c][e.payer] !== undefined) catTotals[c][e.payer] += amt;
    catTotals[c].count += 1;
  }

  const lines = SCA106_LINES.map((spec) => {
    let mother = 0, father = 0, shared = 0, unclear = 0, count = 0;
    const presentCategories = [];
    for (const cat of spec.categories) {
      const t = catTotals[cat];
      if (!t || t.count === 0) continue;
      mother += t.mother;
      father += t.father;
      shared += t.shared;
      unclear += t.unclear;
      count += t.count;
      presentCategories.push(RESPONSIBILITY_LABELS[cat] || cat);
    }
    const total = mother + father + shared + unclear;
    const mf = mother + father;
    return {
      key: spec.key,
      line: spec.line,
      categories: presentCategories,
      count,
      total: round2(total),
      mother: round2(mother),
      father: round2(father),
      shared: round2(shared),
      unclear: round2(unclear),
      monthly_total: round2(total / months),
      monthly_mother: round2(mother / months),
      monthly_father: round2(father / months),
      mother_share_pct: mf > 0 ? Math.round((mother / mf) * 100) : 0,
      father_share_pct: mf > 0 ? 100 - Math.round((mother / mf) * 100) : 0,
    };
  }).filter((row) => row.count > 0);

  const grandTotal = lines.reduce((s, r) => s + r.total, 0);
  const motherTotal = lines.reduce((s, r) => s + r.mother, 0);
  const fatherTotal = lines.reduce((s, r) => s + r.father, 0);
  const monthlyChildExpenses = round2(grandTotal / months);

  const income = inputs.monthly_gross_income
    ? Number(inputs.monthly_gross_income)
    : null;
  const childExpensesAsPctOfIncome =
    income && income > 0
      ? Math.round((monthlyChildExpenses / income) * 1000) / 10
      : null;

  return {
    period: {
      start: start ? start.toISOString().slice(0, 10) : null,
      end: end ? end.toISOString().slice(0, 10) : null,
      months,
    },
    lines,
    totals: {
      annual_child_expenses: round2(grandTotal),
      monthly_child_expenses: monthlyChildExpenses,
      mother_total: round2(motherTotal),
      father_total: round2(fatherTotal),
      mother_monthly: round2(motherTotal / months),
      father_monthly: round2(fatherTotal / months),
    },
    custody_time: {
      mother_pct: Number(custodyBreakdown.estimated_pct_mother ?? 0),
      father_pct: Number(custodyBreakdown.estimated_pct_father ?? 0),
    },
    income: income != null ? { monthly_gross: income } : null,
    child_expenses_as_pct_of_income: childExpensesAsPctOfIncome,
  };
}
