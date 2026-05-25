/**
 * @module core/profile/discipline_registry
 *
 * Build an effective discipline registry from a merged
 * {@linkcode EffectiveProfile}. Per ADR-017 Slice 2: the registry is
 * the core seed plus every profile-declared type whose discipline
 * resolves — either directly (an explicit `discipline:` field) or
 * via auto-inheritance walking the `extends:` chain to a registered
 * ancestor.
 *
 * The current manifest parser only allows profile-declared types to
 * extend **core** types (see `parseTypeDef` in `manifest.ts`), so the
 * inheritance walk is one step in practice. The implementation below
 * loops defensively so future relaxation of that constraint doesn't
 * silently break inheritance through profile-declared intermediates.
 * Cycles are currently impossible because the parser rejects any
 * `extends` value that is not a recognised core type (PROFILE-TYPE-002),
 * guaranteeing the fixed-point loop terminates in exactly one pass
 * today.
 *
 * @see docs/architecture/adr-017-discipline-classification.md (Invariant 2)
 */

import {
  CORE_DISCIPLINE_REGISTRY,
  type Discipline,
  type DisciplineRegistry,
  type EffectiveProfile,
} from "../model/mod.ts";

/**
 * Build the effective discipline registry for a given (merged) profile.
 * When `effective` is `null` (CLI run without a profile), the core seed
 * is returned verbatim.
 *
 * Algorithm:
 *   1. Start with a mutable copy of {@linkcode CORE_DISCIPLINE_REGISTRY}.
 *   2. For each profile-declared type, resolve its discipline:
 *      - Use the explicit `discipline.value` when present.
 *      - Otherwise walk `extends:` one hop at a time, stopping at the
 *        first ancestor that resolves (core registry or already-resolved
 *        profile type).
 *   3. Iterate until no new entries are added (handles arbitrary
 *      declaration order). Bounded by the number of profile types, so
 *      worst-case O(n²); n is small for realistic profiles.
 */
export function buildEffectiveDisciplineRegistry(
  effective: EffectiveProfile | null,
): DisciplineRegistry {
  const out = new Map<string, Discipline>(CORE_DISCIPLINE_REGISTRY);
  if (!effective) return out;

  // Resolve in fixed-point fashion so order-of-declaration doesn't matter.
  // Each pass attempts every unresolved type; if any type resolves, do
  // another pass.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [typeName, entry] of effective.types) {
      if (out.has(typeName)) continue;
      const explicit = entry.value.discipline.value;
      if (explicit !== undefined) {
        out.set(typeName, explicit);
        changed = true;
        continue;
      }
      const inherited = out.get(entry.value.extends);
      if (inherited !== undefined) {
        out.set(typeName, inherited);
        changed = true;
      }
    }
  }
  return out;
}
