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
import { buildSca106Worksheet } from "./scaFc106.js";

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
  // Sole-payer detection divides by ATTRIBUTED spend only (mother + father +
  // shared). "Unclear" is the absence of payer evidence, not evidence the
  // other parent paid — a batch of unattributed bank rows must not defeat the
  // signal when every payment that IS attributed belongs to one parent.
  // Shared spend does count against it, since shared implies both paid.
  const finAttributed =
    (partyTotals.mother || 0) + (partyTotals.father || 0) + (partyTotals.shared || 0);
  const finSolePayer =
    finAttributed > 0
      ? ["mother", "father"].find(
          (p) => (partyTotals[p] || 0) / finAttributed >= 0.995,
        ) || null
      : null;
  const finPayerLabel = finSolePayer === "father" ? "father" : userRole;
  const finTotalShown = finSolePayer ? partyTotals[finSolePayer] || 0 : fin.total;

  const missed = missedSummary(report.missed_or_cancelled || []);
  const care = partyYearSummary(report.childcare_events || [], "parent");
  const thirdParty = thirdPartySummary(report);
  const medical = medicalAppointments(report);
  const medSummary = medicalSummary(medical);
  const responsibilities = responsibilityData(report);
  const radarData = responsibilityRadarData(report);
  const respThemes = responsibilityThemes(report);

  // --- WV SCA-FC-106 worksheet ------------------------------------------
  // Built here (not per renderer) so the sole-payer fold is applied
  // consistently everywhere. `scaNeedsAttribution` flags the one case the
  // form's % split genuinely cannot be filled: expenses exist but no payer
  // is attributed and no sole payer is detectable — the fix is the
  // card-lookup mapping (last-4 → parent) or payer-named exports.
  const isWV = (meta.jurisdiction?.state || "") === "West Virginia";
  const sca106 = isWV
    ? buildSca106Worksheet(expenses, cb, meta.financial_inputs || {}, {
        solePayer: finSolePayer,
      })
    : null;
  const scaNeedsAttribution = Boolean(
    sca106 &&
      !finSolePayer &&
      expenses.length > 0 &&
      (partyTotals.mother || 0) + (partyTotals.father || 0) === 0,
  );

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
  if (medical.rows.length > 0) {
    const n = medical.rows.length;
    const tally = (field) =>
      medical.rows.reduce(
        (acc, r) => {
          const v = r[field];
          if (v === "mother" || v === "father") acc[v] += 1;
          return acc;
        },
        { mother: 0, father: 0 },
      );
    const took = medical.derived ? tally("handled_by") : tally("taken_by");
    findings.push(
      `${n} medical appointment${n === 1 ? "" : "s"} on record` +
        (took.mother + took.father > 0
          ? ` — ${took.mother} ${medical.derived ? "handled" : "attended"} by ` +
            `${userRole}, ${took.father} by father`
          : "") +
        ".",
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

  // --- Side-by-side parent comparison for the Overview ------------------
  // One row per dimension, a short phrase per parent — strengths, tone,
  // contributions and responsibilities at a glance. Everything is counts
  // from the evidence above; nothing editorial.
  const catLead = (party) =>
    responsibilities
      .map((r) => ({ short: r.category, diff: r[party] - r[party === "mother" ? "father" : "mother"] }))
      .filter((r) => r.diff > 0)
      .sort((a, b) => b.diff - a.diff)
      .slice(0, 2)
      .map((r) => r.short);
  const themeLead = (party) =>
    respThemes
      .map((t) => ({ label: t.label, diff: t[party] - t[party === "mother" ? "father" : "mother"] }))
      .filter((t) => t.diff > 0)
      .sort((a, b) => b.diff - a.diff)
      .slice(0, 2)
      .map((t) => t.label);
  const toneOf = (party) => {
    const entries = (report.tone_by_period || []).filter((t) => t.party === party);
    if (!entries.length) return null;
    const counts = {};
    for (const t of entries) counts[t.label] = (counts[t.label] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const years = entries.map((t) => t.period).sort();
    const span = years[0] === years[years.length - 1]
      ? years[0]
      : `${years[0]}–${years[years.length - 1]}`;
    return `mostly ${top} (${span})`;
  };
  const respTotals = {
    mother: responsibilities.reduce((s, r) => s + r.mother, 0),
    father: responsibilities.reduce((s, r) => s + r.father, 0),
  };
  const cell = (party) => {
    const other = party === "mother" ? "father" : "mother";
    void other;
    return {
      care:
        care.total > 0
          ? `${care.byParty[party]} childcare instance${care.byParty[party] === 1 ? "" : "s"} (${party === "mother" ? cb.estimated_pct_mother ?? 0 : cb.estimated_pct_father ?? 0}% of time)`
          : "—",
      responsibilities:
        respTotals[party] > 0
          ? `${respTotals[party]} handled` +
            (catLead(party).length ? ` — leads in ${catLead(party).join(", ")}` : "")
          : "none recorded",
      communication:
        [
          toneOf(party),
          missed.hasParty && missed.byParty[party] > 0
            ? `${missed.byParty[party]} missed/cancelled`
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || "—",
      contributions:
        (partyTotals[party] || 0) > 0
          ? `${usd(party === finSolePayer ? finTotalShown : partyTotals[party])} documented`
          : "none documented",
      strengths: themeLead(party).join(", ") || "—",
    };
  };
  const parentCompare =
    attributed + respTotals.mother + respTotals.father > 0
      ? {
          rows: [
            { dim: "Care & time", key: "care" },
            { dim: "Responsibilities", key: "responsibilities" },
            { dim: "Communication & tone", key: "communication" },
            { dim: "Contributions", key: "contributions" },
            { dim: "Most-mentioned themes", key: "strengths" },
          ],
          mother: cell("mother"),
          father: cell("father"),
        }
      : null;

  return {
    userRole,
    expenses,
    fin,
    finFindings,
    finSolePayer,
    finPayerLabel,
    finTotalShown,
    missed,
    care,
    thirdParty,
    medical,
    medSummary,
    responsibilities,
    radarData,
    respThemes,
    findings,
    sca106,
    scaNeedsAttribution,
    parentCompare,
  };
}

/**
 * Hard cap on the Overview narrative. Reports produced by older backends
 * concatenated every analysis window's overview — up to five PAGES of prose.
 * The report leads with a short synopsis (the At-a-Glance bullets carry the
 * detail); the full text stays in the workbook's Summary tab.
 */
export function conciseOverview(text, { maxSentences = 4, maxChars = 700 } = {}) {
  const full = String(text || "").trim();
  if (!full) return { text: "", truncated: false };
  const sentences = full.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [full];
  let out = "";
  let n = 0;
  for (const s of sentences) {
    if (n >= maxSentences || out.length + s.length > maxChars) break;
    out += s;
    n += 1;
  }
  if (!out) out = full.slice(0, maxChars);
  out = out.trim();
  const truncated = out.length < full.length;
  return { text: truncated ? `${out}…` : out, truncated };
}

/**
 * Generic per-party / per-year rollup for any dated, party-attributed event
 * list — the same shape missedSummary produces, so Care Pattern, Missed and
 * others can present matching summary blocks.
 */
export function partyYearSummary(items = [], partyField = "parent") {
  const PARTIES = ["mother", "father", "shared", "unclear"];
  const blank = () => ({ mother: 0, father: 0, shared: 0, unclear: 0 });
  const byParty = blank();
  const byYearMap = {};
  for (const it of items) {
    const p = PARTIES.includes(it[partyField]) ? it[partyField] : "unclear";
    byParty[p] += 1;
    const y = String(it.date || "").slice(0, 4) || "—";
    if (!byYearMap[y]) byYearMap[y] = { year: y, total: 0, ...blank() };
    byYearMap[y].total += 1;
    byYearMap[y][p] += 1;
  }
  const byYear = Object.values(byYearMap).sort((a, b) =>
    String(a.year).localeCompare(String(b.year)),
  );
  return {
    total: items.length,
    byParty,
    byYear,
    busiest: byYear.length
      ? [...byYear].sort((a, b) => b.total - a.total)[0]
      : null,
  };
}

/**
 * Third-party corroboration summarized: who said things about the family's
 * caregiving, how often, when — plus a few representative statements. The
 * full row list lives in the evidence workbook.
 */
export function thirdPartySummary(report) {
  const items = report?.third_party_statements || [];
  const bySourceMap = {};
  const byYearMap = {};
  for (const t of items) {
    const src = String(t.source || "Unnamed").trim() || "Unnamed";
    bySourceMap[src] = (bySourceMap[src] || 0) + 1;
    const y = String(t.date || "").slice(0, 4) || "—";
    byYearMap[y] = (byYearMap[y] || 0) + 1;
  }
  const highlights = [...items]
    .filter((t) => (t.quote || "").trim())
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 3);
  return {
    total: items.length,
    sources: Object.keys(bySourceMap).length,
    bySource: Object.entries(bySourceMap)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count),
    byYear: Object.entries(byYearMap)
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year.localeCompare(b.year)),
    highlights,
  };
}

