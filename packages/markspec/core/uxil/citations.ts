/**
 * @module uxil/citations
 *
 * Citation extraction (S8 #726): a *citation* is a bare `ux:` reference in
 * an inline code span with no declaration clause — e.g.
 * `` `ux:media.home/play!activate` ``. Plain root/element/child
 * declarations are excluded (`classifyUxilForm` recognizes them). Mirrors
 * typl/citations.ts's inline half.
 */
import type { BodyToken, SourceLocation } from "../model/mod.ts";
import { extractInlineDeclarations } from "../decl/mod.ts";
import type { UxRef } from "./ast.ts";
import { parseUxRef } from "./grammar.ts";
import { classifyUxilForm } from "./recognize.ts";

/** One `ux:` citation: the parsed ref and its file location. */
export interface UxCitation {
  readonly ref: UxRef;
  readonly location: SourceLocation;
}

/** True when a code span's (trimmed) text is a `ux:` citation, not a declaration. */
export function isUxCitationText(text: string): boolean {
  const t = text.trim();
  return t.startsWith("ux:") && classifyUxilForm(t) === undefined;
}

/**
 * Filter `Entry.bodyTokens` to `ux:` citations, in source order. Reuses
 * the shared inline-declaration walker with the citation recognizer; a
 * citation that fails to parse cleanly (e.g. a reserved character) is
 * dropped rather than surfaced — parse-level diagnostics are S7's
 * concern, not this extractor's.
 */
export function extractUxCitations(
  bodyTokens: readonly BodyToken[],
): readonly UxCitation[] {
  const out: UxCitation[] = [];
  for (const d of extractInlineDeclarations(bodyTokens, isUxCitationText)) {
    const { ref, diagnostics } = parseUxRef(d.source.trim());
    if (ref && diagnostics.length === 0) {
      out.push({ ref, location: d.location });
    }
  }
  return out;
}
