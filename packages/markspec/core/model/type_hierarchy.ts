/**
 * @module model/type_hierarchy
 *
 * Core type hierarchy from ADR-003 §Part 2. Encodes the per-type
 * attribute catalogue for the 15 built-in concrete types and the four
 * abstract parents. Attributes flow downward via inheritance; this
 * module exposes lookup helpers consumed by the validator's MSL-T022
 * check and by future profile-resolution work.
 */

/** Per-type definition: parent in the hierarchy + locally declared attrs. */
export interface CoreTypeDef {
  /** Parent type name, or `null` for `Item` (the root). */
  readonly parent: string | null;
  /**
   * Attributes declared by this type. Subtype attribute sets include
   * everything declared on ancestor types, per ADR-003 §Part 2.
   */
  readonly ownAttrs: readonly string[];
  /**
   * Attributes inherited from ancestors that are "not applicable" on
   * this subtype per ADR-003 §Part 2 (e.g., `Allocated-to` on Test).
   * Removed during {@linkcode attributesForType} resolution.
   */
  readonly excludedAttrs?: readonly string[];
}

/**
 * Built-in type hierarchy. Keyed by the canonical TitleCase / lower-with-
 * hyphens name as it would appear in a `Type:` attribute value.
 */
export const CORE_TYPE_HIERARCHY: Readonly<Record<string, CoreTypeDef>> = {
  // Root
  Item: { parent: null, ownAttrs: [] },

  // Specification family (ADR-003 §Part 2 — Specification)
  Specification: {
    parent: "Item",
    ownAttrs: ["Derived-from", "Satisfies", "Allocated-to"],
  },
  Requirement: { parent: "Specification", ownAttrs: [] },
  Test: {
    parent: "Specification",
    ownAttrs: ["Verifies", "Tests"],
    // ADR-003 §Part 2 — Test: "Allocated-to: not applicable —
    // tests are not allocated to components".
    excludedAttrs: ["Allocated-to"],
  },
  Contract: { parent: "Specification", ownAttrs: ["Schema-language"] },
  Record: { parent: "Specification", ownAttrs: ["Caused-by", "Affects"] },
  Risk: { parent: "Specification", ownAttrs: ["Caused-by", "Mitigated-by"] },

  // Component family (ADR-003 §Part 2 — Component)
  Component: {
    parent: "Item",
    ownAttrs: [
      "Kind",
      "Part-of",
      "Realizes",
      "Depends-on",
      "Provides",
      "Requires",
    ],
  },
  SoftwareComponent: {
    parent: "Component",
    ownAttrs: ["License", "Build-manifest", "Package-manager"],
  },
  HardwareComponent: {
    parent: "Component",
    ownAttrs: ["Manufacturer", "Part-number", "Datasheet"],
  },
  SoftwareInterface: { parent: "Component", ownAttrs: [] },
  HardwareInterface: {
    parent: "Component",
    ownAttrs: [
      "Bus-protocol",
      "Connector-type",
      "Voltage-level",
      "Signal-direction",
    ],
  },

  // Unit family (ADR-003 §Part 2 — Unit)
  Unit: {
    parent: "Item",
    ownAttrs: ["Part-of", "Realizes", "Depends-on"],
  },
  SoftwareUnit: {
    parent: "Unit",
    ownAttrs: ["Source", "Symbol", "Language"],
  },
  HardwareUnit: {
    parent: "Unit",
    ownAttrs: [
      "Manufacturer",
      "Part-number",
      "Datasheet",
      "Footprint",
      "Value",
    ],
  },

  // Standalone subtype of Item (ADR-003 §Part 2 — Definition)
  Definition: { parent: "Item", ownAttrs: ["Aliases", "See-also"] },
};

/**
 * Collect every attribute valid on `typeName` by walking the parent
 * chain and subtracting any `excludedAttrs` declared along the way.
 * Returns a {@linkcode Set} of attribute keys (TitleCase or
 * lowercase-with-hyphens as declared). Returns an empty set for
 * unknown type names — the caller treats unknown types separately.
 *
 * Exclusion semantics: an attribute marked `excludedAttrs` on a
 * subtype is removed from the final set even if an ancestor declared
 * it. The subtype cannot re-add the attribute later — only its own
 * `ownAttrs` list contributes.
 */
export function attributesForType(typeName: string): Set<string> {
  const result = new Set<string>();
  const excluded = new Set<string>();
  let cursor: string | null = typeName;
  while (cursor !== null && CORE_TYPE_HIERARCHY[cursor]) {
    for (const a of CORE_TYPE_HIERARCHY[cursor].ownAttrs) result.add(a);
    for (const a of CORE_TYPE_HIERARCHY[cursor].excludedAttrs ?? []) {
      excluded.add(a);
    }
    cursor = CORE_TYPE_HIERARCHY[cursor].parent;
  }
  for (const a of excluded) result.delete(a);
  return result;
}

/**
 * Union of every type-scoped attribute name declared anywhere in the
 * core hierarchy. Used by the validator to suppress `MSL-R010`
 * (unknown attribute) for keys that are core-known but appear on the
 * "wrong" type — those cases get the more specific `MSL-T022`.
 */
export const CORE_TYPE_SCOPED_ATTRS: ReadonlySet<string> = (() => {
  const set = new Set<string>();
  for (const def of Object.values(CORE_TYPE_HIERARCHY)) {
    for (const a of def.ownAttrs) set.add(a);
  }
  return set;
})();
