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

import type {
  AttrDecl,
  Diagnostic,
  EffectiveProfile,
  Entry,
} from "../model/mod.ts";
import { UNIVERSAL_ATTRIBUTE_KEYS } from "../model/mod.ts";
import { validateValue } from "./value_types.ts";

/** Core-reserved attribute keys that are always permitted regardless of profile. */
const CORE_RESERVED_KEYS: ReadonlySet<string> = new Set([
  "Id",
  "Type",
  ...UNIVERSAL_ATTRIBUTE_KEYS,
]);

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

/**
 * Run Stage 3 structural + value-type checks for one entry. Returns all
 * diagnostics the entry produced.
 *
 * Task 6.2 ships required / cardinality / unknown checks. Task 6.6 wires in
 * value-type conformance (MSL-A004) through the value-types registry.
 */
export function validateAttributesForEntry(
  entry: Entry,
  profile: EffectiveProfile,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const scope = effectiveScope(entry, profile);
  const present = entry.typedAttributes ?? new Map<string, readonly string[]>();

  // MSL-A001: required attribute missing.
  for (const name of scope.required) {
    if (!present.has(name)) {
      diagnostics.push({
        code: "MSL-A001",
        severity: "error",
        message: `${entry.displayId}: required attribute '${name}' is missing`,
        location: entry.location,
      });
    }
  }

  // Iterate attributes present on the entry.
  for (const [name, values] of present) {
    const decl = scope.attributes.get(name);

    if (decl === undefined) {
      // MSL-A005: unknown attribute (warn). Skip core-reserved keys.
      if (!CORE_RESERVED_KEYS.has(name)) {
        diagnostics.push({
          code: "MSL-A005",
          severity: "warning",
          message:
            `${entry.displayId}: attribute '${name}' is not declared in the profile scope`,
          location: entry.location,
        });
      }
      continue;
    }

    // MSL-A002: upper cardinality.
    if (values.length > decl.cardinality.upper) {
      diagnostics.push({
        code: "MSL-A002",
        severity: "error",
        message:
          `${entry.displayId}: attribute '${name}' has ${values.length} values ` +
          `but max is ${formatUpper(decl.cardinality.upper)}`,
        location: entry.location,
      });
    }

    // MSL-A003: lower cardinality (only when attribute is present).
    if (values.length < decl.cardinality.lower) {
      diagnostics.push({
        code: "MSL-A003",
        severity: "error",
        message:
          `${entry.displayId}: attribute '${name}' has ${values.length} values ` +
          `but min is ${decl.cardinality.lower}`,
        location: entry.location,
      });
    }

    // MSL-A004: value-type conformance.
    for (const v of values) {
      const detail = validateValue(v, decl);
      if (detail !== null) {
        diagnostics.push({
          code: "MSL-A004",
          severity: "error",
          message:
            `${entry.displayId}: attribute '${name}' has invalid value: ${detail}`,
          location: entry.location,
        });
        break; // one diagnostic per attribute is enough
      }
    }
  }

  return diagnostics;
}

function formatUpper(u: number): string {
  return u === Infinity ? "N" : String(u);
}
