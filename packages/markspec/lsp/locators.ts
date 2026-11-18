/**
 * @module lsp/locators
 *
 * Finds the scenario locators on a trailer line (ADR-037). A display ID
 * inside a closed locator, as in `Verifies: REQ_1 [Scenario REQ_2]`, is
 * scenario text and not a reference (#915). Rename, document highlights,
 * hover, definition and semantic tokens share these helpers.
 */

/** A trailer line: optional doc-comment prefix, at least 4 spaces of
 * indent, then `Key:`. */
export const TRAILER_LINE_RE =
  /^(?:\s*(?:\/\/[/!]?|\*|#))?\s{4,}[A-Z][A-Za-z-]*\s*:/;

/** A `.feature` header trailer line: `#`, optional spaces, then `Key:`. */
export const FEATURE_TRAILER_LINE_RE = /^\s*#\s*[A-Z][A-Za-z-]*\s*:/;

/** A closed bracket locator after whitespace, with escapes (same grammar
 * as `core/refs/split.ts`). */
const LOCATOR_SPAN_RE = /\s\[(?:\\[\s\S]|[^\]\\])*\]/g;

/** `[start, end)` column spans of the closed locators on a line that
 * `trailerLine` accepts; empty for any other line. */
export function locatorSpans(
  line: string,
  trailerLine: RegExp,
): Array<[number, number]> {
  if (!trailerLine.test(line)) return [];
  return [...line.matchAll(LOCATOR_SPAN_RE)].map((
    m,
  ) => [m.index!, m.index! + m[0].length]);
}

/**
 * `true` when `column` lies inside a closed locator of the trailer `line`.
 * Set `featureFile` for a `.feature` file, whose trailers are `# Key: value`
 * comment lines.
 */
export function isInsideLocator(
  line: string,
  column: number,
  featureFile = false,
): boolean {
  const trailerLine = featureFile ? FEATURE_TRAILER_LINE_RE : TRAILER_LINE_RE;
  return locatorSpans(line, trailerLine).some(([from, to]) =>
    column >= from && column < to
  );
}
