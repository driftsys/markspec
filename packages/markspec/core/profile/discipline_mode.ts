/**
 * @module core/profile/discipline_mode
 *
 * Discipline-mode resolution per ADR-017 Slice 5.
 *
 * Three exported helpers:
 *   - `extendsTransitively(name, target, effective)` — walk profile-side
 *     extends chain then core-side type hierarchy looking for an ancestor.
 *     Reused by Tasks 7 (LSP) and 8 (CLI create) for the "is this type
 *     requirement-shaped?" check.
 *   - `inferDisciplineMode(effective)` — derive the mode from the merged
 *     profile's type graph when no tier declared one.
 *   - `resolveDisciplineMode(effective, declared)` — return the declared
 *     value when supplied (with `origin: "declared"`), otherwise call
 *     `inferDisciplineMode()` and wrap with `origin: "inferred"`.
 *
 * Sits next to `discipline_registry.ts` (Slice 2). Both are profile-layer
 * post-merge resolvers that consume a fully-folded `EffectiveProfile`.
 *
 * @see docs/architecture/adr-017-discipline-classification.md (item 8)
 * @see docs/superpowers/specs/2026-05-25-discipline-mode-flag-and-ux-design.md
 */

import type {
  CoreTypeDef,
  DisciplineMode,
  EffectiveProfile,
  EffectiveTypeDef,
  ProfileId,
  ProvenancedValue,
} from "../model/mod.ts";
import { CORE_TYPE_HIERARCHY } from "../model/type_hierarchy.ts";

/**
 * Walk a type's extends chain (profile-side first, then core hierarchy)
 * and return `true` if `targetCoreType` is transitively an ancestor.
 *
 * Profile-declared types extend other profile types or core types; the
 * walk goes through `effective.types.get(name).extends` until it hits a
 * name that's not in the profile's types map. From there, walk the
 * `CORE_TYPE_HIERARCHY` parent chain.
 *
 * Exported because Tasks 7 (LSP) and 8 (CLI create) reuse the same walk
 * to decide whether a type is "requirement-shaped" for mode-recommended
 * marking.
 */
export function extendsTransitively(
  startTypeName: string,
  targetCoreType: string,
  effective: EffectiveProfile,
): boolean {
  let cursor: string | null = startTypeName;
  const seen = new Set<string>();
  // Profile-side walk.
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    if (cursor === targetCoreType) return true;
    const profileType = effective.types.get(cursor);
    if (profileType) {
      cursor = profileType.value.extends;
      continue;
    }
    // Cursor isn't a profile type — must be a core type. Switch to
    // CORE_TYPE_HIERARCHY walk.
    break;
  }
  // Core-side walk.
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    if (cursor === targetCoreType) return true;
    const coreDef: CoreTypeDef | undefined = CORE_TYPE_HIERARCHY[cursor];
    if (!coreDef) return false;
    cursor = coreDef.parent;
  }
  return false;
}

/**
 * Per spec §Inference algorithm:
 *   1. tiered if any profile-declared requirement-shaped type has discipline: set
 *   2. flat   if no tiered requirement types AND the profile contributes any
 *             discipline-bearing types (profile-extended kinds OR profile-declared
 *             types that map to a core discipline-bearing type OR any requirement-
 *             shaped profile-declared type)
 *   3. none   otherwise (truly empty profile)
 *
 * Per spec edge case: the core CORE_DISCIPLINE_REGISTRY is ALWAYS present,
 * but this helper treats core-only as "no profile signal" — the profile
 * must contribute something for the result to be "flat" rather than "none".
 * This matches the spec example table's outcomes.
 */
export function inferDisciplineMode(
  effective: EffectiveProfile,
): DisciplineMode {
  // Step 1: scan profile-declared types for requirement-shaped types with discipline:.
  for (const [typeName, entry] of effective.types) {
    const td: EffectiveTypeDef = entry.value;
    if (td.discipline.value === undefined) continue;
    if (extendsTransitively(typeName, "Requirement", effective)) {
      return "tiered";
    }
  }

  // Step 2a: flat if the profile contributes any extended kinds.
  if (effective.kinds.size > 0) return "flat";

  // Step 2b: flat if any profile-declared type extends a core discipline-
  // bearing type (SoftwareComponent etc.).
  const CORE_DISCIPLINE_BEARING_TYPES = [
    "SoftwareComponent",
    "HardwareComponent",
    "SoftwareInterface",
    "HardwareInterface",
    "SoftwareUnit",
    "HardwareUnit",
  ];
  for (const [typeName, _entry] of effective.types) {
    for (const coreType of CORE_DISCIPLINE_BEARING_TYPES) {
      if (extendsTransitively(typeName, coreType, effective)) {
        return "flat";
      }
    }
  }

  // Step 2c: flat if the profile declares any requirement-shaped type
  // (even without discipline:). This means the profile is doing
  // requirements work, but tiered signal is absent.
  for (const [typeName, _entry] of effective.types) {
    if (extendsTransitively(typeName, "Requirement", effective)) {
      return "flat";
    }
  }

  // Step 3: none — no profile contribution.
  return "none";
}

/**
 * Resolve the effective discipline mode for a merged profile.
 *
 * If `declared` is supplied (any tier set `discipline-mode:`), wrap it
 * with `origin: "declared"`. Otherwise run inference and wrap with
 * `origin: "inferred"`.
 */
export function resolveDisciplineMode(
  effective: EffectiveProfile,
  declared: { value: DisciplineMode; origin: ProfileId } | undefined,
): ProvenancedValue<DisciplineMode> {
  if (declared !== undefined) {
    return { value: declared.value, origin: "declared" };
  }
  return { value: inferDisciplineMode(effective), origin: "inferred" };
}
