/**
 * @module core/validator/type_resolution
 *
 * Shared helper for resolving an entry's effective core type. Walks
 * the spec §1.3.1 type-resolution chain at the level needed for
 * validator passes:
 *
 *   1. Explicit `Type:` attribute.
 *   2. Profile-classified `entry.type` (set upstream).
 *   4. Authored display-ID prefix (`REQ` / `TST` / `ICD` / `REC` /
 *      `RSK`) → corresponding core Specification subtype.
 *   5. Reference-shape URI scheme inference (ADR-003 §Part 6).
 *
 * Step 3 (`Source:` introspection), step 6 (discriminating attribute),
 * and step 7 (document directive) are not consulted here; step 8
 * (display-ID shape) has its own warning-emitting stage in
 * `validator/types.ts` (`inferTypeFromDisplayIdShape`).
 */

import type { Entry } from "../model/mod.ts";
import { CORE_TYPE_HIERARCHY, inferTypeFromUriScheme } from "../model/mod.ts";

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

/**
 * Resolve an entry's effective core type. Tries (in order):
 *
 *   1. Explicit `Type:` attribute.
 *   2. Profile-classified `entry.type` (set upstream when a profile
 *      is loaded).
 *   3. URI-scheme inference for Reference-shape entries
 *      (ADR-003 §Part 6 — Reference entry only).
 *
 * Returns `undefined` when none of the sources resolves to a core
 * type. The caller decides whether to skip validation, fall back to a
 * less specific check, or report on the unclassified state.
 */
export function resolvedCoreType(entry: Entry): string | undefined {
  const explicit = explicitType(entry);
  if (explicit && CORE_TYPE_HIERARCHY[explicit]) return explicit;
  if (entry.type && CORE_TYPE_HIERARCHY[entry.type]) return entry.type;
  // Step 4: Authored display-ID prefix.
  if (entry.shape === "identified") {
    const inferred = inferTypeFromDisplayIdPrefix(entry.displayId);
    if (inferred && CORE_TYPE_HIERARCHY[inferred]) return inferred;
  }
  // Step 5: Reference-shape URI scheme.
  if (entry.shape === "referenced" && entry.id) {
    const inferred = inferTypeFromUriScheme(entry.id);
    if (inferred && CORE_TYPE_HIERARCHY[inferred]) return inferred;
  }
  return undefined;
}
