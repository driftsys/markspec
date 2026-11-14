/**
 * @module lsp/folding
 *
 * Folding-range helper. One foldable region per entry block; each
 * region spans from the entry's title line to one line before the
 * next entry's title line (or to the document's last line for the
 * final entry).
 *
 * Entries in `.feature` files fold over their owned Gherkin node (the
 * Feature or Scenario the `#` header sits above), not up to the next entry.
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
 * 1-based last line of the Gherkin node a `.feature` entry owns, or
 * `undefined` for any other entry (or when the entry carries no feature
 * node). A Feature entry then folds over its Scenarios, which the generic
 * "to the next entry" range would cut at the first nested header. The node
 * range is relative to the entry's body start line.
 */
function ownedNodeEndLine(entry: Entry): number | undefined {
  if (entry.source.kind !== "feature-file") return undefined;
  // The owned node is the last body block; a fenced Gherkin example in the
  // header prose comes before it.
  const node = entry.bodyAst?.findLast((b) => b.kind === "feature");
  if (!node) return undefined;
  const bodyStart = entry.bodyStartLine ?? entry.location.line + 1;
  return bodyStart + node.range.end.line - 1;
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
    const end = ownedNodeEndLine(sorted[i]) ?? nextStart - 1;
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
