/**
 * @module core/decl/surfaces
 *
 * DSL-agnostic declaration-surface machinery. Walks a MarkSpec entry body
 * and extracts every *declaration site* on each of the three embedding
 * surfaces, returning a common declaration node:
 *
 *   - **fence** — a fenced code block whose info-string a DSL claims
 *     (e.g. ```typl). {@linkcode extractFenceDeclarations}
 *   - **bullet** — a list item whose first paragraph is a declaration.
 *     {@linkcode extractNestedBulletDeclarations}
 *   - **inline** — a CommonMark code span whose text is a declaration.
 *     {@linkcode extractInlineDeclarations}
 *
 * Each walker is parameterized by a *recognizer* — the only DSL-specific
 * input — and knows nothing about typl, uxil, or any concrete vocabulary.
 * A DSL host (typl today; uxil and the table surface later) supplies the
 * recognizer and consumes the returned {@linkcode BlockDeclaration} /
 * {@linkcode InlineDeclaration} nodes.
 *
 * Extracted from the typl surface adapters (ADR-019) so §A of the uxil
 * epic (#717) can share one substrate. typl's fence / bullet / inline
 * modules are thin adapters over these functions and their observable
 * output is unchanged.
 */

import type { BodyBlock, SourceRange } from "../ast/nodes.ts";
import type { BodyToken, SourceLocation } from "../model/mod.ts";

/**
 * A declaration found on a block surface (fenced code block or bullet
 * paragraph). Carries the raw DSL `source` and the node's body-relative
 * {@linkcode SourceRange} — the anchor a DSL host uses to bridge parse
 * diagnostics back to file positions.
 */
export interface BlockDeclaration {
  /** Raw DSL source: the fence body, or the bullet's paragraph text. */
  readonly source: string;
  /** Source range of the fence, or of the bullet's first paragraph. */
  readonly range: SourceRange;
}

/**
 * A declaration found in an inline code span. Carries the raw DSL
 * `source` (backtick delimiters stripped) and the span's file-relative
 * {@linkcode SourceLocation} (the position `Entry.bodyTokens` records).
 */
export interface InlineDeclaration {
  /** Raw DSL source: the code span's inner text, backticks stripped. */
  readonly source: string;
  /** File-relative location of the code span. */
  readonly location: SourceLocation;
}

/** Recognizer for the fence surface: does this info-string host the DSL? */
export type FenceRecognizer = (lang: string | undefined) => boolean;

/** Recognizer for the bullet / inline surfaces: is this text a declaration? */
export type TextRecognizer = (text: string) => boolean;

/**
 * Walk a body AST and return every fenced code block whose info-string
 * satisfies `matchLang`. Recurses into container nodes (ListNode via
 * ListItemNode.blocks) so fences nested inside list items are found.
 *
 * BlockquoteNode and NoteNode carry only InlineContent (not nested
 * BodyBlock[]), so they are not recursed into. Returns declarations in
 * source order (depth-first traversal).
 */
export function extractFenceDeclarations(
  blocks: readonly BodyBlock[],
  matchLang: FenceRecognizer,
): readonly BlockDeclaration[] {
  const results: BlockDeclaration[] = [];
  for (const block of blocks) {
    if (block.kind === "code" && matchLang(block.lang)) {
      results.push({ source: block.text, range: block.range });
    } else if (block.kind === "list") {
      for (const item of block.items) {
        results.push(...extractFenceDeclarations(item.blocks, matchLang));
      }
    }
  }
  return results;
}

/**
 * A bullet declaration with its structural parent: the index (into the
 * returned array) of the nearest enclosing extracted declaration, or
 * `undefined` at top level. Parents always precede children in the
 * depth-first output order, so `parent < index` holds for every link.
 * The base-resolution engine (resolve.ts) consumes these links to build
 * its innermost-wins scope chains (#723).
 */
export interface NestedBlockDeclaration extends BlockDeclaration {
  readonly parent?: number;
}

/**
 * Walk a body AST and return every bullet-list item whose first paragraph
 * satisfies `matchText`, in depth-first source order, each with a `parent`
 * link to its nearest enclosing extracted declaration (or `undefined` at
 * top level). Recurses through ListNode → ListItemNode.blocks for nested
 * lists. Mixed lists are supported: items whose first paragraph matches
 * are extracted; non-matching bullets are left alone. A DSL host walks
 * the `parent` links to build the {@linkcode BaseScope} chain a nested
 * declaration resolves against.
 */
export function extractNestedBulletDeclarations(
  blocks: readonly BodyBlock[],
  matchText: TextRecognizer,
): readonly NestedBlockDeclaration[] {
  const results: NestedBlockDeclaration[] = [];
  const walk = (
    blocks: readonly BodyBlock[],
    parent: number | undefined,
  ): void => {
    for (const block of blocks) {
      if (block.kind !== "list") continue;
      for (const item of block.items) {
        if (item.blocks.length === 0) continue;
        const first = item.blocks[0];
        let itemParent = parent;
        if (first.kind === "paragraph" && matchText(first.content.text)) {
          results.push({
            source: first.content.text,
            range: first.range,
            parent,
          });
          itemParent = results.length - 1;
        }
        if (item.blocks.length > 1) {
          walk(item.blocks.slice(1), itemParent);
        } else if (first.kind === "list") {
          walk([first], itemParent);
        }
      }
    }
  };
  walk(blocks, undefined);
  return results;
}

/**
 * Strip the surrounding backtick delimiter(s) from an inline-code token's
 * `text` field. `body_tokens.ts` stores inline-code text as `` `value` ``
 * (with backtick delimiters); a DSL recognizer and parser need the inner
 * value only.
 *
 * Handles both single-backtick (`` `…` ``) and double-backtick (` ``…`` `)
 * delimiters. Returns the original string unchanged when it does not start
 * and end with a matching backtick fence.
 */
export function stripCodeSpanDelimiters(text: string): string {
  if (text.startsWith("``") && text.endsWith("``") && text.length > 4) {
    return text.slice(2, -2);
  }
  if (text.startsWith("`") && text.endsWith("`") && text.length > 2) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Filter `bodyTokens` to inline-code spans whose contents (backticks
 * stripped) satisfy `matchText`. Returns declarations in source order
 * (the bodyTokens contract guarantees source order).
 *
 * `inline-code` tokens store their `text` field with surrounding backtick
 * delimiters (e.g. `` `$X : signal` ``). This function strips those
 * delimiters via {@linkcode stripCodeSpanDelimiters} before recognizing
 * and before setting `source`, so the DSL parser receives the raw source.
 */
export function extractInlineDeclarations(
  bodyTokens: readonly BodyToken[],
  matchText: TextRecognizer,
): readonly InlineDeclaration[] {
  const results: InlineDeclaration[] = [];
  for (const token of bodyTokens) {
    if (token.kind !== "inline-code") continue;
    const inner = stripCodeSpanDelimiters(token.text);
    if (!matchText(inner)) continue;
    results.push({ source: inner, location: token.location });
  }
  return results;
}
