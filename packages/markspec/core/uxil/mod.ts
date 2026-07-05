/**
 * @module uxil
 *
 * uxil DSL layer: `ux:` reference + declaration-form parsers (S7 #725),
 * the declaration AST, structured parse diagnostics, the form recognizer,
 * and the compiler — corpus registry, enforced semantics, and a
 * deterministic machine projection (S8 #726). The compiler is now
 * reachable from `check`/LSP through `core/validator/uxil_family.ts`
 * (S9 #727); the family + LSP wiring itself lands in S9/S10.
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
export { UXIL_CODES, uxilDiagnostic, uxilDiagnosticAt } from "./diagnostics.ts";
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

// ── S8: compiler + registry + projection ────────────────────────────────
export type { UxElement, UxSurface, UxSurfaceTree } from "./assemble.ts";
export { assembleUxSurface, UX_REF_OPS } from "./assemble.ts";
export type { SurfaceRecord, UxRegistry } from "./registry.ts";
export { buildUxRegistry } from "./registry.ts";
export type { UxCitation } from "./citations.ts";
export { extractUxCitations, isUxCitationText } from "./citations.ts";
export {
  extractUxBullets,
  extractUxRootSpans,
  stripUxilLeadingSpan,
} from "./surfaces.ts";
export type { UxilValidateOptions, UxilValidation } from "./validator.ts";
export { validateUxil } from "./validator.ts";
export type {
  ProjectedElement,
  ProjectedSurface,
  UxProjection,
} from "./projection.ts";
export { projectUxRegistry } from "./projection.ts";
export type { KindInfo, VerbInfo } from "./vocab.ts";
export { isKnownKind, isKnownVerb, UX_KINDS, UX_VERBS } from "./vocab.ts";
