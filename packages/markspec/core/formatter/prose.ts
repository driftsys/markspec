/**
 * @module formatter/prose
 *
 * ADR-029 whole-document Markdown pass: splits a document's lines into
 * prose / entry-block segments and routes each prose segment through
 * the injected {@linkcode ProseFormatter} (dprint-markdown). Every
 * rewritten segment must pass {@linkcode markdownSemanticallyEquivalent}
 * against its original — a rejected segment is kept byte-identical and
 * reported via `fallbacks` (with its reason) so `format()` can emit an
 * advisory diagnostic ("never make a file worse").
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

/**
 * Why a prose segment kept its original text instead of the formatted
 * output: the dprint formatter threw (`"error"`), or its output failed the
 * CommonMark-semantic gate (`"non-equivalent"`). Threaded so `format()`
 * can emit an accurate MSL-F012 cause per segment rather than collapsing
 * both into one message.
 */
export interface ProseFallback {
  readonly line: number;
  readonly reason: "error" | "non-equivalent";
}

/** Result of {@linkcode formatProseSegments}. */
export interface ProsePassResult {
  readonly lines: string[];
  readonly changed: boolean;
  /** One entry per prose segment that fell back to its original text,
   * with the 0-based first line and the reason. */
  readonly fallbacks: readonly ProseFallback[];
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
  const fallbacks: ProseFallback[] = [];
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
    let formatted: string;
    try {
      formatted = proseFormat(chunk).replace(/\n$/, "");
    } catch {
      // The dprint WASM formatter can throw on a pathological fragment.
      // Treat a throw exactly like a rejected rewrite: keep the original
      // segment and report the fallback (never crash the whole run).
      fallbacks.push({ line: gapStart + from, reason: "error" });
      out.push(...segment);
      return;
    }
    if (formatted === chunk) {
      out.push(...segment);
      return;
    }
    if (!markdownSemanticallyEquivalent(chunk, formatted)) {
      fallbacks.push({ line: gapStart + from, reason: "non-equivalent" });
      out.push(...segment);
      return;
    }
    changed = true;
    out.push(...segment.slice(0, from));
    out.push(...formatted.split("\n"));
    out.push(...segment.slice(to));
  };

  for (const extent of extents) {
    // Defensive clamp: extents from a healthy parse are disjoint and
    // well-formed, but this module is the last guard between entry
    // blocks and the prose formatter — never re-emit lines already
    // written (overlap/duplicate extents) and treat end < start as
    // zero-width instead of walking the cursor backwards.
    const start = Math.max(extent.start, cursor);
    const end = Math.max(extent.end, start);
    if (start > cursor) flushProse(cursor, start);
    out.push(...lines.slice(start, end));
    cursor = end;
  }
  if (cursor < lines.length) flushProse(cursor, lines.length);

  return { lines: out, changed, fallbacks };
}
