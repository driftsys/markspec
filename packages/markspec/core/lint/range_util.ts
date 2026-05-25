/**
 * @module core/lint/range_util
 *
 * Shared byte-offset → file-absolute SourceRange converter used by prose-
 * analysis rules (xref, ears, and future slices). Extracted from xref.ts
 * (slice 6) to avoid duplication across rules that all need the same
 * conversion.
 */

import type { SourceRange } from "../ast/nodes.ts";

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
