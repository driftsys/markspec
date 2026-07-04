/**
 * @module typl/citations
 *
 * Citation extraction for the published tier (#723): a *citation* is a
 * bare published-shaped ref in an inline code span — absolute
 * (`` `$powertrain.brake.pedal_position` ``) or relative
 * (`` `$.pedal_position` ``) — with no declaration clause. Plain `$Name`
 * spans are entry-local mentions and deliberately not validated
 * (unchanged pre-#723 behavior). The validator resolves relative
 * citations against the entry's root namespace and checks resolved names
 * against the corpus registry (TYPL-010 / TYPL-011).
 */
import type { BodyToken, SourceLocation } from "../model/mod.ts";
import { extractInlineDeclarations } from "../decl/mod.ts";
import { isPublishedTyplName, isRelativeTyplName } from "./resolve.ts";

/** One published-tier citation: the ref text and its file location. */
export interface TyplCitation {
  readonly name: string;
  readonly location: SourceLocation;
}

/** True when a code span's (trimmed) text is a bare published-shaped ref. */
export function isTyplCitationText(text: string): boolean {
  const t = text.trim();
  return isPublishedTyplName(t) || isRelativeTyplName(t);
}

/**
 * Filter `Entry.bodyTokens` to published-tier citations, in source order.
 * Reuses the shared inline-declaration walker with the citation
 * recognizer — the walker strips backtick delimiters before matching.
 */
export function extractTyplCitations(
  bodyTokens: readonly BodyToken[],
): readonly TyplCitation[] {
  return extractInlineDeclarations(bodyTokens, isTyplCitationText)
    .map((d) => ({ name: d.source.trim(), location: d.location }));
}
