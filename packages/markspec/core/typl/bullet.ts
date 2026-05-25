/**
 * @module typl/bullet
 *
 * Bullet-glossary surface adapter — recognises CommonMark bullet list
 * items whose first paragraph matches typl syntax (`$X : ...` binding
 * or `type X = ...` typedef). Mixed lists are supported: items that
 * match are treated as typl declarations; non-matching bullets are
 * left alone.
 *
 * Each matching item produces one TyplBulletExtraction; the parser
 * integration calls parseTyplBlock on each `source` independently.
 * Per-item position-bridging uses the item's range and formula
 * documented in bridgeTyplDiagnostic.
 *
 * See ADR-019.
 */
import type { BodyBlock, ParagraphNode, SourceRange } from "../ast/nodes.ts";

/** A single typl bullet item found inside a body. */
export interface TyplBulletExtraction {
  /** The typl source from one matching bullet item (paragraph text). */
  readonly source: string;
  /** Source range of the bullet's first paragraph. */
  readonly range: SourceRange;
}

/** Matches a typl binding bullet (paragraph text). */
const BULLET_BINDING_RE = /^\$[A-Za-z_][A-Za-z0-9_]*\s*:/;

/** Matches a typl typedef bullet (paragraph text). */
const BULLET_TYPEDEF_RE = /^type\s+[A-Za-z_][A-Za-z0-9_]*\s*=/;

function isTyplBulletText(text: string): boolean {
  return BULLET_BINDING_RE.test(text) || BULLET_TYPEDEF_RE.test(text);
}

/**
 * Walk a body AST and return every bullet-list item whose first
 * paragraph matches typl syntax. Recurses through ListNode →
 * ListItemNode.blocks for nested lists (typl bullets inside a nested
 * list are picked up).
 *
 * Returns matches in source order (depth-first).
 */
export function extractTyplBullets(
  blocks: readonly BodyBlock[],
): readonly TyplBulletExtraction[] {
  const results: TyplBulletExtraction[] = [];
  for (const block of blocks) {
    if (block.kind === "list") {
      for (const item of block.items) {
        if (item.blocks.length === 0) continue;
        const first = item.blocks[0];
        if (first.kind === "paragraph") {
          const para = first as ParagraphNode;
          if (isTyplBulletText(para.content.text)) {
            results.push({
              source: para.content.text,
              range: para.range,
            });
          }
        }
        // Recurse into nested blocks (the item may itself contain a list)
        if (item.blocks.length > 1) {
          results.push(...extractTyplBullets(item.blocks.slice(1)));
        } else if (first.kind === "list") {
          results.push(...extractTyplBullets([first]));
        }
      }
    }
  }
  return results;
}