/**
 * Medical register rolled up for the summary view and its chart: counts by
 * appointment type (split by the acting parent), by child, and a per-role
 * mother/father tally. The row-level detail lives in the workbook's
 * "Medical Appointments" tab.
 */
export function medicalSummary(medical) {
  const rows = medical?.rows || [];
  const actorOf = (r) =>
    medical.derived
      ? r.handled_by
      : ["taken_by", "scheduled_by", "planned_by", "paid_by"]
          .map((f) => r[f])
          .find((v) => v === "mother" || v === "father") || "unclear";
  const byTypeMap = {};
  const byChildMap = {};
  for (const r of rows) {
    const t = (r.appointment_type || "Unspecified").trim() || "Unspecified";
    if (!byTypeMap[t]) byTypeMap[t] = { type: t, mother: 0, father: 0, shared: 0, unclear: 0, total: 0 };
    const actor = actorOf(r);
    byTypeMap[t][actor in byTypeMap[t] ? actor : "unclear"] += 1;
    byTypeMap[t].total += 1;
    const c = (r.child || "Unspecified").trim() || "Unspecified";
    byChildMap[c] = (byChildMap[c] || 0) + 1;
  }
  const roleTally = {};
  const roles = medical?.derived
    ? [["handled", "handled_by"]]
    : [["planned", "planned_by"], ["scheduled", "scheduled_by"], ["took", "taken_by"]];
  for (const [label, field] of [...roles, ["paid", "paid_by"]]) {
    roleTally[label] = rows.reduce(
      (acc, r) => {
        if (r[field] === "mother") acc.mother += 1;
        else if (r[field] === "father") acc.father += 1;
        return acc;
      },
      { mother: 0, father: 0 },
    );
  }
  const spend = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return {
    total: rows.length,
    byType: Object.values(byTypeMap).sort((a, b) => b.total - a.total),
    byChild: Object.entries(byChildMap)
      .map(([child, count]) => ({ child, count }))
      .sort((a, b) => b.count - a.count),
    roleTally,
    spend: Math.round(spend * 100) / 100,
  };
}

