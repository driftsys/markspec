/**
 * @module formatter/prose
 *
 * ADR-029 whole-document Markdown pass: splits a document's lines into
 * prose / entry-block segments and routes each prose segment through
 * the injected {@linkcode ProseFormatter} (dprint-markdown). Every
 * rewritten segment must pass {@linkcode markdownSemanticallyEquivalent}
 * against its original — a rejected segment is kept byte-identical and
 * reported via `fallbackStarts` so `format()` can emit an advisory
 * diagnostic ("never make a file worse").
 *
 * Entry blocks (title line → item end, trailers included) are never
 * given to dprint here; entry BODIES are polished separately inside
 * `emitBodyViaAst` (core/formatter/mod.ts) where the parser's
 * dedent/re-indent machinery and the body-AST gate already live.
 */

import type { ProseFormatter } from "./dprint.ts";
import { markdownSemanticallyEquivalent } from "./md_equiv.ts";

/** 0-based `[start, end)` line span of one entry block. */
export interface EntryExtent {
  readonly start: number;
  readonly end: number;
}

/** Result of {@linkcode formatProseSegments}. */
export interface ProsePassResult {
  readonly lines: string[];
  readonly changed: boolean;
  /** 0-based first line of each prose segment the gate rejected. */
  readonly fallbackStarts: readonly number[];
}

/**
 * Format every prose gap between entry extents. Boundary blank lines
 * stay outside the formatted chunk so entry-block separation is never
 * disturbed.
 */
export function formatProseSegments(
  lines: readonly string[],
  entryExtents: readonly EntryExtent[],
  proseFormat: ProseFormatter,
): ProsePassResult {
  const extents = [...entryExtents].sort((a, b) => a.start - b.start);
  const out: string[] = [];
  const fallbackStarts: number[] = [];
  let changed = false;
  let cursor = 0;

  const flushProse = (gapStart: number, gapEnd: number): void => {
    const segment = lines.slice(gapStart, gapEnd);
    // Keep boundary blank lines verbatim, format only the core.
    let from = 0;
    while (from < segment.length && segment[from].trim() === "") from++;
    let to = segment.length;
    while (to > from && segment[to - 1].trim() === "") to--;
    if (from >= to) {
      out.push(...segment);
      return;
    }
    const chunk = segment.slice(from, to).join("\n");
    const formatted = proseFormat(chunk).replace(/\n$/, "");
    if (formatted === chunk) {
      out.push(...segment);
      return;
    }
    if (!markdownSemanticallyEquivalent(chunk, formatted)) {
      fallbackStarts.push(gapStart + from);
      out.push(...segment);
      return;
    }
    changed = true;
    out.push(...segment.slice(0, from));
    out.push(...formatted.split("\n"));
    out.push(...segment.slice(to));
  };

  for (const extent of extents) {
    if (extent.start > cursor) flushProse(cursor, extent.start);
    out.push(...lines.slice(extent.start, extent.end));
    cursor = extent.end;
  }
  if (cursor < lines.length) flushProse(cursor, lines.length);

  return { lines: out, changed, fallbackStarts };
}
