/**
 * mboxCondense — stream-parse a large .mbox mailbox IN THE BROWSER and
 * condense it to the compact JSON message shape the backend already accepts.
 *
 * Why: the deployed backend caps HTTP requests at 32 MB, and a real mailbox
 * export easily runs to gigabytes — almost all of it attachment payloads and
 * MIME overhead the analysis never reads. Streaming the file here means the
 * raw mailbox never leaves the user's machine; only sender / date / subject /
 * cleaned text (and attachment *names*) are uploaded.
 *
 * The output mirrors backend parse_emails() conventions exactly:
 *   - sender "Me" + conversation = first To recipient when the mail is from
 *     the user; otherwise sender = From display-name (or address) and
 *     conversation = sender
 *   - body = "Subject — text", quoted reply history stripped, capped at 800
 *   - timestamps keep the email's own wall-clock time
 */

// Mirrors _REPLY_MARKERS / _clean_email_body in backend parser.py.
const REPLY_MARKERS = [
  "\n-----Original Message-----",
  "\n________________________________",
];

const BODY_CAP = 800;

/** Strip quoted reply history, ">" lines, collapse whitespace, cap length. */
export function cleanEmailBody(text) {
  if (!text) return "";
  let cut = text.length;
  for (const marker of REPLY_MARKERS) {
    const i = text.indexOf(marker);
    if (i !== -1) cut = Math.min(cut, i);
  }
  const m = text.match(/\nOn [\s\S]{0,200}? wrote:/);
  if (m && m.index !== undefined) cut = Math.min(cut, m.index);
  const lines = text
    .slice(0, cut)
    .split(/\r?\n/)
    .map((ln) => ln.trim())
    .filter((ln) => ln && !ln.startsWith(">"));
  return lines.join(" ").slice(0, BODY_CAP);
}

/** Decode RFC 2047 encoded words: =?charset?B|Q?data?= (Subject/From names). */
export function decodeHeaderText(value) {
  if (!value) return "";
  return value.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (whole, charset, enc, data) => {
      try {
        let bytes;
        if (enc.toUpperCase() === "B") {
          const bin = atob(data);
          bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        } else {
          const qp = data.replace(/_/g, " ");
          const out = [];
          for (let i = 0; i < qp.length; i++) {
            if (qp[i] === "=" && i + 2 < qp.length + 1) {
              const hex = qp.slice(i + 1, i + 3);
              if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
                out.push(parseInt(hex, 16));
                i += 2;
                continue;
              }
            }
            out.push(qp.charCodeAt(i));
          }
          bytes = Uint8Array.from(out);
        }
        return new TextDecoder(normalizeCharset(charset)).decode(bytes);
      } catch {
        return whole;
      }
    },
  );
}

function normalizeCharset(cs) {
  const c = (cs || "utf-8").toLowerCase().trim();
  try {
    new TextDecoder(c);
    return c;
  } catch {
    return "utf-8";
  }
}

/** Decode a body per Content-Transfer-Encoding into text. */
function decodeBody(raw, cte, charset) {
  const enc = (cte || "").toLowerCase().trim();
  try {
    if (enc === "base64") {
      const compact = raw.replace(/[\r\n\s]/g, "");
      const bin = atob(compact);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder(normalizeCharset(charset)).decode(bytes);
    }
    if (enc === "quoted-printable") {
      const joined = raw.replace(/=\r?\n/g, "");
      const out = [];
      for (let i = 0; i < joined.length; i++) {
        if (joined[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(joined.slice(i + 1, i + 3))) {
          out.push(parseInt(joined.slice(i + 1, i + 3), 16));
          i += 2;
        } else {
          out.push(joined.charCodeAt(i) & 0xff);
        }
      }
      return new TextDecoder(normalizeCharset(charset)).decode(Uint8Array.from(out));
    }
  } catch {
    /* fall through to raw */
  }
  return raw;
}

/** Parse a header block into a lowercase-keyed map (folded lines unfolded). */
function parseHeaders(block) {
  const headers = {};
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    // First occurrence wins (matches Python's msg.get behavior).
    if (!(key in headers)) headers[key] = val;
  }
  return headers;
}

