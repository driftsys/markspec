/**
 * @module core/validator/attributes
 *
 * Validator Stage 3 — typed attribute validation.
 *
 * Runs after Stage 2 classification. For each entry, computes the effective
 * attribute scope (universal ∪ shape ∪ type) and checks:
 *   - Required presence (MSL-A001)
 *   - Cardinality (MSL-A002 upper / MSL-A003 lower)
 *   - Value-type conformance (MSL-A004, delegated to value_types.ts)
 *   - Unknown attributes (MSL-A005 warning)
 */

import type { AttrDecl, EffectiveProfile, Entry } from "../model/mod.ts";

/**
 * Effective attribute declarations and required list for an entry, derived
 * from the profile's universal, shape, and (when classified) type scopes.
 *
 * Scope layering (outer → inner):
 *   universal → shape.identified/referenced → types.<T>
 *
 * Name collisions: inner scope wins. Required lists are concatenated in
 * scope order (universal first, type last) preserving duplicates across
 * tiers — consumers should treat them as a set.
 */
export interface EffectiveAttrScope {
  readonly required: readonly string[];
  readonly attributes: ReadonlyMap<string, AttrDecl>;
}

/**
 * Compute the effective attribute scope for a given entry against the
 * profile. Uses universal + shape scope always; adds type scope only when
 * `entry.type` is set and the type is declared in the profile.
 */
export function effectiveScope(
  entry: Entry,
  profile: EffectiveProfile,
): EffectiveAttrScope {
  const required: string[] = [];
  const attributes = new Map<string, AttrDecl>();

  // Universal scope.
  required.push(...profile.required.value);
  for (const [name, attrEntry] of profile.attributes) {
    attributes.set(name, attrEntry.value);
  }

  // Shape scope.
  const shapeScope = entry.shape === "identified"
    ? profile.identified
    : profile.referenced;
  required.push(...shapeScope.required.value);
  for (const [name, e] of shapeScope.attributes) {
    attributes.set(name, e.value);
  }

  // Type scope (only when classified).
  if (entry.type !== undefined) {
    const typeEntry = profile.types.get(entry.type);
    if (typeEntry !== undefined) {
      required.push(...typeEntry.value.required.value);
      for (const [name, e] of typeEntry.value.attributes) {
        attributes.set(name, e.value);
      }
    }
  }

  return { required, attributes };
}
