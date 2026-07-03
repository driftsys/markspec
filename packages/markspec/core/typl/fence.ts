/**
 * @module typl/fence
 *
 * Fence surface adapter — extracts typl source from fenced code blocks
 * whose info-string is "typl". A thin wrapper over the shared
 * declaration-surface machinery (core/decl): it supplies typl's fence
 * recognizer and re-exports the common declaration node as
 * {@linkcode TyplFenceExtraction}.
 *
 * See ADR-019.
 */
import type { BodyBlock } from "../ast/nodes.ts";
import {
  type BlockDeclaration,
  extractFenceDeclarations,
} from "../decl/mod.ts";

/** A single typl fence found inside a body: `{ source, range }`. */
export type TyplFenceExtraction = BlockDeclaration;

/**
 * Walk a body AST and return every typl fence (```typl) found, in source
 * order (depth-first, recursing into list items). Delegates traversal to
 * {@linkcode extractFenceDeclarations}.
 */
export function extractTyplFences(
  blocks: readonly BodyBlock[],
): readonly TyplFenceExtraction[] {
  return extractFenceDeclarations(blocks, (lang) => lang === "typl");
}
