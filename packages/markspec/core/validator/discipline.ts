/**
 * @module core/validator/discipline
 *
 * Discipline-attribute validator per ADR-017 Slice 3. Emits seven codes:
 *
 *   - MSL-T025 — `Discipline:` value not in the effective kind set (error)
 *   - MSL-T026 — `Discipline-frozen:` value malformed (error)
 *   - MSL-T027 — `Discipline-frozen:` kind not in the effective set (error)
 *   - MSL-T028 — `Discipline:` conflicts with channel-3 derivation (warning)
 *   - MSL-T029 — `Discipline:` conflicts with channel-4 derivation (warning)
 *   - MSL-T030 — `Discipline-frozen:` differs from current derivation (warning)
 *   - MSL-T031 — `Discipline:` and `Discipline-frozen:` disagree (warning)
 *
 * The effective kind set used by T025/T027 is `CORE_KINDS` plus any kinds
 * the active profile chain declared via `profile.kinds:` (Slice 2's
 * effective registry).
 *
 * Tasks 5–8 of the plan add T026–T031 incrementally on top of this skeleton.
 */

import type {
  Diagnostic,
  DisciplineRegistry,
  DisplayId,
  Entry,
} from "../model/mod.ts";
import {
  CORE_KINDS,
  isUpstreamEntry,
  makeDisplayId,
  MIXED_DISCIPLINE,
} from "../model/mod.ts";
import {
  classifyDerivationOnly,
  parseFrozenValue,
} from "../compiler/discipline_classifier.ts";

/**
 * Read the first non-empty value of a single-cardinality attribute. Mirrors
 * the helper in the classifier so the validator doesn't need to import it.
 */
