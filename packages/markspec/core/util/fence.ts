/**
 * @module core/util/fence
 *
 * Prose-line helpers using fenced-code boundaries from the CommonMark AST.
 * Containers, matching delimiters and implicit container endings are handled
 * by remark. Indented code is not fenced code: MarkSpec trailers must remain
 * available to reference and validation passes.
 */
import { parseCodeRegions } from "../parser/code_regions.ts";

/**
 * Legacy fence-prefix candidate used by the LSP source-file scanner.
 * Markdown fence membership uses the AST-backed helpers below.
 */
export const FENCE_RE = /^\s*(```|~~~)/;

const FENCE_CACHE_CAPACITY = 64;
const fencedLineCache = new Map<string, ReadonlySet<number>>();

/**
 * Compute zero-based fenced-code lines, including opening and closing lines.
 * Cache the sets for the 64 most recently queried exact document texts. Each
 * call returns a new copy, so a caller that changes it cannot alter the cache.
 * Callers making multiple membership queries should compute this set once and
 * pass it to {@linkcode isLineFenced} or {@linkcode walkProseLines}.
 */
export function fencedCodeLines(body: string): ReadonlySet<number> {
  const cached = fencedLineCache.get(body);
  if (cached !== undefined) {
    fencedLineCache.delete(body);
    fencedLineCache.set(body, cached);
    return new Set(cached);
  }
  const lines = parseCodeRegions(body).fencedLines;
  fencedLineCache.set(body, lines);
  if (fencedLineCache.size > FENCE_CACHE_CAPACITY) {
    fencedLineCache.delete(fencedLineCache.keys().next().value!);
  }
  return new Set(lines);
}

/**
 * Callback for {@linkcode walkProseLines}. Receives a line and its 0-based index.
 * The LF delimiter is excluded; a CR from a CRLF delimiter is preserved.
 */
export type ProseLineCallback = (line: string, index: number) => void;

/**
 * Walk lines outside fenced code, using the cached CommonMark line set unless
 * a precomputed set for this exact text is supplied. Indented code is yielded.
 */
export function walkProseLines(
  body: string,
  cb: ProseLineCallback,
  fencedLines: ReadonlySet<number> = fencedCodeLines(body),
): void {
  body.split("\n").forEach((line, index) => {
    if (!fencedLines.has(index)) cb(line, index);
  });
}

/**
 * Return whether a zero-based document line belongs to the fenced-line set.
 * Supply the set for this exact text when querying multiple positions.
 */
export function isLineFenced(
  body: string,
  lineIndex: number,
  fencedLines: ReadonlySet<number> = fencedCodeLines(body),
): boolean {
  return fencedLines.has(lineIndex);
}
