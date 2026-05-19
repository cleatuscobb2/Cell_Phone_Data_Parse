/**
 * messageRefs.js — stable reference IDs for the uploaded messages.
 *
 * Every message gets a short, human-readable ref: "T1", "T2", … for text
 * messages and "E1", "E2", … for emails, numbered in chronological order
 * within each channel. Extracted events are then linked back to the message
 * they were quoted from.
 *
 * These refs let the PDF and Excel reports trace a timeline marker or an
 * evidence item to the exact source text or email — the static stand-in for
 * the web report's hover detail, which print/spreadsheet output can't show.
 */

/** Annotate a transcript so each message carries a `ref` ("T14", "E3"). */
export function refMessages(transcript = []) {
  const count = { text: 0, email: 0 };
  return transcript.map((m) => {
    const channel = m.channel === "email" ? "email" : "text";
    count[channel] += 1;
    return { ...m, ref: (channel === "email" ? "E" : "T") + count[channel] };
  });
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
 * Convenience for report renderers: the ref-annotated transcript plus a
 * `link(event)` that returns the source-message ref for any quoted event.
 */
export function buildEvidenceRefs(data) {
  const refed = refMessages((data && data.transcript) || []);
  return {
    refed,
    link: (event) =>
      event ? sourceRef(event.quote, event.date, refed) : null,
  };
}
