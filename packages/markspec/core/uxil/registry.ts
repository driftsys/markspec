/**
 * @module uxil/registry
 *
 * Corpus-level index of every declared uxil surface across all entries.
 * Built by {@linkcode buildUxRegistry}; consumed by validateUxil
 * (declared-once / dangling-parent / navigate-resolution checks) and
 * projectUxRegistry (machine projection). Mirrors typl/registry.ts,
 * keyed by absolute surface path instead of `$Name`.
 */
import type { Entry, SourceLocation } from "../model/mod.ts";
import { assembleUxSurface, type UxElement } from "./assemble.ts";

/** One surface declaration record, with backref to its host entry. */
export interface SurfaceRecord {
  readonly path: string;
  readonly kind: string;
  readonly states: readonly string[];
  readonly owningEntryDisplayId: string;
  readonly owningEntryFile: string;
  readonly elements: readonly UxElement[];
  readonly location: SourceLocation;
}

/**
 * Corpus-wide index. Each surface path maps to ALL declarations found —
 * collisions are NOT collapsed; the validator surfaces duplicate
 * declarations via UXIL-015 (mirrors typl's TYPL-009 treatment).
 */
export interface UxRegistry {
  /** Keyed by absolute surface path (no `ux:` scheme). */
  readonly surfaces: ReadonlyMap<string, readonly SurfaceRecord[]>;
}

/**
 * Build the corpus uxil registry from the entries. Entries whose assembly
 * yields no surfaces are skipped. Source order is preserved within each
 * path's list (first declaration first).
 */
export function buildUxRegistry(entries: readonly Entry[]): UxRegistry {
  const surfaces = new Map<string, SurfaceRecord[]>();

  for (const entry of entries) {
    const tree = assembleUxSurface(entry);
    for (const surface of tree.surfaces) {
      const record: SurfaceRecord = {
        path: surface.path,
        kind: surface.kind,
        states: surface.states,
        owningEntryDisplayId: entry.displayId,
        owningEntryFile: entry.location.file,
        elements: surface.elements,
        location: surface.location,
      };
      const list = surfaces.get(surface.path);
      if (list) list.push(record);
      else surfaces.set(surface.path, [record]);
    }
  }

  return { surfaces };
}
