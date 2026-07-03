/**
 * @module core/decl
 *
 * Shared declaration-surface machinery (uxil epic #717 §A). DSL-agnostic
 * walkers that extract declaration sites from an entry body's three
 * embedding surfaces — fenced code blocks, bullet paragraphs, inline code
 * spans, and table rows — parameterized by a recognizer. typl consumes
 * these today; uxil (§B) rides on the same substrate.
 */

export type {
  BlockDeclaration,
  FenceRecognizer,
  InlineDeclaration,
  TextRecognizer,
} from "./surfaces.ts";
export {
  extractBulletDeclarations,
  extractFenceDeclarations,
  extractInlineDeclarations,
  stripCodeSpanDelimiters,
} from "./surfaces.ts";

export type { RowRecognizer, TableRowDeclaration } from "./table.ts";
export { extractTableDeclarations } from "./table.ts";
