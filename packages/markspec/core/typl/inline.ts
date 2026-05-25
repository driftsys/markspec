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
 * Strip the surrounding backtick delimiter(s) from an inline-code token's
 * `text` field. `body_tokens.ts` stores inline-code text as `` `value` ``
 * (with backtick delimiters). The typl patterns and `parseTyplBlock` need
 * the inner value only.
 *
 * Handles both single-backtick (`` `…` ``) and double-backtick (` ``…`` `)
 * delimiters. Returns the original string unchanged when it does not start
 * and end with a matching backtick fence.
 */
function stripBackticks(text: string): string {
  if (text.startsWith("``") && text.endsWith("``") && text.length > 4) {
    return text.slice(2, -2);
  }
  if (text.startsWith("`") && text.endsWith("`") && text.length > 2) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Filter bodyTokens to inline-code spans whose contents match typl
 * syntax. Returns extractions in source order (the bodyTokens contract
 * guarantees source order).
 *
 * `inline-code` tokens in `bodyTokens` store their `text` field with
 * surrounding backtick delimiters (e.g., `` `$X : signal` ``). This
 * function strips those delimiters before pattern-matching and before
 * setting `source`, so `parseTyplBlock` receives the raw typl source.
 */
export function extractTyplInlines(
  bodyTokens: readonly BodyToken[],
): readonly TyplInlineExtraction[] {
  const results: TyplInlineExtraction[] = [];
  for (const token of bodyTokens) {
    if (token.kind !== "inline-code") continue;
    const inner = stripBackticks(token.text);
    if (!isTyplInlineText(inner)) continue;
    results.push({ source: inner, location: token.location });
  }
  return results;
}
