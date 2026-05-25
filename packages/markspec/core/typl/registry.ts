/**
 * @module typl/registry
 *
 * Corpus-level index of every $Name binding and named typedef across all
 * entries. Built by buildTypeRegistry; consumed by validateTypl (cross-
 * entry collision detection) and future downstream emitters (RIDL bridge,
 * LSP go-to-definition).
 *
 * See ADR-019.
 */
import type { Entry } from "../model/mod.ts";
import type { Binding, Typedef } from "./ast.ts";

/** One binding declaration record, with backref to its host entry. */
export interface RegistryBinding {
  readonly entryDisplayId: string;
  readonly entryFile: string;
  readonly binding: Binding;
}

/** One typedef declaration record, with backref to its host entry. */
export interface RegistryTypedef {
  readonly entryDisplayId: string;
  readonly entryFile: string;
  readonly typedef: Typedef;
}

/**
 * Corpus-wide index. Each $Name (and each typedef name) maps to ALL
 * declarations found — collisions are NOT collapsed; the validator
 * surfaces them via TYPL-002/003.
 */
export interface TypeRegistry {
  /** Keyed by $Name (including leading `$`). */
  readonly bindings: ReadonlyMap<string, readonly RegistryBinding[]>;
  /** Keyed by typedef name (no `$`). */
  readonly typedefs: ReadonlyMap<string, readonly RegistryTypedef[]>;
}

/**
 * Build the corpus type registry from the entries. Entries without
 * `entry.types` are ignored. Source order is preserved within each name's
 * list (first declaration first).
 */
export function buildTypeRegistry(
  entries: readonly Entry[],
): TypeRegistry {
  const bindings = new Map<string, RegistryBinding[]>();
  const typedefs = new Map<string, RegistryTypedef[]>();

  for (const entry of entries) {
    if (!entry.types) continue;
    const entryFile = entry.location.file;
    const entryDisplayId = entry.displayId;
    for (const binding of entry.types.bindings) {
      const list = bindings.get(binding.name) ?? [];
      list.push({ entryDisplayId, entryFile, binding });
      bindings.set(binding.name, list);
    }
    for (const typedef of entry.types.typedefs) {
      const list = typedefs.get(typedef.name) ?? [];
      list.push({ entryDisplayId, entryFile, typedef });
      typedefs.set(typedef.name, list);
    }
  }

  return { bindings, typedefs };
}