const MED_CATEGORY = "medical_dental_eye";
const DAY_MS = 86400000;

function parseDay(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
const byDate = (a, b) => String(a.date || "").localeCompare(String(b.date || ""));

/**
 * The medical appointment register.
 *
 * Prefers report.medical_appointments, which attributes each role — who
 * planned it, who booked it, who took the child, who paid — separately.
 * Reports generated before that field existed only record a single
 * `responsible_party` per medical responsibility event, so for those we
 * derive what we honestly can: pair each medical responsibility event with a
 * medical expense within a week (giving the provider and who paid) and
 * report the combined party as `handled_by` rather than guessing which role
 * it was. `derived` tells the renderer which shape it's looking at.
 */
export function medicalAppointments(report) {
  const structured = Array.isArray(report?.medical_appointments)
    ? report.medical_appointments
    : [];
  if (structured.length > 0) {
    return { derived: false, rows: [...structured].sort(byDate) };
  }

  const events = (report?.responsibility_events || []).filter(
    (r) => r.category === MED_CATEGORY,
  );
  const expenses = (report?.expenses || []).filter(
    (e) => e.category === MED_CATEGORY,
  );
  const claimed = new Set();
  const rows = events.map((r) => {
    // Pair with the nearest unclaimed medical expense within a week — that's
    // what supplies the provider name and who paid.
    let best = -1;
    let bestGap = Infinity;
    const rd = parseDay(r.date);
    expenses.forEach((e, i) => {
      if (claimed.has(i)) return;
      const ed = parseDay(e.date);
      if (rd == null || ed == null) return;
      const gap = Math.abs(ed - rd);
      if (gap <= 7 * DAY_MS && gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    });
    const e = best >= 0 ? expenses[best] : null;
    if (e) claimed.add(best);
    return {
      date: r.date || e?.date || "",
      child: "",
      appointment_type: r.subcategory || e?.subcategory || "",
      provider: e?.vendor || "",
      handled_by: r.responsible_party || "unclear",
      planned_by: "unclear",
      scheduled_by: "unclear",
      taken_by: "unclear",
      paid_by: e?.payer || "unclear",
      amount: e ? Number(e.amount || 0) : null,
      description: r.description || "",
      quote: r.quote || "",
      channel: r.channel || "unclear",
    };
  });
  // A medical payment with no matching message still evidences a visit.
  expenses.forEach((e, i) => {
    if (claimed.has(i)) return;
    rows.push({
      date: e.date || "",
      child: "",
      appointment_type: e.subcategory || "",
      provider: e.vendor || "",
      handled_by: "unclear",
      planned_by: "unclear",
      scheduled_by: "unclear",
      taken_by: "unclear",
      paid_by: e.payer || "unclear",
      amount: Number(e.amount || 0),
      description: e.description || "",
      quote: e.quote || "",
      channel: "unclear",
    });
  });
  return { derived: true, rows: rows.sort(byDate) };
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
