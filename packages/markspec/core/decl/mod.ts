/**
 * @module core/decl
 *
 * Shared declaration-surface machinery (uxil epic #717 §A). DSL-agnostic
 * walkers that extract declaration sites from an entry body's four
 * embedding surfaces — fenced code blocks, bullet paragraphs, inline code
 * spans, and table rows — parameterized by a recognizer, plus the
 * entry-local base-resolution engine (S4) that resolves relative refs
 * against the base an enclosing declaration establishes. typl consumes
 * these today; uxil (§B) rides on the same substrate.
 */

export type {
  BlockDeclaration,
  FenceRecognizer,
  InlineDeclaration,
  NestedBlockDeclaration,
  TextRecognizer,
} from "./surfaces.ts";
export {
  extractBulletDeclarations,
  extractFenceDeclarations,
  extractInlineDeclarations,
  extractNestedBulletDeclarations,
  stripCodeSpanDelimiters,
} from "./surfaces.ts";

export type { RowRecognizer, TableRowDeclaration } from "./table.ts";
export { extractTableDeclarations } from "./table.ts";

export type { BaseScope, RefOps, RefResolution, RootCheck } from "./resolve.ts";
export { checkSingleRoot, resolveRef } from "./resolve.ts";
