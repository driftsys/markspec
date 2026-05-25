/**
 * @module typl/ast
 *
 * AST node types for the typl DSL. These types form the foundation
 * for the lexer, parser, validator, and evaluator.
 */

/**
 * Closed kind vocabulary. `value` is the default kind when an author omits
 * it from a binding.
 */
export const KINDS = [
  "value",
  "event",
  "signal",
  "command",
  "state",
  "const",
  "config",
  "document",
  "stream",
] as const;
export type Kind = typeof KINDS[number];

/** Schema AST — one discriminated union covering all shape variants. */
export type Shape =
  | { kind: "primitive"; type: "int" | "float" | "bool" | "string" | "bytes" }
  | {
    kind: "range";
    type: "int" | "float";
    min?: number;
    max?: number;
    exact?: number;
  }
  | {
    kind: "length";
    type: "string" | "bytes";
    min?: number;
    max?: number;
    exact?: number;
  }
  | { kind: "pattern"; regex: string; flags?: string }
  | {
    kind: "array";
    element: Shape;
    min?: number;
    max?: number;
    exact?: number;
  }
  | { kind: "enum"; values: (string | number | boolean)[] }
  | { kind: "record"; fields: Record<string, Shape> }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "ref"; name: string }
  | { kind: "optional"; inner: Shape };

/** Source position carried through every statement for diagnostics. */
export interface Position {
  /** 1-based line within the typl source. */
  readonly line: number;
  /** 1-based column. */
  readonly column: number;
}

/** A `$X : [kind] shape` declaration. */
export interface Binding {
  readonly statementKind: "binding";
  readonly name: string; // includes leading "$"
  readonly kind: Kind;
  readonly shape?: Shape;
  readonly position: Position;
}

/** A `type X = shape` declaration. */
export interface Typedef {
  readonly statementKind: "typedef";
  readonly name: string; // no leading "$"
  readonly shape: Shape;
  readonly position: Position;
}

export type Statement = Binding | Typedef;

/** A parsed typl source unit. */
export interface TyplBlock {
  readonly bindings: readonly Binding[];
  readonly typedefs: readonly Typedef[];
}
