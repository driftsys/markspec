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

export type { TyplFenceExtraction } from "./fence.ts";
export { extractTyplFences } from "./fence.ts";
