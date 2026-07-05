/**
 * @module uxil/surfaces
 *
 * Thin uxil adapters over the shared declaration-surface machinery
 * (core/decl). Each supplies a `classifyUxilForm`-based recognizer and
 * re-uses the DSL-agnostic walkers — mirrors typl/bullet.ts + the inline
 * half of typl/citations.ts.
 *
 * Bullet paragraphs keep their literal backtick delimiters and any
 * trailing prose in one string (e.g. `` `/play : activate` — starts
 * playback. ``) — {@linkcode extractNestedBulletDeclarations} hands the
 * whole paragraph to the recognizer, unlike the inline surface (whose
 * tokens are span-only, already backtick-stripped by
 * {@linkcode extractInlineDeclarations}). Classification therefore needs
 * the *leading span* extracted first; {@linkcode stripUxilLeadingSpan}
 * does that (mirroring grammar.ts's private `splitLeadingCodeSpan`,
 * span-only). The declaration's `source` field stays the raw paragraph —
 * `parseElementBullet` wants exactly that (it splits the span itself);
 * assembly strips the span again for `parseChildSurfaceDecl`, which
 * expects bare span text.
 */
import type { BodyBlock } from "../ast/nodes.ts";
import type { BodyToken } from "../model/mod.ts";
import {
  extractInlineDeclarations,
  extractNestedBulletDeclarations,
  type InlineDeclaration,
  type NestedBlockDeclaration,
} from "../decl/mod.ts";
import { classifyUxilForm } from "./recognize.ts";

/**
 * Extract the leading inline-code span's inner text from a bullet
 * paragraph, backticks stripped, ignoring any trailing prose. Returns
 * `undefined` when the paragraph does not begin with a (closed) code
 * span. Handles both single- and double-backtick delimiters.
 */
export function stripUxilLeadingSpan(text: string): string | undefined {
  const t = text.replace(/^\s+/, "");
  if (t.startsWith("``")) {
    const end = t.indexOf("``", 2);
    return end < 0 ? undefined : t.slice(2, end);
  }
  if (t.startsWith("`")) {
    const end = t.indexOf("`", 1);
    return end < 0 ? undefined : t.slice(1, end);
  }
  return undefined;
}

/** Inline code spans whose text is a uxil root declaration. */
export function extractUxRootSpans(
  bodyTokens: readonly BodyToken[],
): readonly InlineDeclaration[] {
  return extractInlineDeclarations(
    bodyTokens,
    (text) => classifyUxilForm(text) === "root",
  );
}

/** Bullet declarations (element or child surface), with parent links. */
export function extractUxBullets(
  blocks: readonly BodyBlock[],
): readonly NestedBlockDeclaration[] {
  return extractNestedBulletDeclarations(blocks, (text) => {
    const span = stripUxilLeadingSpan(text);
    if (span === undefined) return false;
    const form = classifyUxilForm(span);
    return form === "element" || form === "child";
  });
}
