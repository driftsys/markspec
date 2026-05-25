/**
 * @module typl/inline
 *
 * Inline backtick surface adapter — recognises typl declarations
 * wrapped in CommonMark code spans, e.g. `` `$X : signal float[0..300]` ``
 * scattered through entry prose.
 *
 * Filters Entry.bodyTokens (ADR-016) for `inline-code` tokens whose text
 * matches typl syntax. Each matching span produces one
 * TyplInlineExtraction; the parser integration calls parseTyplBlock on
 * each `source` independently.
 *
 * See ADR-019.
 */
import type { BodyToken, SourceLocation } from "../model/mod.ts";

/** A single typl inline-code declaration found in an entry body. */
export interface TyplInlineExtraction {
  /** The typl source from one matching code span (text between backticks). */
  readonly source: string;
  /** File-relative location of the code span. */
  readonly location: SourceLocation;
}

/** Matches a typl binding span (code-span text). */
const INLINE_BINDING_RE = /^\$[A-Za-z_][A-Za-z0-9_]*\s*:/;

/** Matches a typl typedef span (code-span text). */
const INLINE_TYPEDEF_RE = /^type\s+[A-Za-z_][A-Za-z0-9_]*\s*=/;

function isTyplInlineText(text: string): boolean {
  return INLINE_BINDING_RE.test(text) || INLINE_TYPEDEF_RE.test(text);
}

/**
 * Filter bodyTokens to inline-code spans whose contents match typl
 * syntax. Returns extractions in source order (the bodyTokens contract
 * guarantees source order).
 */
export function extractTyplInlines(
  bodyTokens: readonly BodyToken[],
): readonly TyplInlineExtraction[] {
  const results: TyplInlineExtraction[] = [];
  for (const token of bodyTokens) {
    if (token.kind !== "inline-code") continue;
    if (!isTyplInlineText(token.text)) continue;
    results.push({ source: token.text, location: token.location });
  }
  return results;
}
