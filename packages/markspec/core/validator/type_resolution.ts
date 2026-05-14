/**
 * @module core/validator/type_resolution
 *
 * Shared helper for resolving an entry's effective core type. Walks
 * the spec §1.3.1 type-resolution chain at the level needed for
 * validator passes:
 *
 *   1. Explicit `Type:` attribute.
 *   2. Profile-classified `entry.type` (set upstream).
 *   3. `Source:` introspection (Cargo.toml → SoftwareComponent,
 *      *.rs → SoftwareUnit, *.proto → SoftwareInterface, …).
 *   4. Authored display-ID prefix (`REQ` / `TST` / `ICD` / `REC` /
 *      `RSK`) → corresponding core Specification subtype.
 *   5. Reference-shape URI scheme inference (ADR-003 §Part 6).
 *   6. Discriminating-attribute presence (Verifies → Test,
 *      Schema-language → Contract, …).
 *
 * Step 7 (document directive) is not consulted here; step 8
 * (display-ID shape) has its own warning-emitting stage in
 * `validator/types.ts` (`inferTypeFromDisplayIdShape`).
 */

import type { Entry } from "../model/mod.ts";
import {
  CORE_TYPE_HIERARCHY,
  inferTypeFromDiscriminatingAttr,
  inferTypeFromSource,
  inferTypeFromUriScheme,
} from "../model/mod.ts";

/**
 * Map from Authored display-ID prefix to the core type the prefix
 * implies (spec §1.3.1 step 4, ADR-003 §Part 1 "Display-ID prefixes").
 * Matched as `<PREFIX><sep><rest>` where `<sep>` is `-` or `_` — the
 * two conventions in widespread use. Case-sensitive: the prefix is
 * part of the canonical-style ID, not a free-form alias.
 */
const DISPLAY_ID_PREFIX_TYPE: ReadonlyMap<string, string> = new Map([
  ["REQ", "Requirement"],
  ["TST", "Test"],
  ["ICD", "Contract"],
  ["REC", "Record"],
  ["RSK", "Risk"],
]);

/**
 * Infer a core type from an Authored entry's display-ID prefix.
 * Returns the type when the display ID starts with one of the
 * recognised prefixes followed by `-` or `_`. Returns `undefined`
 * otherwise.
 *
 * Per spec §1.3.1 this is step 4 of the resolution chain — earlier
 * than late-stage inference at step 8, so a matching prefix does
 * not produce an MSL-T021 warning.
 */
export function inferTypeFromDisplayIdPrefix(
  displayId: string,
): string | undefined {
  for (const [prefix, type] of DISPLAY_ID_PREFIX_TYPE) {
    if (
      displayId.startsWith(prefix) &&
      displayId.length > prefix.length &&
      (displayId[prefix.length] === "-" || displayId[prefix.length] === "_")
    ) {
      return type;
    }
  }
  return undefined;
}

/**
 * Read an entry's explicit `Type:` attribute, trimmed. Returns
 * `undefined` when the attribute is absent OR when the trimmed value
 * is empty — a whitespace-only `Type:` value is treated as "no type
 * given" so downstream diagnostics don't surface empty-quoted values.
 */
export function explicitType(entry: Entry): string | undefined {
  for (const attr of entry.rawAttributes) {
    if (attr.key !== "Type") continue;
    const trimmed = attr.value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }
  return undefined;
}

/** Read an entry's `Source:` attribute, trimmed; empty values yield `undefined`. */
function sourceValue(entry: Entry): string | undefined {
  for (const attr of entry.rawAttributes) {
    if (attr.key !== "Source") continue;
    const trimmed = attr.value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }
  return undefined;
}

/** Which step of the §1.3.1 chain resolved a type. Steps 7 and 8 are
 * not reported here; step 8 has its own warning-emitting stage. */
export type TypeResolutionStep = 1 | 2 | 3 | 4 | 5 | 6;

/** A type together with the step of the §1.3.1 chain that resolved it. */
export interface ResolvedTypeWithProvenance {
  readonly type: string;
  readonly step: TypeResolutionStep;
}

/**
 * Resolve an entry's effective core type and report which step of the
 * spec §1.3.1 chain matched. First match wins. Returns `undefined` when
 * no step in {1..6} resolves to a known core type — callers may then
 * consult late-stage step-8 inference (`inferTypeFromDisplayIdShape`)
 * or treat the entry as unclassified (fallback to `Item`).
 */
export function resolvedCoreTypeWithProvenance(
  entry: Entry,
): ResolvedTypeWithProvenance | undefined {
  // Step 1: explicit Type:
  const explicit = explicitType(entry);
  if (explicit && CORE_TYPE_HIERARCHY[explicit]) {
    return { type: explicit, step: 1 };
  }
  // Step 2: profile-classified entry.type
  if (entry.type && CORE_TYPE_HIERARCHY[entry.type]) {
    return { type: entry.type, step: 2 };
  }
  // Step 3: Source: introspection
  const source = sourceValue(entry);
  if (source !== undefined) {
    const inferred = inferTypeFromSource(source);
    if (inferred && CORE_TYPE_HIERARCHY[inferred]) {
      return { type: inferred, step: 3 };
    }
  }
  // Step 4: Authored display-ID prefix
  if (entry.shape === "identified") {
    const inferred = inferTypeFromDisplayIdPrefix(entry.displayId);
    if (inferred && CORE_TYPE_HIERARCHY[inferred]) {
      return { type: inferred, step: 4 };
    }
  }
  // Step 5: Reference-shape URI scheme
  if (entry.shape === "referenced" && entry.id) {
    const inferred = inferTypeFromUriScheme(entry.id);
    if (inferred && CORE_TYPE_HIERARCHY[inferred]) {
      return { type: inferred, step: 5 };
    }
  }
  // Step 6: Discriminating attribute presence — first matching key wins.
  const attrKeys = entry.rawAttributes.map((a) => a.key);
  const fromDiscriminator = inferTypeFromDiscriminatingAttr(attrKeys);
  if (fromDiscriminator && CORE_TYPE_HIERARCHY[fromDiscriminator]) {
    return { type: fromDiscriminator, step: 6 };
  }
  return undefined;
}

/**
 * Resolve an entry's effective core type without provenance. Convenience
 * wrapper around {@linkcode resolvedCoreTypeWithProvenance} for callers
 * that don't need to know which step matched.
 *
 * Returns `undefined` when no step in {1..6} resolves to a known core
 * type. The caller decides whether to skip validation, fall back to a
 * less specific check, or report on the unclassified state.
 */
export function resolvedCoreType(entry: Entry): string | undefined {
  return resolvedCoreTypeWithProvenance(entry)?.type;
}
