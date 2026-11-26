/**
 * @module core/util/modals
 *
 * RFC 2119 and EARS modal-keyword helpers shared by `formatter/mod.ts`
 * and `ast/normalize.ts`. Extracted to `core/util/` to avoid a dep cycle:
 * `ast/` is a dependency of `formatter/`, so `formatter → ast` is OK but
 * `ast → formatter` is not.
 */

import type { Root, RootContent } from "mdast";
import { nonProseRanges, parseCodeRegions } from "../parser/code_regions.ts";
import { processor } from "../parser/remark.ts";
import { walkProseLines } from "./fence.ts";

/**
 * RFC 2119 modal keywords in uppercase form, with optional ` NOT` suffix.
 * Captured for canonical-form normalisation per spec §3.4.1: uppercase
 * input is accepted but emitted lowercase. This is the pattern of the default
 * (`lower`) mode; the `rfc8174` mode uses {@linkcode RFC8174_ENFORCED_RE}.
 */
export const RFC2119_MODAL_RE = /\b(SHALL|SHOULD|MAY|MUST)(\s+NOT)?\b/g;

/**
 * The `shall` and `must` keywords in any casing, with an optional following
 * `not`. The `rfc8174` casing value uppercases exactly these; `may`,
 * `should` and `will` are often plain English and are left as written. A
 * keyword joined to a hyphen or a word character on either side (`must-have`,
 * `well-must`, `mustard`) is not matched.
 *
 * The gap between the keyword and `not` is spaces and tabs, or at most one
 * line break with any spaces and tabs around it, so a `not` that starts the
 * next line of the same paragraph is matched and a blank line is never
 * crossed. Group 1 is the keyword, group 2 the gap and group 3 the `not`.
 */
export const RFC8174_ENFORCED_RE =
  /(?<![-\w])(shall|must)(?:([ \t]*\r?\n[ \t]*|[ \t]+)(not))?(?![-\w])/gi;

/**
 * Every RFC 2119 modal word and every EARS keyword, in lowercase. A word
 * matches in any casing. Used by checks that must treat these words as
 * keywords whatever `modal-keywords.casing` says (MSL-Q500).
 */
export const KEYWORD_WORDS: ReadonlySet<string> = new Set([
  "shall",
  "should",
  "may",
  "must",
  "will",
  "not",
  "when",
  "while",
  "where",
  "unless",
  "if",
  "then",
]);

/** How {@linkcode normalizeProseModals} rewrites keyword casing. */
export type ModalCasingMode = "lower" | "rfc8174";

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
 * inline code, link destinations, titles and labels, autolinks, images (path
 * and alt text), link reference definitions, footnote labels, HTML tags and
 * HTML blocks (#1009). The visible text of a `[text](url)` or `[text][label]`
 * link is prose and is normalized. A keyword on a four-space or tab-indented
 * line remains verbatim as before. The document is parsed once; every
 * exclusion uses that same AST.
 *
 * `mode` is `"lower"` (the §3.4.1 rule: lowercase the uppercase RFC 2119
 * keywords `SHALL`, `SHOULD`, `MAY` and `MUST`, and the EARS keywords `When`,
 * `While`, `Where` and `Unless` unless they start a sentence; `WILL`, `If`
 * and `Then` are not rewritten) or `"rfc8174"` (uppercase `shall` and `must`
 * plus a following `not`, including a `not` that starts the next line of the
 * same paragraph, at any indentation, and change no other keyword). A `not`
 * that starts another block of the text (a paragraph, a list item, or the
 * line after a heading) is not uppercased.
 *
 * `definitions` is the text of link reference and footnote definitions that
 * `text` can use but does not hold, such as the definitions of an entry body
 * when `text` is one paragraph of it. It is parsed after `text`, so a label
 * that one of these definitions defines is kept, but it is never changed or
 * returned (#1014).
 */
export function normalizeProseModals(
  text: string,
  mode: ModalCasingMode = "lower",
  definitions = "",
): string {
  const source = definitions === "" ? text : `${text}\n\n${definitions}`;
  const tree = processor.parse(source);
  const { fencedLines } = parseCodeRegions(source, tree);
  const verbatimRanges = nonProseRanges(source, tree);
  if (mode === "rfc8174") {
    return uppercaseRfc8174(
      text,
      fencedLines,
      verbatimRanges,
      inlineBlockRanges(tree),
    );
  }
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
      rangeIndex < verbatimRanges.length &&
      verbatimRanges[rangeIndex].end <= start
    ) rangeIndex++;
    const protectedRanges: { start: number; end: number }[] = [];
    for (
      let j = rangeIndex;
      j < verbatimRanges.length &&
      verbatimRanges[j].start < start + line.length;
      j++
    ) {
      protectedRanges.push(verbatimRanges[j]);
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

/**
 * The `rfc8174` rewrite of {@linkcode normalizeProseModals}. Matches
 * {@linkcode RFC8174_ENFORCED_RE} on the whole text, so a `not` on the next
 * line of the same paragraph needs no state between lines. A match is kept as
 * written when its keyword is on a fenced line or on a line indented by four
 * or more spaces (or a tab), or when any part of the match overlaps inline
 * code or another verbatim range (`nonProseRanges`: inline code and link
 * syntax). Otherwise only the keyword and the `not` letters are uppercased;
 * the gap between them is kept exactly. A `not` after a line break is
 * uppercased only when it lies in the same paragraph or heading
 * (`blockRanges`) as the keyword; otherwise only the keyword is uppercased.
 * A table is cased one cell at a time by `ast/normalize.ts`, so a cell never
 * holds a line break.
 */
function uppercaseRfc8174(
  text: string,
  fencedLines: ReadonlySet<number>,
  verbatimRanges: readonly { start: number; end: number }[],
  blockRanges: readonly { start: number; end: number }[],
): string {
  return text.replace(
    RFC8174_ENFORCED_RE,
    (
      match,
      keyword: string,
      gap: string | undefined,
      not: string | undefined,
      offset: number,
    ) => {
      const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
      const lineIndex = text.slice(0, lineStart).split("\n").length - 1;
      if (
        fencedLines.has(lineIndex) ||
        /^( {4}|\t)/.test(text.slice(lineStart, lineStart + 4))
      ) return match;
      const end = offset + match.length;
      if (verbatimRanges.some((r) => r.start < end && r.end > offset)) {
        return match;
      }
      if (not === undefined) return keyword.toUpperCase();
      const notStart = end - not.length;
      const sameBlock = !gap!.includes("\n") ||
        blockRanges.some((r) => r.start <= offset && notStart < r.end);
      return keyword.toUpperCase() + gap! +
        (sameBlock ? not.toUpperCase() : not);
    },
  );
}

/** Node types whose text is one run of inline content. */
const INLINE_BLOCK_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
]);

/**
 * Half-open source offsets of every paragraph and heading in
 * `tree`, at any depth (inside list items and blockquotes too).
 */
function inlineBlockRanges(tree: Root): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const visit = (node: Root | RootContent): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (
      INLINE_BLOCK_TYPES.has(node.type) && start !== undefined &&
      end !== undefined
    ) {
      ranges.push({ start, end });
      return;
    }
    if ("children" in node) {
      for (const child of node.children) visit(child as RootContent);
    }
  };
  visit(tree);
  return ranges;
}
