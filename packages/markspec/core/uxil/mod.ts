/**
 * @module uxil
 *
 * Parse-only uxil DSL layer (S7 #725): `ux:` reference + declaration-form
 * parsers, the declaration AST, structured parse diagnostics, and the
 * form recognizer. Not wired into `core/mod.ts` — S8 (uxil compiler +
 * uxRegistry) consumes these; S9 wires diagnostics to the CLI/LSP.
 */
export type {
  ChildSurfaceDecl,
  ElementDecl,
  Position,
  RootDecl,
  UxilDecl,
  UxKey,
  UxRef,
} from "./ast.ts";
export type { UxilCode, UxilCodeEntry, UxilDiagnostic } from "./diagnostics.ts";
export { UXIL_CODES, uxilDiagnostic } from "./diagnostics.ts";
export type { Token, TokenKind } from "./lexer.ts";
export { tokenize } from "./lexer.ts";
export {
  parseChildSurfaceDecl,
  parseElementBullet,
  parseRootDecl,
  parseUxRef,
} from "./grammar.ts";
export type { UxilForm } from "./recognize.ts";
export { classifyUxilForm } from "./recognize.ts";
