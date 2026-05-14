/**
 * @module lsp/folding
 *
 * Folding-range helper. One foldable region per entry block; each
 * region spans from the entry's title line to one line before the
 * next entry's title line (or to the document's last line for the
 * final entry).
 *
 * Single-line regions (start == end) are dropped because folding a
 * one-line block does nothing useful and just clutters the gutter.
 *
 * This is a heuristic — it doesn't try to track the precise
 * trailer-block end line. A future iteration can tighten the end
 * line once the parser surfaces per-entry end positions.
 */

import type { Entry } from "../core/model/mod.ts";

/** A subset of the LSP `FoldingRange` interface. */
export interface FoldingRange {
  readonly startLine: number;
  readonly endLine: number;
  readonly kind?: string;
}

/**
 * Convert a file's entries to FoldingRanges. `totalLines` is the
 * 1-based count of lines in the document (used to bound the last
 * entry's fold range).
 */
export function entriesToFoldingRanges(
  entries: readonly Entry[],
  totalLines: number,
): FoldingRange[] {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort(
    (a, b) => a.location.line - b.location.line,
  );
  const ranges: FoldingRange[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i].location.line;
    const nextStart = i + 1 < sorted.length
      ? sorted[i + 1].location.line
      : totalLines + 1;
    const end = nextStart - 1;
    // LSP uses 0-based lines; convert and skip single-line regions.
    if (end <= start) continue;
    ranges.push({
      startLine: start - 1,
      endLine: end - 1,
      kind: "region",
    });
  }
  return ranges;
}
