/**
 * @module typl/bullet
 *
 * Bullet-glossary surface adapter — recognises CommonMark bullet list
 * items whose first paragraph is a typl declaration (`$X : …` binding or
 * `type X = …` typedef). A thin wrapper over the shared
 * declaration-surface machinery (core/decl): it supplies typl's text
 * recognizer and re-exports the common declaration node as
 * {@linkcode TyplNestedBulletExtraction}. Mixed lists are supported —
 * matching items are extracted, non-matching bullets are left alone.
 *
 * See ADR-019.
 */
import type { BodyBlock } from "../ast/nodes.ts";
import {
  extractNestedBulletDeclarations,
  type NestedBlockDeclaration,
} from "../decl/mod.ts";
import { isTyplDeclarationText } from "./recognize.ts";

/** A typl bullet declaration with its structural parent link (#723). */
export type TyplNestedBulletExtraction = NestedBlockDeclaration;

/**
 * Walk a body AST and return every bullet-list item whose first paragraph
 * is a typl declaration, in source order (depth-first, recursing into
 * nested lists), each with a `parent` link for base-resolution scope
 * chains. Delegates traversal to
 * {@linkcode extractNestedBulletDeclarations}.
 */
export function extractTyplBulletsNested(
  blocks: readonly BodyBlock[],
): readonly TyplNestedBulletExtraction[] {
  return extractNestedBulletDeclarations(blocks, isTyplDeclarationText);
}