function singleAttrValue(entry: Entry, key: string): string | undefined {
  for (const attr of entry.rawAttributes) {
    if (attr.key === key) {
      const trimmed = attr.value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
}

/**
 * Build the effective kind set from `CORE_KINDS` plus every type → kind
 * value the registry contains.
 */
function effectiveKindSet(registry: DisciplineRegistry): Set<string> {
  const set = new Set<string>(CORE_KINDS);
  for (const kind of registry.values()) set.add(kind);
  return set;
}

/**
 * Compute channel-3 alone for an entry — what the type-based registry
 * lookup would yield. Returns `undefined` when no type or unknown type.
 */
function channel3Kind(
  entry: Entry,
  registry: DisciplineRegistry,
): string | undefined {
  if (entry.type === undefined) {
    // Fallback: look at the raw Type: attribute (mirrors resolvedType()
    // in the classifier so the validator works in core-only mode).
    for (const attr of entry.rawAttributes) {
      if (attr.key === "Type") {
        const trimmed = attr.value.trim();
        if (trimmed.length > 0) return registry.get(trimmed);
      }
    }
    return undefined;
  }
  return registry.get(entry.type);
}

/**
 * Compute channel-4 alone for an entry — walk Allocated-to targets,
 * return the unique discipline if one, MIXED_DISCIPLINE if many,
 * `undefined` if none.
 */
function channel4Kind(
  entry: Entry,
  entriesByDisplayId: ReadonlyMap<DisplayId, Entry>,
  registry: DisciplineRegistry,
): string | undefined {
  const seen = new Set<string>();
  for (const attr of entry.rawAttributes) {
    if (attr.key !== "Allocated-to") continue;
    for (const raw of attr.value.split(",")) {
      const token = raw.trim();
      if (token.length === 0) continue;
      const target = entriesByDisplayId.get(makeDisplayId(token));
      if (!target) continue;
      const targetType = target.type ??
        target.rawAttributes.find((a) => a.key === "Type")?.value.trim();
      if (!targetType) continue;
      const kind = registry.get(targetType);
      if (kind !== undefined) seen.add(kind);
    }
  }
  if (seen.size === 0) return undefined;
  if (seen.size === 1) return [...seen][0];
  return MIXED_DISCIPLINE;
}

/**
 * Validate the `Discipline:` and `Discipline-frozen:` attributes across
 * every entry. Pure function: takes the entries, a lookup map (used by
 * later tasks for channel-4 derivation), and the effective registry.
 *
 * @param entries Entries to walk.
 * @param entriesByDisplayId Lookup map for channel-4 derivation. Tasks 5–8
 *   will use this; Task 4 ignores it but keeps the parameter to fix the
 *   signature now.
 * @param registry Effective discipline registry from Slice 2's
 *   `buildEffectiveDisciplineRegistry()`, or `CORE_DISCIPLINE_REGISTRY` in
 *   core-only mode.
 */
export function validateDiscipline(
  entries: readonly Entry[],
  entriesByDisplayId: ReadonlyMap<DisplayId, Entry>,
  registry: DisciplineRegistry,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const knownKinds = effectiveKindSet(registry);

  for (const entry of entries) {
    // Upstream entries (federated-upstream epic) are validation-exempt
    // emitters (design §4.7) — skip discipline checks sourced from an
    // upstream entry. `entriesByDisplayId` still includes them for
    // channel-4 (Allocated-to) derivation on project entries.
    if (isUpstreamEntry(entry)) continue;

    const override = singleAttrValue(entry, "Discipline");
    if (override !== undefined && !knownKinds.has(override)) {
      out.push({
        code: "MSL-T025",
        severity: "error",
        message:
          `${entry.displayId}: Discipline: '${override}' is not a known kind (declare it under profile.kinds: or use a core kind: ${
            [...CORE_KINDS].join(" / ")
          })`,
        location: entry.location,
      });
    }

    const frozen = singleAttrValue(entry, "Discipline-frozen");
    if (frozen !== undefined) {
      const parsed = parseFrozenValue(frozen);
      if (parsed === undefined) {
        out.push({
          code: "MSL-T026",
          severity: "error",
          message:
            `${entry.displayId}: Discipline-frozen: '${frozen}' is malformed (expected '<kind>' or '<kind> @ YYYY-MM-DD'; kind must match /^[a-z][a-z0-9-]*$/; date must be calendar-valid)`,
          location: entry.location,
        });
      } else if (!knownKinds.has(parsed.kind)) {
        out.push({
          code: "MSL-T027",
          severity: "error",
          message:
            `${entry.displayId}: Discipline-frozen: kind '${parsed.kind}' is not a known kind (declare it under profile.kinds: or use a core kind: ${
              [...CORE_KINDS].join(" / ")
            })`,
          location: entry.location,
        });
      }
    }

    // T028 / T029: override vs channel-3 / channel-4 conflicts. Only run
    // when the override is well-formed (suppressed by T025) and a channel
    // actually produced a kind (default-system suppression).
    if (override !== undefined && knownKinds.has(override)) {
      const c3 = channel3Kind(entry, registry);
      if (c3 !== undefined && c3 !== override) {
        out.push({
          code: "MSL-T028",
          severity: "warning",
          message:
            `${entry.displayId}: Discipline: '${override}' conflicts with type-based derivation '${c3}' (from Type: ${
              entry.type ?? "(raw)"
            })`,
          location: entry.location,
        });
      }
      const c4 = channel4Kind(entry, entriesByDisplayId, registry);
      if (c4 !== undefined && c4 !== override) {
        out.push({
          code: "MSL-T029",
          severity: "warning",
          message:
            `${entry.displayId}: Discipline: '${override}' conflicts with allocation-based derivation '${c4}' (via Allocated-to)`,
          location: entry.location,
        });
      }
    }

    // T030: freeze divergence. Runs whenever the freeze is well-formed
    // and references a known kind — NOT suppressed by default-system
    // derivation (drift from a known kind to default-system is exactly
    // what freeze is designed to surface).
    if (frozen !== undefined) {
      const parsedF = parseFrozenValue(frozen);
      if (parsedF !== undefined && knownKinds.has(parsedF.kind)) {
        const current = classifyDerivationOnly(
          entry,
          entriesByDisplayId,
          registry,
        );
        if (current !== parsedF.kind) {
          out.push({
            code: "MSL-T030",
            severity: "warning",
            message:
              `${entry.displayId}: Discipline-frozen: '${parsedF.kind}' differs from current derivation '${current}' (something changed since the freeze on ${
                parsedF.date ?? "(no date)"
              })`,
            location: entry.location,
          });
        }
      }
    }

    // T031: override vs freeze disagreement. Both must be well-formed
    // and reference known kinds — otherwise upstream errors (T025/T026/T027)
    // handle the case.
    if (
      override !== undefined &&
      knownKinds.has(override) &&
      frozen !== undefined
    ) {
      const parsedF = parseFrozenValue(frozen);
      if (parsedF !== undefined && knownKinds.has(parsedF.kind)) {
        if (override !== parsedF.kind) {
          out.push({
            code: "MSL-T031",
            severity: "warning",
            message:
              `${entry.displayId}: Discipline: '${override}' disagrees with Discipline-frozen: '${parsedF.kind}' (the override wins for derivedDiscipline; remove or update the freeze if the override is intentional)`,
            location: entry.location,
          });
        }
      }
    }
  }
  return out;
}
