/**
 * messageRefs.js — stable reference IDs for every uploaded document.
 *
 * Every message and every financial document gets a short, human-readable
 * ref, numbered in chronological order within its source type:
 *   T1, T2, …  text messages
 *   E1, E2, …  emails
 *   R1, R2, …  receipts / invoices / bills
 *   I1, I2, …  insurance Explanation-of-Benefits service lines
 *   V1, V2, …  payment-app transactions (Venmo, Zelle, Cash App, PayPal)
 *   B1, B2, …  bank / credit-card transactions
 *
 * Extracted events and expenses are linked back to the document they came
 * from by these refs. They let the PDF and Excel reports trace a timeline
 * marker, an evidence item, or an expense row to its exact source — the
 * static stand-in for the web report's hover detail, which print and
 * spreadsheet output can't show.
 */

const EXPENSE_PREFIX = {
  receipt: "R",
  eob: "I",
  payment_app: "V",
  bank: "B",
};

/** Annotate a transcript so each message carries a `ref` ("T14", "E3"). */
export function refMessages(transcript = []) {
  const count = { text: 0, email: 0 };
  return transcript.map((m) => {
    const channel = m.channel === "email" ? "email" : "text";
    count[channel] += 1;
    return { ...m, ref: (channel === "email" ? "E" : "T") + count[channel] };
  });
}

/** Build the ref string for an expense from its source_type + source_index. */
export function expenseRef(expense) {
  if (!expense) return null;
  const prefix = EXPENSE_PREFIX[expense.source_type];
  if (!prefix) return null;
  return prefix + (Number(expense.source_index ?? 0) + 1);
}

/** Annotate an expense list so each carries a `ref` ("R3", "V12"). */
export function refExpenses(expenses = []) {
  return expenses.map((e) => ({ ...e, ref: expenseRef(e) }));
}

/** Normalize text for tolerant verbatim matching. */
function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[‘’“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find the ref of the message a verbatim `quote` came from. The quote is
 * matched against message bodies; when several messages match, one dated
 * `date` is preferred. Returns the ref string, or null if nothing matches.
 */
export function sourceRef(quote, date, refed) {
  const q = norm(quote);
  if (q.length < 6) return null;
  const hits = refed.filter((m) => {
    const b = norm(m.body);
    return b.length > 0 && (b.includes(q) || q.includes(b));
  });
  if (hits.length === 0) return null;
  if (date) {
    const onDate = hits.find((m) =>
      String(m.timestamp || "").startsWith(date),
    );
    if (onDate) return onDate.ref;
  }
  return hits[0].ref;
}

/**
 * Convenience for report renderers: a ref-annotated transcript, a
 * ref-annotated expense list, and a `link(event)` that returns the
 * source-message ref for any quoted event.
 */
export function buildEvidenceRefs(data) {
  const refed = refMessages((data && data.transcript) || []);
  const expenses = refExpenses((data && data.report && data.report.expenses) || []);
  return {
    refed,
    expenses,
    link: (event) =>
      event ? sourceRef(event.quote, event.date, refed) : null,
  };
}
