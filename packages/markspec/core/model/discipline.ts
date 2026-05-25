/**
 * @module core/model/discipline
 *
 * Discipline classification primitives per ADR-017 Invariants 1 and 2 and
 * ADR-018 R3. The discipline of an entry is one of a small set of "kinds"
 * (`software`, `hardware`, `system`, plus profile-declared extensions).
 *
 * The {@linkcode CORE_DISCIPLINE_REGISTRY} maps the six core SW/HW
 * Component / Interface / Unit subtypes to their kind. Profiles will later
 * extend this registry with their own type → kind mappings (Slice 2; not in
 * this module — Slice 2 will introduce a merge function on top).
 *
 * Authors never type a kind name directly. Discipline is resolved by the
 * classifier (see `core/compiler/discipline_classifier.ts`) via four
 * channels in precedence order: override → freeze → type-based →
 * allocation-based → default `system`. This module supports channels 3
 * (type-based) and 4 (allocation-based); override and freeze are Slice 3.
 */

/**
 * A discipline kind. `string` rather than a closed union because profiles
 * may register new kinds (e.g. `firmware`, `mechanical`, `avionics`) per
 * ADR-017 Invariant 2. Validity is enforced at registration time, not in
 * the type system.
 */
export type Discipline = string;

/**
 * The built-in kinds shipped by core. Profiles may add to this set via the
 * `kinds:` block in their manifest (Slice 2).
 */
export const CORE_KINDS: ReadonlySet<Discipline> = new Set<Discipline>([
  "system",
  "software",
  "hardware",
]);

/**
 * Sentinel value emitted by the classifier when channel 4 (allocation-based)
 * sees `Allocated-to` targets resolving to more than one distinct kind.
 * **Not** a registerable kind — `CORE_KINDS.has(MIXED_DISCIPLINE)` is
 * `false` by design. The validator (Slice 4) will surface this as an error
 * in flat profiles.
 */
export const MIXED_DISCIPLINE: Discipline = "mixed";

/**
 * A discipline registry: type-name → kind mapping. Read-only at the type
 * level; the core seed is frozen. Slice 2 will introduce a builder that
 * merges core seed + profile extensions into an effective registry.
 */
export type DisciplineRegistry = ReadonlyMap<string, Discipline>;

/**
 * The built-in core registry, seeded with the six SW/HW Component /
 * Interface / Unit subtypes from ADR-003 §Part 1. Parent types
 * (`Component`, `Interface`, `Unit`) are intentionally absent — they are
 * not discipline-bearing; the classifier walks `Allocated-to` to a
 * concrete subtype.
 */
export const CORE_DISCIPLINE_REGISTRY: DisciplineRegistry = new Map<
  string,
  Discipline
>([
  ["SoftwareComponent", "software"],
  ["HardwareComponent", "hardware"],
  ["SoftwareInterface", "software"],
  ["HardwareInterface", "hardware"],
  ["SoftwareUnit", "software"],
  ["HardwareUnit", "hardware"],
]);
