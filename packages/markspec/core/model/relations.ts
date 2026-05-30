/**
 * @module model/relations
 *
 * Single source of truth for core trace-relation metadata. Each consumer
 * (compiler link production, validator target rules, lockfile edge extraction)
 * PROJECTS the facet it needs from CORE_RELATIONS rather than hand-listing
 * relations — see ADR-024's "four duplicated lists" follow-up.
 *
 * This is the CORE relation set only. Profile-declared relations/inverses and
 * the runtime inverse-generation path are separate and extend this at runtime.
 */

import type { LinkKind } from "./mod.ts";

/** Intrinsic facts about one core trace relation. Facet PRESENCE drives each
 * consumer's membership. */
export interface RelationDef {
  /** Trailer attribute key, e.g. "Provides". */
  readonly attr: string;
  /** Present ⇒ the relation produces a graph edge of this kind. */
  readonly linkKind?: LinkKind;
  /** Present ⇒ MSL-R083 constrains the target to these types (ancestor-walked). */
  readonly targetTypes?: readonly string[];
  /** true ⇒ included in lockfile canonical edge extraction. */
  readonly lockEdge?: boolean;
}

/** The core relations. Union of what the compiler / validator / lock each need;
 * every row carries exactly the facets that consumer set has today. */
export const CORE_RELATIONS: readonly RelationDef[] = [
  {
    attr: "Satisfies",
    linkKind: "satisfies",
    targetTypes: ["Specification"],
    lockEdge: true,
  },
  {
    attr: "Derived-from",
    linkKind: "derived-from",
    targetTypes: ["Specification"],
    lockEdge: true,
  },
  { attr: "References", linkKind: "references", lockEdge: true },
  {
    attr: "Allocated-to",
    linkKind: "allocated-to",
    targetTypes: ["Component"],
    lockEdge: true,
  },
  {
    attr: "Realizes",
    linkKind: "realizes",
    targetTypes: ["Specification"],
    lockEdge: true,
  },
  {
    attr: "Verifies",
    linkKind: "verifies",
    targetTypes: ["Requirement", "Contract"],
  },
  {
    attr: "Tests",
    linkKind: "tests",
    targetTypes: ["Component", "Unit", "Contract"],
    lockEdge: true,
  },
  {
    attr: "Depends-on",
    linkKind: "depends-on",
    targetTypes: ["Component", "Unit"],
    lockEdge: true,
  },
  {
    attr: "Part-of",
    linkKind: "part-of",
    targetTypes: ["Component"],
    lockEdge: true,
  },
  { attr: "Generated-from", linkKind: "generated-from", lockEdge: true },
  { attr: "Supersedes", linkKind: "supersedes", lockEdge: true },
  {
    attr: "Provides",
    linkKind: "provides",
    targetTypes: ["Contract"],
    lockEdge: true,
  },
  {
    attr: "Requires",
    linkKind: "requires",
    targetTypes: ["Contract"],
    lockEdge: true,
  },
  { attr: "Mitigated-by", targetTypes: ["Specification"] },
  { attr: "Affects", targetTypes: ["Component", "Unit", "Contract"] },
];

/**
 * Lock-edge keys that are NOT forward relations. The lockfile tracks the
 * verification edge by its inverse name `Verified-by` (not `Verifies`), so it is
 * an explicit addition rather than a derived `lockEdge` flag. Kept visible on
 * purpose — see ADR-024.
 */
export const LOCK_EXTRA_INVERSE_KEYS: readonly string[] = ["Verified-by"];
