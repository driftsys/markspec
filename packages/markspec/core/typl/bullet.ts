/**
 * @module typl/bullet
 *
 * Bullet-glossary surface adapter — recognises CommonMark bullet list
 * items whose first paragraph is a typl declaration (`$X : …` binding or
 * `type X = …` typedef). A thin wrapper over the shared
 * declaration-surface machinery (core/decl): it supplies typl's text
 * recognizer and re-exports the common declaration node as
 * {@linkcode TyplBulletExtraction}. Mixed lists are supported — matching
 * items are extracted, non-matching bullets are left alone.
 *
 * See ADR-019.
 */
import type { BodyBlock } from "../ast/nodes.ts";
import {
  type BlockDeclaration,
  extractBulletDeclarations,
} from "../decl/mod.ts";
import { isTyplDeclarationText } from "./recognize.ts";

/** A single typl bullet item found inside a body: `{ source, range }`. */
export type TyplBulletExtraction = BlockDeclaration;

/**
 * Walk a body AST and return every bullet-list item whose first paragraph
 * is a typl declaration, in source order (depth-first, recursing into
 * nested lists). Delegates traversal to {@linkcode extractBulletDeclarations}.
 */
export function extractTyplBullets(
  blocks: readonly BodyBlock[],
): readonly TyplBulletExtraction[] {
  return extractBulletDeclarations(blocks, isTyplDeclarationText);
}
