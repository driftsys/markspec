/**
 * @module core/lint/range_util
 *
 * Helpers shared by the prose-analysis rules: the byte-offset →
 * file-absolute SourceRange converter, extracted from xref.ts (slice 6), and
 * `maskNonProse`, which blanks inline code and link syntax before a rule
 * scans a paragraph (#1029).
 */

import type { SourceRange } from "../ast/nodes.ts";
import { nonProseRanges } from "../parser/code_regions.ts";

/**
 * Compute byte-offset → file-absolute (line, column) for a prose span whose
 * text begins at `baseLine`, `baseCol`. Newlines in the text advance the
 * line counter; the column resets to 1 after each newline.
 *
 * Returns a file-absolute {@linkcode SourceRange} suitable for
 * `LintDiagnostic.range` (1-based, file-absolute — per slice 3 contract).
 *
 * @param text      Full text of the prose region (paragraph or sentence).
 * @param offset    Byte offset of the span's first character in `text`.
 * @param length    Byte length of the span.
 * @param baseLine  1-based file-absolute line where `text` begins.
 * @param baseCol   1-based column where `text` begins on `baseLine`.
 */
export function offsetToRange(
  text: string,
  offset: number,
  length: number,
  baseLine: number,
  baseCol: number,
): SourceRange {
  let line = baseLine;
  let col = baseCol;
  for (let i = 0; i < offset; i++) {
    if (text[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  const startLine = line;
  const startCol = col;
  for (let i = offset; i < offset + length; i++) {
    if (text[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return {
    start: { line: startLine, column: startCol },
    end: { line, column: col },
  };
}

/**
 * Replace every character of the non-prose ranges of `text` (inline code
 * and link syntax, see `nonProseRanges`) with a space, keeping all offsets
 * and every `\n`. The prose rules scan the result, so a modal keyword or
 * phrase that `fmt` keeps unchanged is not counted, and the ranges they
 * report stay valid for `text` (#1017, #1029). `definitions` holds the
 * body's link reference and footnote definitions, so a label defined in
 * another block is a range too (#1014).
 */
export function maskNonProse(text: string, definitions = ""): string {
  const ranges = nonProseRanges(text, undefined, definitions);
  if (ranges.length === 0) return text;
  // Offsets are UTF-16 code units; index the string, not code points.
  let out = "";
  let pos = 0;
  for (const { start, end } of ranges) {
    if (end <= pos) continue;
    const from = Math.max(start, pos);
    out += text.slice(pos, from) + text.slice(from, end).replace(/[^\n]/g, " ");
    pos = end;
  }
  return out + text.slice(pos);
}
