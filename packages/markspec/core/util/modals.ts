/**
 * @module core/util/modals
 *
 * RFC 2119 and EARS modal-keyword helpers shared by `formatter/mod.ts`
 * and `ast/normalize.ts`. Extracted to `core/util/` to avoid a dep cycle:
 * `ast/` is a dependency of `formatter/`, so `formatter → ast` is OK but
 * `ast → formatter` is not.
 */

import { parseCodeRegions } from "../parser/code_regions.ts";
import { walkProseLines } from "./fence.ts";

/**
 * RFC 2119 modal keywords in uppercase form, with optional ` NOT` suffix.
 * Captured for canonical-form normalisation per spec §3.4.1: uppercase
 * input is accepted but emitted lowercase, unconditionally.
 */
export const RFC2119_MODAL_RE = /\b(SHALL|SHOULD|MAY|MUST)(\s+NOT)?\b/g;

/**
 * EARS keywords subject to the sentence-initial rule of spec §3.4.1:
 * lowercased when mid-sentence, preserved when starting a sentence.
 * `If…then` is deferred to a later slice because its multi-token form
 * needs separate handling.
 */
export const EARS_KEYWORD_RE = /\b(When|While|Where|Unless)\b/g;

/**
 * Decide whether the EARS keyword at `offset` in `line` is at sentence
 * start (return value true). Walks left over whitespace and reports true
 * when it hits the beginning of the line or a sentence-terminating
 * punctuation character (`.`, `!`, `?`).
 */
export function isSentenceInitial(line: string, offset: number): boolean {
  if (offset === 0) return true;
  let i = offset - 1;
  while (i >= 0 && (line[i] === " " || line[i] === "\t")) i--;
  if (i < 0) return true;
  const prev = line[i];
  return prev === "." || prev === "!" || prev === "?";
}

/**
 * Normalize modal keywords in prose while preserving CommonMark fenced and
 * inline code. Four-space and tab-indented lines remain verbatim as before.
 * The document is parsed once; both code exclusions use that same AST.
 */
export function normalizeProseModals(text: string): string {
  const { fencedLines, inlineCode } = parseCodeRegions(text);
  const lines = text.split("\n");
  let lineOffset = 0;
  let rangeIndex = 0;
  // Record offsets before walking: the callback skips fenced lines.
  const offsets = lines.map((line) => {
    const offset = lineOffset;
    lineOffset += line.length + 1;
    return offset;
  });
  walkProseLines(text, (line, i) => {
    if (/^( {4}|\t)/.test(line)) return;
    const start = offsets[i];
    while (
      rangeIndex < inlineCode.length && inlineCode[rangeIndex].end <= start
    ) rangeIndex++;
    const protectedRanges: { start: number; end: number }[] = [];
    for (
      let j = rangeIndex;
      j < inlineCode.length && inlineCode[j].start < start + line.length;
      j++
    ) {
      protectedRanges.push(inlineCode[j]);
    }
    const isCode = (offset: number, length: number): boolean =>
      protectedRanges.some((range) =>
        range.start < start + offset + length && range.end > start + offset
      );
    let normalized = line.replace(
      RFC2119_MODAL_RE,
      (match, _keyword, _not, offset: number) =>
        isCode(offset, match.length) ? match : match.toLowerCase(),
    );
    normalized = normalized.replace(
      EARS_KEYWORD_RE,
      (match, _keyword, offset: number) =>
        isCode(offset, match.length) || isSentenceInitial(normalized, offset)
          ? match
          : match.toLowerCase(),
    );
    lines[i] = normalized;
  }, fencedLines);
  return lines.join("\n");
}
