/**
 * @module core/compiler/discipline_classifier
 *
 * Pure-function classifier implementing the four-channel discipline
 * resolution from ADR-017 Invariant 1, plus the default fallback to
 * `"system"`. Channels in precedence order:
 *
 *   1. Override — `Discipline:` attribute (lenient; emits value verbatim)
 *   2. Freeze   — `Discipline-frozen:` attribute (strict; falls through
 *                 to channel 3 on parse failure)
 *   3. Type-based — `entry.type` looked up in the registry
 *   4. Allocation-based — `Allocated-to` targets' types looked up
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
 * Read the first non-empty value of a single-cardinality attribute from an
 * entry's raw attributes. Returns `undefined` when absent or empty. Used
 * by channels 1 and 2.
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
 * Parse a `Discipline-frozen:` value. Accepts `<kind>` or `<kind> @
 * <YYYY-MM-DD>` with optional whitespace around `@`. The date component,
 * when present, must be calendar-valid (rejects `2026-02-30`, etc.).
 *
 * Returns `{ kind }` on success or `undefined` when the value doesn't
 * match the grammar. The classifier uses this in channel 2 (strict — a
 * malformed value falls through to channel 3 rather than emitting
 * garbage). The validator uses the same parse to decide MSL-T026.
 */
export function parseFrozenValue(
  value: string,
): { readonly kind: string; readonly date?: string } | undefined {
  const m = /^([a-z][a-z0-9-]*)(?:\s*@\s*(\d{4}-\d{2}-\d{2}))?\s*$/.exec(
    value.trim(),
  );
  if (!m) return undefined;
  const kind = m[1];
  const date = m[2];
  if (date !== undefined) {
    // Calendar-validity round-trip: parsing and reformatting must yield
    // the exact same string. Rejects 2026-02-30 / 2026-13-99 / 2026-00-15.
    const d = new Date(`${date}T00:00:00Z`);
    if (isNaN(d.getTime())) return undefined;
    const round = d.toISOString().slice(0, 10);
    if (round !== date) return undefined;
  }
  return date !== undefined ? { kind, date } : { kind };
}

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
 * Resolve the discipline of `entry` against `registry`, using all four
 * channels in precedence order (1 override > 2 freeze > 3 type-based >
 * 4 allocation-based), defaulting to `"system"` when no channel yields
 * a kind.
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
  // Channel 1: override (lenient on unknown kinds — emit verbatim).
  const override = singleAttrValue(entry, "Discipline");
  if (override !== undefined) return override;

  // Channel 2: freeze (strict on malformed values — fall through on parse
  // failure). The validator (MSL-T026) emits the error separately.
  const frozen = singleAttrValue(entry, "Discipline-frozen");
  if (frozen !== undefined) {
    const parsed = parseFrozenValue(frozen);
    if (parsed !== undefined) return parsed.kind;
    // fall through to channel 3
  }

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

/**
 * Run channels 3 + 4 + default only — skip channels 1 (override) and 2
 * (freeze). Used by the validator (Slice 3) to compute "what would the
 * derivation be without the author's override?" so it can detect
 * MSL-T028 (override vs type-based) and MSL-T029 (override vs
 * allocation-based) conflicts and MSL-T030 (freeze divergence) without
 * the override / freeze masking the channel-3/4 result.
 */
export function classifyDerivationOnly(
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

  // Channel 4: allocation-based.
  const seen = new Set<Discipline>();
  for (const attr of entry.rawAttributes) {
    if (attr.key !== "Allocated-to") continue;
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

  return "system";
}
