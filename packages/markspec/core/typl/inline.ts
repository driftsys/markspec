/**
 * @module typl/inline
 *
 * Inline backtick surface adapter — recognises typl declarations wrapped
 * in CommonMark code spans, e.g. `` `$X : signal float[0..300]` ``
 * scattered through entry prose. A thin wrapper over the shared
 * declaration-surface machinery (core/decl): it supplies typl's text
 * recognizer and re-exports the common declaration node as
 * {@linkcode TyplInlineExtraction}. The shared machinery strips the
 * backtick delimiters `Entry.bodyTokens` (ADR-016) records before
 * recognizing, so `source` is the raw typl text.
 *
 * See ADR-019.
 */
import type { BodyToken } from "../model/mod.ts";
import {
  extractInlineDeclarations,
  type InlineDeclaration,
} from "../decl/mod.ts";
import { isTyplDeclarationText } from "./recognize.ts";

/** A single typl inline-code declaration: `{ source, location }`. */
export type TyplInlineExtraction = InlineDeclaration;

/**
 * Filter `Entry.bodyTokens` to inline-code spans whose contents are typl
 * declarations, in source order. Delegates to
 * {@linkcode extractInlineDeclarations}.
 */
export function extractTyplInlines(
  bodyTokens: readonly BodyToken[],
): readonly TyplInlineExtraction[] {
  return extractInlineDeclarations(bodyTokens, isTyplDeclarationText);
}
