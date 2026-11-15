/**
 * @module lsp/feature_code_actions
 *
 * Locator helpers for quick fixes on `.feature` files (#943). A `.feature`
 * header is a run of comment lines (`# [ID] Title`, then `# Key: value`
 * trailer lines). These pure functions find the header run and its trailer
 * block in the file lines, so a fix edits only header lines and never a
 * step or doc-string line.
 */

import { FEATURE_HEADER_START_RE, featureHeaderRunEnd } from "../core/mod.ts";

/** Leading whitespace, `#`, and the spaces or tabs after it. */
const COMMENT_PREFIX_RE = /^\s*#[ \t]*/;

/** A trailer key at the start of the comment text. */
const TRAILER_KEY_RE = /^([A-Z][A-Za-z-]*)\s*:/;

/** A half-open range of line indexes: `start` inclusive, `end` exclusive. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The comment prefix of `line` (indent, `#`, and the spaces after it), or
 * `undefined` when the line is not a comment line.
 */
export function commentPrefix(line: string): string | undefined {
  return COMMENT_PREFIX_RE.exec(line)?.[0];
}

/**
 * The trailer key of a comment line, when the comment text matches
 * `^[A-Z][A-Za-z-]*\s*:`. `undefined` for any other line.
 */
export function trailerKey(line: string): string | undefined {
  const prefix = commentPrefix(line);
  if (prefix === undefined) return undefined;
  return TRAILER_KEY_RE.exec(line.slice(prefix.length))?.[1];
}

/**
 * The header run that starts at `titleIdx`: from that line up to the
 * exclusive end given by `featureHeaderRunEnd`. `undefined` when the line is
 * not a header start (`# [ID] ...`).
 */
export function headerRun(
  lines: readonly string[],
  titleIdx: number,
): LineRange | undefined {
  const line = lines[titleIdx];
  if (line === undefined) return undefined;
  const prefix = commentPrefix(line);
  if (prefix === undefined) return undefined;
  if (!FEATURE_HEADER_START_RE.test(line.slice(prefix.length))) {
    return undefined;
  }
  return { start: titleIdx, end: featureHeaderRunEnd(lines, titleIdx) };
}

/**
 * The trailer block of the header that starts at `titleIdx`: after trailing
 * `#`-only lines of the run are skipped, the contiguous comment lines that
 * carry a trailer key. An empty block (`start === end`) sits at the end of
 * the run, after the skipped lines. `undefined` when `titleIdx` is not a
 * header start.
 */
export function trailerBlock(
  lines: readonly string[],
  titleIdx: number,
): LineRange | undefined {
  const run = headerRun(lines, titleIdx);
  if (!run) return undefined;
  let end = run.end;
  while (end > run.start + 1 && lines[end - 1].trim() === "#") end--;
  let start = end;
  while (start > run.start + 1 && trailerKey(lines[start - 1]) !== undefined) {
    start--;
  }
  return { start, end };
}
