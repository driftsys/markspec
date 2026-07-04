/**
 * @module uxil/ast
 *
 * AST node types for the uxil DSL (parse-only, S7 #725). A `UxRef` is a
 * parsed `ux:` reference (citation, nav target, or the surface head of a
 * declaration); the three `*Decl` shapes are the authored declaration forms.
 * All values are captured raw — kind/verb/state vocabulary checks are S8.
 */

/** 1-based source position within a single uxil source string (line is always 1). */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/** A ref key: a concrete value or a `{name}` template. */
export type UxKey =
  | { readonly kind: "concrete"; readonly value: string }
  | { readonly kind: "template"; readonly name: string };

/**
 * A parsed `ux:` reference. `hasScheme` records whether the literal `ux:`
 * scheme was present; the scheme-less wire form parses to an otherwise
 * identical node (wire-compatibility contract).
 */
export interface UxRef {
  readonly hasScheme: boolean;
  readonly surface: readonly string[];
  readonly state?: string;
  readonly element?: string;
  readonly key?: UxKey;
  readonly verb?: string;
  readonly position: Position;
}

/** Root declaration: `ux:surface : kind @ state, state, …` (exactly one per entry — enforced in S8). */
export interface RootDecl {
  readonly form: "root";
  readonly surface: readonly string[];
  readonly kind: string;
  readonly states: readonly string[];
  readonly position: Position;
}

/** Element declaration from a bullet: `/element{key} : verb, … @state -> nav` plus a trailing event dictionary. */
export interface ElementDecl {
  readonly form: "element";
  readonly element: string;
  readonly keyTemplate?: UxKey;
  readonly verbs: readonly string[];
  readonly states?: readonly string[];
  readonly nav?: UxRef;
  readonly eventDictionary: string;
  readonly position: Position;
}

/** Child-surface declaration from a bullet: `.path @state` (its nested bullets are its elements — stitched in S8). */
export interface ChildSurfaceDecl {
  readonly form: "child";
  readonly path: readonly string[];
  readonly states?: readonly string[];
  readonly position: Position;
}

export type UxilDecl = RootDecl | ElementDecl | ChildSurfaceDecl;
