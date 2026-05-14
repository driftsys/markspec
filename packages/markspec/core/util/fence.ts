/**
 * @module core/util/fence
 *
 * Prose-line walker that skips lines inside fenced code blocks.
 * Several validator and formatter passes (body-block exclusions,
 * caption adjacency, `$Identifier` extraction, modal-keyword
 * normalisation) all needed to walk an entry body line-by-line while
 * treating fenced code as verbatim. This helper centralises that
 * pattern so the fence-toggle semantics stay consistent.
 *
 * Fence detection follows CommonMark §4.5 — a line whose first
 * non-whitespace content is three or more backticks or tildes opens
 * (or closes) a fenced block. The language tag that may follow the
 * opening fence does not affect detection: we toggle on every fence
 * marker regardless. (Mismatched marker types — ``` opener / ~~~
 * closer — are accepted by the walker because real Markdown parsers
 * already reject those upstream.)
 */

/** Three or more backticks or tildes at the start of a line. */
export const FENCE_RE = /^\s*(```|~~~)/;

/** Callback for {@linkcode walkProseLines}. Receives one line + its 0-based index. */
export type ProseLineCallback = (line: string, index: number) => void;

/**
 * Walk `body` line by line, invoking `cb` for every line that's NOT
 * inside a fenced code block. The first fence marker opens the block;
 * the next closes it. The fence-marker lines themselves are also
 * skipped (they're structural, not prose).
 */
export function walkProseLines(body: string, cb: ProseLineCallback): void {
  const lines = body.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    cb(line, i);
  }
}