/** "Display Name <addr@x>" → { name, addr } (first address only). */
export function parseAddress(value) {
  const decoded = decodeHeaderText(value || "").trim();
  const angled = decoded.match(/^(.*?)<([^<>]+)>/);
  if (angled) {
    return {
      name: angled[1].replace(/^["']|["']\s*$/g, "").trim(),
      addr: angled[2].trim().toLowerCase(),
    };
  }
  const bare = decoded.match(/[^\s,;"<>]+@[^\s,;"<>]+/);
  return { name: "", addr: bare ? bare[0].toLowerCase() : "" };
}

function param(headerValue, name) {
  const m = (headerValue || "").match(
    new RegExp(name + '\\s*=\\s*"?([^";\\r\\n]+)"?', "i"),
  );
  return m ? m[1].trim() : "";
}

/** Timestamp keeping the email's own wall-clock time, as ISO (no zone). */
function wallClockISO(dateHeader) {
  const t = new Date(dateHeader);
  if (Number.isNaN(t.getTime())) return null;
  const off = (dateHeader.match(/([+-]\d{4})\s*(?:\(|$)|([+-]\d{4})\s*$/) || [])[1]
    || (dateHeader.match(/([+-]\d{4})/) || [])[1];
  let ms = t.getTime();
  if (off) {
    const sign = off[0] === "-" ? -1 : 1;
    const offMs = sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(3, 5))) * 60000;
    ms += offMs; // shift so the UTC fields read as the original wall time
  }
  return new Date(ms).toISOString().replace("Z", "");
}

/**
 * Convert one raw RFC-822 message (string) into the compact row shape, or
 * null when it has no date or no usable text. Attachment payloads are never
 * decoded — only their filenames are collected.
 */
export function condenseOneEmail(rawMessage, userEmail) {
  const splitAt = rawMessage.search(/\r?\n\r?\n/);
  if (splitAt === -1) return null;
  const headers = parseHeaders(rawMessage.slice(0, splitAt));
  const body = rawMessage.slice(splitAt).replace(/^\r?\n\r?\n?/, "");

  if (!headers.date) return null;
  const timestamp = wallClockISO(headers.date);
  if (!timestamp) return null;

  const from = parseAddress(headers.from || "");
  const me = (userEmail || "").trim().toLowerCase();
  const fromMe = Boolean(me) && from.addr === me;

  const attachments = [];
  let text = "";

  const contentType = headers["content-type"] || "text/plain";
  const boundary = param(contentType, "boundary");
  if (boundary) {
    // Multipart: walk top-level parts; recurse one level into nested
    // multiparts (multipart/alternative inside multipart/mixed is the norm).
    const collect = (partsRaw, depth) => {
      for (const part of partsRaw) {
        const pSplit = part.search(/\r?\n\r?\n/);
        if (pSplit === -1) continue;
        const ph = parseHeaders(part.slice(0, pSplit));
        const pBody = part.slice(pSplit).replace(/^\r?\n\r?\n?/, "");
        const pType = (ph["content-type"] || "text/plain").toLowerCase();
        const fname =
          param(ph["content-disposition"] || "", "filename") ||
          param(ph["content-type"] || "", "name");
        if (fname) {
          attachments.push(decodeHeaderText(fname));
          continue; // attachment payload: never decoded
        }
        const nested = param(ph["content-type"] || "", "boundary");
        if (nested && depth < 3) {
          collect(splitParts(pBody, nested), depth + 1);
          continue;
        }
        if (pType.startsWith("text/") && !text) {
          let t = decodeBody(pBody, ph["content-transfer-encoding"], param(ph["content-type"] || "", "charset"));
          if (pType.startsWith("text/html")) t = t.replace(/<[^>]+>/g, " ");
          text = cleanEmailBody(t);
        }
      }
    };
    collect(splitParts(body, boundary), 0);
  } else {
    const cType = contentType.toLowerCase();
    if (cType.startsWith("text/") || !headers["content-type"]) {
      let t = decodeBody(body, headers["content-transfer-encoding"], param(contentType, "charset"));
      if (cType.startsWith("text/html")) t = t.replace(/<[^>]+>/g, " ");
      text = cleanEmailBody(t);
    }
  }

  const subject = decodeHeaderText(headers.subject || "").trim();
  const combined =
    subject && text ? `${subject} — ${text}` : subject || text;
  if (!combined) return null;

  let sender;
  let conversation;
  if (fromMe) {
    sender = "Me";
    const to = parseAddress(headers.to || "");
    conversation = to.name || to.addr || "Email";
  } else {
    sender = from.name || from.addr || "Unknown sender";
    conversation = sender;
  }

  return {
    timestamp,
    sender,
    body: combined.replace(/\n/g, " ").trim(),
    conversation,
    from_me: fromMe,
    channel: "email",
    attachments,
  };
}

function splitParts(body, boundary) {
  const sep = "--" + boundary;
  return body
    .split(sep)
    .slice(1) // preamble
    .filter((p) => !p.startsWith("--")) // closing marker
    .map((p) => p.replace(/^\r?\n/, ""));
}

/**
 * Stream-condense an mbox from any async iterable of Uint8Array chunks.
 * Messages are processed as their "From " boundary arrives, so memory stays
 * bounded by the largest single message, never the file.
 */
export async function condenseMboxChunks(chunks, userEmail, onProgress) {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const rows = [];
  let buffer = "";
  let bytesSeen = 0;
  let skipped = 0;

  const flushMessage = (raw) => {
    if (!raw.trim()) return;
    const row = condenseOneEmail(raw, userEmail);
    if (row) rows.push(row);
    else skipped++;
  };

  for await (const chunk of chunks) {
    bytesSeen += chunk.byteLength ?? chunk.length ?? 0;
    buffer += decoder.decode(chunk, { stream: true });

    // Extract every complete message currently in the buffer. The mbox
    // separator is a line starting with "From " (note the space).
    for (;;) {
      const isFirst = buffer.startsWith("From ");
      const next = buffer.indexOf("\nFrom ", isFirst ? 5 : 0);
      if (next === -1) break;
      const head = buffer.slice(0, next);
      buffer = buffer.slice(next + 1);
      // Drop the separator line itself from the extracted message.
      flushMessage(head.replace(/^From .*\r?\n/, ""));
    }
    if (onProgress) onProgress(bytesSeen, rows.length);
  }
  buffer += decoder.decode();
  flushMessage(buffer.replace(/^From .*\r?\n/, ""));

  rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { rows, skipped };
}

/** Browser entry point: File → compact JSON File the backend accepts. */
export async function condenseMboxFile(file, userEmail, onProgress) {
  const { rows, skipped } = await condenseMboxChunks(
    file.stream(),
    userEmail,
    onProgress,
  );
  if (rows.length === 0) {
    throw new Error(
      `"${file.name}" contained no readable emails after condensing ` +
        `(${skipped} items had no date or text).`,
    );
  }
  const json = JSON.stringify({ messages: rows });
  const name = file.name.replace(/\.mbox$/i, "") + ".condensed.json";
  return {
    file: new File([json], name, { type: "application/json" }),
    count: rows.length,
    originalBytes: file.size,
    condensedBytes: json.length,
  };
}

/** Files at or above this size get condensed in the browser before upload. */
export const CONDENSE_THRESHOLD = 4 * 1024 * 1024; // 4 MB
