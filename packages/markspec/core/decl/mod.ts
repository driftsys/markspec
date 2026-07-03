/**
 * @module core/decl
 *
 * Shared declaration-surface machinery (uxil epic #717 §A). DSL-agnostic
 * walkers that extract declaration sites from an entry body's three
 * embedding surfaces — fenced code blocks, bullet paragraphs, and inline
 * code spans — parameterized by a recognizer, plus the entry-local
 * base-resolution engine (S4) that resolves relative refs against the base
 * an enclosing declaration establishes. typl consumes these today; uxil
 * (§B) and the table surface (S3) ride on the same substrate.
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

export type { BaseScope, RefOps, RefResolution, RootCheck } from "./resolve.ts";
export { checkSingleRoot, resolveRef } from "./resolve.ts";
