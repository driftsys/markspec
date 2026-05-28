/**
 * @module lsp/find_entry
 *
 * Cursor-to-entry mapping. Given the cursor's 1-based file line and
 * the parsed entries in that file, return the entry that "contains"
 * the cursor — defined as the entry whose start line is the greatest
 * one less than or equal to the cursor line.
 *
 * This matches the LSP's needs: when the author is typing on a
 * trailer line several lines below the entry's title, that line is
 * still part of the enclosing entry's block.
 */

import type { Entry } from "../core/mod.ts";

/**
 * Return the entry whose declared block contains `cursorLine`, or
 * `undefined` when no entry has started yet (cursor is above the
 * first entry's title line, or the file has no entries).
 *
 * The block of entry `i` is treated as `[entry[i].line, entry[i+1].line)`
 * — i.e. an entry "owns" lines from its title down to the line
 * before the next entry's title (or to end-of-file). This is the
 * same heuristic the folding-range helper uses.
 *
 * @param entries Parsed entries from a single file. Order is not
 *   required.
 * @param cursorLine 1-based file line, matching
 *   {@linkcode Entry.location.line}'s convention.
 */
export function findEnclosingEntry(
  entries: readonly Entry[],
  cursorLine: number,
): Entry | undefined {
  if (entries.length === 0) return undefined;
  // Walk in sorted-by-start-line order without mutating the caller's
  // array — typical entry counts per file are small, sort is cheap.
  const sorted = [...entries].sort(
    (a, b) => a.location.line - b.location.line,
  );
  let chosen: Entry | undefined;
  for (const entry of sorted) {
    if (entry.location.line > cursorLine) break;
    chosen = entry;
  }
  return chosen;
}
