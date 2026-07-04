/**
 * @module typl
 *
 * Type Specification DSL — declarations of $Name identifiers and named
 * shapes, embedded in MarkSpec entry bodies. See ADR-019
 * (docs/architecture/adr-019-typl-type-dsl.md) for the language spec.
 */

export type {
  Binding,
  Kind,
  Position,
  Shape,
  Statement,
  Typedef,
  TyplBlock,
} from "./ast.ts";
export { KINDS } from "./ast.ts";

export type { TyplCode, TyplCodeEntry, TyplDiagnostic } from "./diagnostics.ts";
export { TYPL_CODES, typlDiagnostic } from "./diagnostics.ts";

export { parseTyplBlock } from "./grammar.ts";

export { assembleTyplTypes } from "./assemble.ts";

export type { TyplFenceExtraction } from "./fence.ts";
export { extractTyplFences } from "./fence.ts";

export { bridgeTyplDiagnostic } from "./bridge.ts";

export type {
  TyplBulletExtraction,
  TyplNestedBulletExtraction,
} from "./bullet.ts";
export { extractTyplBullets, extractTyplBulletsNested } from "./bullet.ts";

export type { TyplInlineExtraction } from "./inline.ts";
export { extractTyplInlines } from "./inline.ts";

export type { TyplCitation } from "./citations.ts";
export { extractTyplCitations, isTyplCitationText } from "./citations.ts";

export {
  isPublishedTyplName,
  isRelativeTyplName,
  TYPL_REF_OPS,
  typlPathOf,
} from "./resolve.ts";

export type {
  RegistryBinding,
  RegistryTypedef,
  TypeRegistry,
} from "./registry.ts";
export { buildTypeRegistry } from "./registry.ts";

export { validateTypl } from "./validator.ts";
