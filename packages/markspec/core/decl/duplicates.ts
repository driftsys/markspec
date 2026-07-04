/**
 * @module core/decl/duplicates
 *
 * DSL-agnostic "declared exactly once" scan over a corpus-wide registry
 * (uxil epic #717 §A, #754). Both typl's dotted-name bindings (TYPL-009)
 * and uxil's own registry (#726) need the identical shape: a
 * `Map<name, T[]>` where any name with more than one declaration is a
 * violation. The engine only counts and groups — the DSL host supplies
 * the registry, narrows which names to check via `predicate`, and maps
 * each {@linkcode DuplicateDeclaration} to its own diagnostic code.
 */

/**
 * One corpus-wide multiple-declaration violation: `name` was declared
 * more than once. `first` is the earliest declaration (registry
 * insertion order); `duplicates` are the rest, in the same order.
 */
export interface DuplicateDeclaration<T> {
  readonly name: string;
  readonly first: T;
  readonly duplicates: readonly T[];
}

/**
 * Scan `registry` for names declared more than once. Returns one entry
 * per offending name, in `registry`'s iteration order. `predicate`
 * narrows which names are checked at all (e.g. typl's "only dotted,
 * published names" rule); defaults to checking every name.
 */
export function findDuplicateDeclarations<T>(
  registry: ReadonlyMap<string, readonly T[]>,
  predicate: (name: string) => boolean = () => true,
): readonly DuplicateDeclaration<T>[] {
  const out: DuplicateDeclaration<T>[] = [];
  for (const [name, decls] of registry) {
    if (decls.length < 2) continue;
    if (!predicate(name)) continue;
    out.push({ name, first: decls[0], duplicates: decls.slice(1) });
  }
  return out;
}
