/**
 * @module lsp/locators
 *
 * Finds the scenario locators on a trailer line (ADR-037). A display ID
 * inside a closed locator, as in `Verifies: REQ_1 [Scenario REQ_2]`, is
 * scenario text and not a reference (#915). Hover, go-to-definition, find
 * references, document highlights, rename and semantic tokens share these
 * helpers.
 *
 * The gate keys on the relation, not the indent: a line is a locator line
 * when, after an optional doc-comment marker and any whitespace (none at all
 * for a git-style trailer), it starts with `Key:` and the key is a core
 * relation that accepts a locator (`relationLocatorMode`: `Satisfies`,
 * `Verifies`, `References`, `Derived-from`, plus the generated `Verified-by`).
 * Other lines, including prose
 * lines, have no locators.
 *
 * Known difference: the `core/refs` rename-heal scanner still requires at
 * least 4 spaces of indent, so on a 1-3 space or unindented trailer it
 * rewrites an ID inside a locator that the LSP leaves alone.
 */

import { relationLocatorMode } from "../core/mod.ts";

/**
 * The relation keys whose values can hold a locator: the core relations with
 * a locator mode, plus `Verified-by`, the generated inverse of `Verifies`,
 * which carries the same locator text.
 */
function acceptsLocator(key: string): boolean {
  return relationLocatorMode(key) !== undefined || key === "Verified-by";
}

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
  if (!gate || !acceptsLocator(gate[1])) return [];
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
