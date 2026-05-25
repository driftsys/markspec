/**
 * @module typl/fence
 *
 * Fence surface adapter — extracts typl source from fenced code blocks
 * whose info-string is "typl". Operates on the canonical body AST
 * (BodyBlock[]) produced by core/ast/build.ts.
 *
 * This module is parser-side only — it returns the raw typl source and
 * its source range. PR 3 will wire the extracted source through
 * parseTyplBlock and attach results to Entry.types.
 */
import type { BodyBlock, SourceRange } from "../ast/nodes.ts";

/** A single typl fence found inside a body. */
export interface TyplFenceExtraction {
  /** The verbatim typl source from inside the fence (CodeNode.text). */
  readonly source: string;
  /** Source range of the whole fence (opening ``` through closing ```). */
  readonly range: SourceRange;
}

/**
 * Walk a body AST and return every typl fence found. Recurses into
 * container nodes (ListNode via ListItemNode.blocks) so typl fences
 * nested inside list items are discovered.
 *
 * BlockquoteNode and NoteNode carry only InlineContent (not nested
 * BodyBlock[]), so they are not recursed into.
 *
 * Returns fences in source order (depth-first traversal).
 */
export function extractTyplFences(
  blocks: readonly BodyBlock[],
): readonly TyplFenceExtraction[] {
  const results: TyplFenceExtraction[] = [];
  for (const block of blocks) {
    if (block.kind === "code" && block.lang === "typl") {
      results.push({ source: block.text, range: block.range });
    } else if (block.kind === "list") {
      for (const item of block.items) {
        results.push(...extractTyplFences(item.blocks));
      }
    }
  }
  return results;
}
