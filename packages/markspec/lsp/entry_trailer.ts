/**
 * @module lsp/entry_trailer
 *
 * Scan an entry's trailer block in document text. Returns one
 * `TrailerLine` per attribute line, with the key range, value
 * range, and any embedded display-ID ranges. Shared by both the
 * semantic-tokens builder and the entry-ranges builder.
 *
 * The scanner walks document lines starting at the entry's
 * 1-based start line. It identifies trailer lines (≥4 leading
 * spaces, `Key:` pattern) and stops when it hits the next entry's
 * title line or when `endLineExclusive` is reached.
 *
 * Returned column offsets are 0-based character indices into the
 * source line, suitable for direct use as LSP positions.
 */

import type { Entry } from "../core/model/mod.ts";

/** A single attribute line in an entry's trailer block. */
export interface TrailerLine {
  /** 0-based line index in the document. */
  readonly lineIndex: number;
  /** Attribute key, e.g. `"Id"`, `"Satisfies"`. */
  readonly key: string;
  /** 0-based column where the key starts. */
  readonly keyStart: number;
  /** Length of the key in characters. */
  readonly keyLength: number;
  /** 0-based column where the value starts (after `:` and any leading whitespace). */
  readonly valueStart: number;
  /** Length of the value in characters. */
  readonly valueLength: number;
  /** Display-ID sub-ranges discovered inside the value (whole-token matches). */
  readonly idRanges: readonly { start: number; length: number }[];
}

/** Trailer-line pattern: ≥4 leading spaces, capital-letter Key, optional `-`, colon. */
const TRAILER_LINE_RE = /^(\s{4,})([A-Z][A-Za-z-]*)\s*:\s*(.*)$/;

/**
 * Fenced code-block delimiter — opens or closes a fence of `\`\`\`` or
 * `~~~` (CommonMark allows three or more, with the closer matching the
 * opener's length and character class). Used to suppress trailer-line
 * classification for lines inside any fenced code block — an indented
 * `Key:` line inside, say, a YAML or feature fence is content, not an
 * entry attribute.
 */
const FENCE_DELIM_RE = /^\s*(`{3,}|~{3,})/;

/**
 * Display-ID token pattern. Mirrors the grammar in `hover.ts` /
 * `rename.ts`: letters, digits, `._/-`, ≥3 chars, alphanumeric start.
 * `\b` cannot be used because `.` and `/` are not word characters, so
 * boundaries are enforced by explicit `ID_CHAR_RE` checks at the match
 * edges (same approach as `rename.ts`).
 */
const DISPLAY_ID_RE = /[A-Za-z0-9][A-Za-z0-9._/-]{2,}/g;

/** Display-ID character set — letters, digits, dot, slash, hyphen, underscore. */
const ID_CHAR_RE = /[A-Za-z0-9._/-]/;

/**
 * Walk the trailer of `entry` in `lines` and return per-line info.
 *
 * @param entry The parsed entry whose trailer is to be scanned.
 * @param lines Document text split on `\n`.
 * @param endLineExclusive 0-based stop line. Pass the next entry's start line
 *   (0-based) or `lines.length` for the last entry.
 */
export function scanEntryTrailer(
  entry: Entry,
  lines: readonly string[],
  endLineExclusive: number,
): TrailerLine[] {
  const out: TrailerLine[] = [];
  const startIndex = entry.location.line - 1;
  let insideFence = false;
  for (let i = startIndex; i < endLineExclusive && i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_DELIM_RE.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    const m = TRAILER_LINE_RE.exec(line);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2];
    const colonIndex = line.indexOf(":", indent + key.length);
    if (colonIndex < 0) continue;
    let valueStart = colonIndex + 1;
    while (line[valueStart] === " " || line[valueStart] === "\t") {
      valueStart += 1;
    }
    // Trim trailing whitespace so the reported value length doesn't
    // run past the last printable character. Otherwise the entry-
    // ranges dim region and the semantic-token `string` span would
    // both extend over invisible spaces past EOL.
    let valueEnd = line.length;
    while (
      valueEnd > valueStart &&
      (line[valueEnd - 1] === " " || line[valueEnd - 1] === "\t")
    ) {
      valueEnd -= 1;
    }
    const valueLength = valueEnd - valueStart;
    const valueText = line.slice(valueStart, valueEnd);
    const idRanges: { start: number; length: number }[] = [];
    // Note: this matches purely by shape — any 3+ char alphanumeric
    // token is reported as an ID range, even in free-form values
    // like `Note: foobar`. Consumers needing key-aware semantics
    // (only treat as IDs when the key is a trace attribute) must
    // filter on tl.key themselves. Pre-existing limitation also
    // present in hover.ts and rename.ts.
    DISPLAY_ID_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DISPLAY_ID_RE.exec(valueText)) !== null) {
      const before = match.index === 0 ? "" : valueText[match.index - 1];
      const afterIdx = match.index + match[0].length;
      const after = afterIdx >= valueText.length ? "" : valueText[afterIdx];
      const boundedLeft = before === "" || !ID_CHAR_RE.test(before);
      const boundedRight = after === "" || !ID_CHAR_RE.test(after);
      if (!boundedLeft || !boundedRight) continue;
      idRanges.push({
        start: valueStart + match.index,
        length: match[0].length,
      });
    }
    out.push({
      lineIndex: i,
      key,
      keyStart: indent,
      keyLength: key.length,
      valueStart,
      valueLength,
      idRanges,
    });
  }
  return out;
}
