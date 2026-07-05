/**
 * @module uxil/projection
 *
 * Deterministic machine projection of a {@linkcode UxRegistry} (S8 #726):
 * the seam downstream codegen (and the S11 payload bridge) build on. Pure
 * transform — no timestamps or run metadata, every collection sorted by a
 * stable key so `projectUxRegistry(registry)` is byte-identical across
 * runs. A duplicated surface id uses only its first-declared record
 * (mirrors the first-declaration-wins convention used elsewhere in S8);
 * the duplicate itself is a separate validator concern (UXIL-015).
 */
import type { SurfaceRecord, UxRegistry } from "./registry.ts";

/** One projected interaction element. */
export interface ProjectedElement {
  readonly name: string;
  readonly verbs: readonly string[];
  readonly keyTemplate: string | null;
  readonly nav: string | null;
  readonly states: readonly string[];
}

/** One projected surface. */
export interface ProjectedSurface {
  readonly id: string;
  readonly kind: string;
  readonly states: readonly string[];
  readonly parent: string | null;
  readonly elements: readonly ProjectedElement[];
}

/** The full deterministic projection. */
export interface UxProjection {
  readonly surfaces: readonly ProjectedSurface[];
}

function projectElement(
  element: SurfaceRecord["elements"][number],
): ProjectedElement {
  return {
    name: element.name,
    verbs: element.verbs,
    // keyTemplate is always the "template" form — parseElementBullet only
    // ever assigns a UxKey here when it parsed as `{name}` (grammar.ts's K1
    // clause), never a concrete key.
    keyTemplate: element.keyTemplate?.kind === "template"
      ? element.keyTemplate.name
      : null,
    nav: element.navTarget ?? null,
    states: [...element.states].sort(),
  };
}

/**
 * Project a {@linkcode UxRegistry} into a deterministic, JSON-serialisable
 * manifest. Surfaces sorted by id; elements within a surface sorted by
 * name; states sorted; verbs kept in declaration order (still
 * deterministic — load-bearing for compound controls).
 */
export function projectUxRegistry(registry: UxRegistry): UxProjection {
  const paths = [...registry.surfaces.keys()].sort();
  const surfaces: ProjectedSurface[] = paths.map((path) => {
    const record = registry.surfaces.get(path)![0]; // first declaration wins
    const dot = path.lastIndexOf(".");
    const parentPath = dot < 0 ? undefined : path.slice(0, dot);
    const parent = parentPath !== undefined && registry.surfaces.has(parentPath)
      ? parentPath
      : null;
    return {
      id: path,
      kind: record.kind,
      states: [...record.states].sort(),
      parent,
      elements: [...record.elements]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(projectElement),
    };
  });
  return { surfaces };
}
