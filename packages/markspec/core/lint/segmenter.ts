/**
 * @module core/lint/segmenter
 *
 * Rule-based sentence segmenter for prose-analysis rules
 * (markspec-prose-analysis §5.2). Splits on `.`/`?`/`!` followed by
 * whitespace + an uppercase character, honoring an abbreviation
 * lexicon. Deterministic; no I/O.
 *
 * ADR-021 Decision 3 pins the rule-based approach: Intl.Segmenter
 * drift across V8 versions silently breaks snapshot tests, and
 * external NLP libraries add non-deterministic dependencies. Reach
 * for the prose.lexicons.sentence-abbrev lexicon to extend coverage,
 * not for a smarter algorithm.
 */

export interface Sentence {
  /** Sentence text including terminal punctuation. */
  readonly text: string;
  /** Byte offset of the sentence's first character in the source text. */
  readonly offset: number;
}

/**
 * Walk `text` once, accumulating characters into the current sentence
 * until a terminator (`.`/`?`/`!`) followed by whitespace + uppercase
 * is observed. The terminator is included in the sentence; the
 * whitespace begins the next sentence's leading skip.
 *
 * Abbreviation guard: when the terminator is `.` and the token that
 * just ended (including the `.`) is a member of `abbrevs`, the
 * terminator is treated as an in-word period and does not split.
 */
export function segmentSentences(
  text: string,
  abbrevs: ReadonlySet<string>,
): Sentence[] {
  if (text.length === 0) return [];
  const out: Sentence[] = [];
  let start = 0;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    const isTerminator = ch === "." || ch === "?" || ch === "!";
    if (!isTerminator) {
      i++;
      continue;
    }

    // Look ahead for whitespace + uppercase.
    let j = i + 1;
    while (j < n && /\s/.test(text[j])) j++;
    const next = j < n ? text[j] : "";
    const isUpperNext = next >= "A" && next <= "Z";

    if (!isUpperNext) {
      i++;
      continue;
    }

    // Abbreviation guard — only `.` can be in an abbreviation token.
    if (ch === ".") {
      const tokStart = findTokenStart(text, i);
      const tok = text.slice(tokStart, i + 1);
      if (abbrevs.has(tok)) {
        i++;
        continue;
      }
    }

    // Split here. Sentence is [start, i+1).
    out.push({
      text: text.slice(start, i + 1),
      offset: start,
    });
    start = j;
    i = j;
  }

  // Tail
  if (start < n) {
    out.push({ text: text.slice(start, n), offset: start });
  }

  return out;
}

/** Walk back from `idx` until whitespace or string start; return the
 * index of the first character of that token. */
function findTokenStart(text: string, idx: number): number {
  let k = idx;
  while (k > 0 && !/\s/.test(text[k - 1])) k--;
  return k;
}
