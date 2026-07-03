/**
 * @module core/decl/resolve
 *
 * Entry-local base-resolution engine (uxil epic #717 §A). The DSL-agnostic
 * *normative rule set* for resolving a relative reference against the base
 * an enclosing declaration established. typl's published tier and uxil both
 * consume it; the engine knows nothing about either vocabulary.
 *
 * The six rules from #722, and where each lives:
 *
 *   1. Only *declarations* create bases; *citations* never do. — The caller
 *      sets {@linkcode BaseScope.base} only for declaration scopes; a scope
 *      built from a citation leaves it `undefined`.
 *   2. Bases are entry-local (no document-ambient scope). — The engine only
 *      ever walks the `parent` chain it is given; there is no global lookup.
 *   3. Innermost base wins. — {@linkcode resolveRef} returns on the first
 *      ancestor (nearest first) that carries a base.
 *   4. Scope is structural, never sequential. — The engine follows `parent`
 *      links only; siblings are unreachable, so reordering declarations can
 *      never rebind a ref.
 *   5. Exactly one root declaration per declaring entry. —
 *      {@linkcode checkSingleRoot}.
 *   6. Declarations/citations sit in code spans. — A surface concern
 *      (core/decl/surfaces + the DSL recognizer); the engine sees only the
 *      already-extracted ref token.
 *
 * The caller builds the {@linkcode BaseScope} chain from the entry's
 * structural nesting (list membership, table membership) — that mapping is
 * DSL- and surface-specific and lands with the table surface (S3) and the
 * DSL consumers (S5/S7).
 */

/**
 * A structural scope in an entry's declaration tree. {@linkcode resolveRef}
 * walks `parent` links from innermost to outermost.
 *
 * `base` is the base a *declaration* established at this scope, or
 * `undefined` when this scope establishes none (a citation scope, or a
 * structural container that declares nothing). Because the engine reaches
 * enclosing scopes only through `parent`, siblings are invisible to one
 * another and ordering within a level is irrelevant — the scope is purely
 * structural (rule 4).
 */
export interface BaseScope {
  /** The base declared at this scope, if any. */
  readonly base?: string;
  /** The enclosing scope, or `undefined` at the entry root. */
  readonly parent?: BaseScope;
}

/**
 * The DSL-specific reference operations the engine is parameterized by.
 * Keeping these injected is what makes the engine vocabulary-agnostic: typl
 * dotted paths and uxil `ux:` URIs supply their own notions of "absolute"
 * and of how a base combines with a relative ref.
 */
export interface RefOps {
  /** True when `ref` is already absolute and needs no base. */
  readonly isAbsolute: (ref: string) => boolean;
  /** Combine an enclosing `base` with a relative `ref` into a full ref. */
  readonly join: (base: string, ref: string) => string;
}

/**
 * Outcome of {@linkcode resolveRef}. `no-base-in-scope` is returned for a
 * relative ref that finds no base in any ancestor; the DSL host maps that
 * reason to its own diagnostic code (typl TYPL-0xx, uxil UXIL-0xx).
 */
export type RefResolution =
  | { readonly ok: true; readonly ref: string }
  | { readonly ok: false; readonly reason: "no-base-in-scope" };

/**
 * Resolve `ref` at `scope`. An absolute ref passes through unchanged. A
 * relative ref is joined with the base of the nearest enclosing scope that
 * carries one (innermost wins, rule 3); a single join with that base only —
 * bases are not accumulated up the chain, because each scope's `base` is
 * already its fully-qualified prefix. A relative ref with no base in any
 * ancestor yields `{ ok: false, reason: "no-base-in-scope" }`.
 *
 * `scope` may be `undefined` (a ref at the very top with no enclosing
 * declaration); a relative ref there is likewise `no-base-in-scope`.
 */
export function resolveRef(
  ref: string,
  scope: BaseScope | undefined,
  ops: RefOps,
): RefResolution {
  if (ops.isAbsolute(ref)) return { ok: true, ref };
  for (let s: BaseScope | undefined = scope; s !== undefined; s = s.parent) {
    if (s.base !== undefined) return { ok: true, ref: ops.join(s.base, ref) };
  }
  return { ok: false, reason: "no-base-in-scope" };
}

/**
 * Outcome of {@linkcode checkSingleRoot}. On failure, `roots` carries the
 * offending set so the DSL host can locate each one for its diagnostic.
 */
export type RootCheck<T> =
  | { readonly ok: true; readonly root: T }
  | {
    readonly ok: false;
    readonly reason: "no-root" | "multiple-roots";
    readonly roots: readonly T[];
  };

/**
 * Enforce the one-root invariant (rule 5): a declaring entry must have
 * exactly one root declaration. Returns the sole root on success, or a
 * `no-root` / `multiple-roots` failure carrying the offending set. Generic
 * over the DSL's root-declaration type — the engine only counts.
 */
export function checkSingleRoot<T>(roots: readonly T[]): RootCheck<T> {
  if (roots.length === 1) return { ok: true, root: roots[0] };
  return {
    ok: false,
    reason: roots.length === 0 ? "no-root" : "multiple-roots",
    roots,
  };
}
