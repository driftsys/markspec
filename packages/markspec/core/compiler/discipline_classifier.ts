/**
 * @module core/compiler/discipline_classifier
 *
 * Pure-function classifier implementing channels 3 (type-based) and 4
 * (allocation-based) of the four-channel discipline resolution from
 * ADR-017 Invariant 1, plus the default fallback to `"system"`.
 *
 * **Channels 1 (override) and 2 (freeze) are not implemented in this
 * slice.** They ship in Slice 3 (`Discipline:` and `Discipline-frozen:`
 * attributes). When those land, the classifier will read them first;
 * for now the function jumps straight to channel 3.
 *
 * @see docs/architecture/adr-017-discipline-classification.md (Invariant 1)
 * @see docs/architecture/adr-018-core-discipline-ssot.md (R3)
 */

import { makeDisplayId, MIXED_DISCIPLINE } from "../mod.ts";
import type {
  Discipline,
  DisciplineRegistry,
  DisplayId,
  Entry,
} from "../mod.ts";

/**
 * Resolve an entry's type, falling back to the `Type:` raw attribute when
 * the profile classifier hasn't populated `entry.type`. This keeps the
 * discipline classifier working when `compile()` runs without a profile
 * (e.g., bare `markspec compile` against a minimal `project.yaml`). The
 * profile classifier (compiler Phase 2.5) is the authoritative source
 * when a profile is loaded; this fallback only kicks in when it didn't
 * run.
 */
function resolvedType(entry: Entry): string | undefined {
  if (entry.type) return entry.type;
  for (const attr of entry.rawAttributes) {
    if (attr.key === "Type") {
      const trimmed = attr.value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
}

/**
 * Resolve the discipline of `entry` against `registry`, using channels
 * 3 (type-based) and 4 (allocation-based) in precedence order, defaulting
 * to `"system"` when neither channel yields a kind.
 *
 * @param entry The entry to classify.
 * @param entriesByDisplayId Lookup map used by channel 4 to resolve
 *   `Allocated-to` targets. Pass the compiler's Phase 3 entries map.
 * @param registry The discipline registry to consult for type → kind
 *   lookups. Pass {@linkcode CORE_DISCIPLINE_REGISTRY} unless a Slice 2+
 *   profile-extended registry is available.
 */
export function classifyDiscipline(
  entry: Entry,
  entriesByDisplayId: ReadonlyMap<DisplayId, Entry>,
  registry: DisciplineRegistry,
): Discipline {
  // Channel 3: type-based.
  const type = resolvedType(entry);
  if (type !== undefined) {
    const kind = registry.get(type);
    if (kind !== undefined) return kind;
  }

  // Channel 4: allocation-based. Collect every distinct discipline reached
  // through Allocated-to targets; one kind → that kind; multiple kinds →
  // MIXED_DISCIPLINE; zero kinds → fall through to default.
  const seen = new Set<Discipline>();
  for (const attr of entry.rawAttributes) {
    if (attr.key !== "Allocated-to") continue;
    // ADR-002: id-list attribute. CSV-split on commas.
    for (const raw of attr.value.split(",")) {
      const token = raw.trim();
      if (token.length === 0) continue;
      const target = entriesByDisplayId.get(makeDisplayId(token));
      if (!target) continue;
      const targetType = resolvedType(target);
      if (targetType === undefined) continue;
      const kind = registry.get(targetType);
      if (kind !== undefined) seen.add(kind);
    }
  }
  if (seen.size === 1) {
    for (const kind of seen) return kind;
  }
  if (seen.size > 1) return MIXED_DISCIPLINE;

  // Default.
  return "system";
}
