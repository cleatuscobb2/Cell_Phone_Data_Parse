/**
 * reportInsights — the one derived model behind both the on-screen report and
 * the PDF.
 *
 * Everything the two renderers need beyond the raw report lives here: the
 * financial rollup and who actually paid, the missed-visit summary, the
 * responsibility charts and cross-cutting themes, and the "At a Glance"
 * findings. Deriving it once is what keeps the screen and the PDF saying the
 * same thing — previously each computed its own and they could drift.
 *
 * Renderers supply their own colours; this module stays presentation-free
 * apart from the pre-formatted finding sentences.
 */

import {
  missedSummary,
  responsibilityData,
  responsibilityRadarData,
  responsibilityThemes,
} from "./chartData.js";
import {
  buildFinancialSummary,
  buildFinancialCrossValidation,
} from "./financial.js";
import { refExpenses } from "./messageRefs.js";

export const usd = (n) =>
  `$${Number(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const PARTIES = ["mother", "father", "shared", "unclear"];

export function buildReportInsights(data) {
  const { meta = {}, custody_breakdown: cb = {}, report = {} } = data || {};
  const userRole = meta.user_role || "mother";

  const expenses = refExpenses(report.expenses || []);
  const fin = buildFinancialSummary(expenses);
  const finFindings = fin.hasExpenses
    ? buildFinancialCrossValidation(expenses, report.responsibility_events || [])
    : [];

  // When effectively every document belongs to one parent (common when only
  // that parent's receipts were uploaded), the report presents it as their
  // contributions rather than a split implying the other paid nothing.
  const partyTotals = fin.grand_total || {};
  const finSum = PARTIES.reduce((s, p) => s + (partyTotals[p] || 0), 0);
  const finSolePayer =
    finSum > 0
      ? ["mother", "father"].find(
          (p) => (partyTotals[p] || 0) / finSum >= 0.995,
        ) || null
      : null;
  const finPayerLabel = finSolePayer === "father" ? "father" : userRole;
  const finTotalShown = finSolePayer ? partyTotals[finSolePayer] || 0 : fin.total;

  const missed = missedSummary(report.missed_or_cancelled || []);
  const responsibilities = responsibilityData(report);
  const radarData = responsibilityRadarData(report);
  const respThemes = responsibilityThemes(report);

  // --- At a Glance -------------------------------------------------------
  const findings = [];
  const attributed =
    (cb.instances_with_mother || 0) +
    (cb.instances_with_father || 0) +
    (cb.instances_shared || 0);
  if (attributed > 0) {
    findings.push(
      `Childcare splits ${cb.estimated_pct_mother ?? 0}% / ` +
        `${cb.estimated_pct_father ?? 0}% (${userRole} / father) across ` +
        `${attributed} attributable instance${attributed === 1 ? "" : "s"}` +
        (cb.instances_unclear
          ? `; ${cb.instances_unclear} could not be attributed.`
          : "."),
    );
  }
  if (missed.total > 0) {
    const worst = [...missed.byYear].sort((a, b) => b.total - a.total)[0];
    findings.push(
      `${missed.total} missed or cancelled visit${missed.total === 1 ? "" : "s"}` +
        (missed.hasParty
          ? ` — ${missed.byParty.father} attributed to father, ` +
            `${missed.byParty.mother} to ${userRole}`
          : "") +
        (worst ? `; ${worst.year} was the heaviest year (${worst.total}).` : "."),
    );
  }
  if (responsibilities.length > 0) {
    const mTot = responsibilities.reduce((s, r) => s + r.mother, 0);
    const fTot = responsibilities.reduce((s, r) => s + r.father, 0);
    findings.push(
      `Of ${(report.responsibility_events || []).length} parenting-responsibility ` +
        `entries, ${userRole} handled ${mTot} and father ${fTot}; the heaviest ` +
        `category is ${responsibilities[0].full}.`,
    );
  }
  if (respThemes.length > 0) {
    const lopsided = respThemes
      .map((t) => ({ ...t, gap: Math.abs(t.mother - t.father) }))
      .filter((t) => t.gap > 0)
      .sort((a, b) => b.gap - a.gap)
      .slice(0, 3);
    if (lopsided.length > 0) {
      findings.push(
        "Most one-sided themes: " +
          lopsided
            .map((t) => `${t.label} (${userRole} ${t.mother} vs father ${t.father})`)
            .join("; ") +
          ".",
      );
    }
  }
  if (fin.hasExpenses) {
    findings.push(
      `${usd(finTotalShown)} in documented child-related expenses across ` +
        `${expenses.length} document${expenses.length === 1 ? "" : "s"}` +
        (finSolePayer ? `, all paid by ${finPayerLabel}` : "") +
        ".",
    );
  }
  const gaps = report.communication_gaps || [];
  if (gaps.length > 0) {
    const longest = [...gaps].sort((a, b) => (b.days || 0) - (a.days || 0))[0];
    findings.push(
      `${gaps.length} notable communication gap${gaps.length === 1 ? "" : "s"}; ` +
        `the longest ran ${longest.days} days (${longest.start_date} to ` +
        `${longest.end_date}).`,
    );
  }

  return {
    userRole,
    expenses,
    fin,
    finFindings,
    finSolePayer,
    finPayerLabel,
    finTotalShown,
    missed,
    responsibilities,
    radarData,
    respThemes,
    findings,
  };
}

/**
 * Tone grouped by year for the "by year and parent" read. Returns [] when the
 * report predates the structured field, so callers fall back to the narrative.
 */
export function toneByYear(report) {
  const periods = Array.isArray(report?.tone_by_period) ? report.tone_by_period : [];
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
  return years.map((y) => ({ year: y, entries: byYear[y] }));
}
