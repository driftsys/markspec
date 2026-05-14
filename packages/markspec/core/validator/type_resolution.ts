/**
 * @module core/validator/type_resolution
 *
 * Shared helper for resolving an entry's effective core type. Walks
 * the spec §1.3.1 type-resolution chain at the level needed for
 * validator passes (explicit `Type:` → profile-classified `entry.type`
 * → URI scheme inference for Reference-shape entries).
 *
 * Display-ID prefix inference (step 4) and document-directive
 * inference (step 7) are intentionally not consulted here; those have
 * their own dedicated stages (inferTypeFromDisplayIdShape covers step
 * 8 with warning telemetry).
 */

import type { Entry } from "../model/mod.ts";
import { CORE_TYPE_HIERARCHY, inferTypeFromUriScheme } from "../model/mod.ts";

/** Read an entry's explicit `Type:` attribute, trimmed. */
export function explicitType(entry: Entry): string | undefined {
  for (const attr of entry.rawAttributes) {
    if (attr.key === "Type") return attr.value.trim();
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
  if (entry.shape === "referenced" && entry.id) {
    const inferred = inferTypeFromUriScheme(entry.id);
    if (inferred && CORE_TYPE_HIERARCHY[inferred]) return inferred;
  }
  return undefined;
}
