/**
 * @module lsp/locators
 *
 * Finds the scenario locators on a trailer line (ADR-037). A display ID
 * inside a closed locator, as in `Verifies: REQ_1 [Scenario REQ_2]`, is
 * scenario text and not a reference (#915). Hover, go-to-definition, find
 * references, document highlights, rename and semantic tokens share these
 * helpers.
 * Hover, go-to-definition, document highlights, rename and semantic tokens
 * use them. Find references does not: `references.ts` reads parsed
 * attributes through core `referenceTokens`.
 *
 * The gate keys on the relation, not the indent: a line is a locator line
 * when, after an optional doc-comment marker and any whitespace (none at all
 * for a git-style trailer), it starts with `Key:` and the key is a trace
 * attribute key (core `TRACE_ATTRIBUTE_KEYS`: every core relation plus the
 * generated `Verified-by`). The key set is the one `core/refs` rename-heal
 * and `referenceTokens` use. Other lines, including prose lines, have no
 * locators.
 *
 * Differences from the `core/refs` rename-heal scanner, which rewrites
 * trace values in Markdown text:
 * - rename-heal reads only trailer lines with at least 4 spaces of indent
 *   and skips every other line, so it leaves a 1-3 space or unindented
 *   trailer alone entirely; this gate also accepts those lines;
 * - rename-heal has no comment-marker handling, so a `///`, `*` or `#`
 *   line is not a trailer line for it; this gate accepts the marker;
 * - rename-heal reads a locator with `+` (at least one character) after one
 *   whitespace character; this gate accepts an empty `[]` and one or more
 *   whitespace characters.
 */

import { TRACE_ATTRIBUTE_KEYS } from "../core/mod.ts";

/** Optional doc-comment marker, any whitespace, then the `Key:` of a line. */
const TRAILER_KEY_RE = /^(?:\s*(?:\/\/[/!]?|\*|#))?\s*([A-Z][A-Za-z-]*)\s*:/;

/** A `.feature` header trailer line: `#`, optional spaces, then `Key:`. */
const FEATURE_TRAILER_KEY_RE = /^\s*#\s*([A-Z][A-Za-z-]*)\s*:/;

/**
 * A closed bracket locator after a target: whitespace, `[`, text with the
 * escapes `\]` and `\\`, then `]`. The target is a character that is neither
 * whitespace nor a comma, so `Satisfies: [REQ_1]` and `A, [B]` have no
 * locator, as in `core/refs/split.ts` (`LOCATOR_VALUE_RE`, which uses
 * `\S+` for the target and splits on commas first).
 */
const LOCATOR_SPAN_RE = /(?<=[^\s,])\s+\[(?:\\[\s\S]|[^\]\\])*\]/g;

/**
 * `[start, end)` column spans of the closed locators on `line`; empty when
 * the line is not a trailer line of a relation that accepts a locator. Set
 * `featureFile` for a `.feature` file, whose trailers are `# Key: value`
 * comment lines.
 */
export function locatorSpans(
  line: string,
  featureFile = false,
): Array<[number, number]> {
  const gate = (featureFile ? FEATURE_TRAILER_KEY_RE : TRAILER_KEY_RE)
    .exec(line);
  if (!gate || !TRACE_ATTRIBUTE_KEYS.has(gate[1])) return [];
  const valueStart = gate[0].length;
  return [...line.slice(valueStart).matchAll(LOCATOR_SPAN_RE)].map((
    m,
  ) => [valueStart + m.index!, valueStart + m.index! + m[0].length]);
}

/** `true` when `column` lies inside a closed locator of the trailer `line`. */
export function isInsideLocator(
  line: string,
  column: number,
  featureFile = false,
): boolean {
  return locatorSpans(line, featureFile).some(([from, to]) =>
    column >= from && column < to
  );
}
