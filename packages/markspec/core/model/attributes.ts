/**
 * @module model/attributes
 *
 * Built-in attribute catalog per ADR-002 Annex C.
 *
 * Every attribute the core language recognizes appears here with its value
 * type, origin, applicable families, and enum vocabulary (where relevant).
 * Profile-declared attributes extend this catalog at runtime; the validator,
 * formatter, and compiler consult it to drive parsing, canonicalization, and
 * cross-reference checks.
 */

import type {
  AttributeOrigin,
  AttributeValueType,
  EntryFamily,
} from "./mod.ts";

// ---------------------------------------------------------------------------
// Enum vocabularies
// ---------------------------------------------------------------------------

/** `Status` vocabulary per ADR-002 §Universal attributes. */
export const STATUS_VALUES: readonly string[] = [
  "draft",
  "approved",
  "deprecated",
  "withdrawn",
];

/** `Test-level` vocabulary per ADR-002 Part 4. */
export const TEST_LEVEL_VALUES: readonly string[] = [
  "unit",
  "integration",
  "system",
  "acceptance",
];

/** `Element-kind` core vocabulary per ADR-002 Part 5. */
export const ELEMENT_KIND_VALUES: readonly string[] = [
  "item",
  "artifact",
  "dependency",
  "unit",
];

// ---------------------------------------------------------------------------
// Attribute specification
// ---------------------------------------------------------------------------

/** Specification of a single built-in attribute. */
export interface AttributeSpec {
  /** Canonical Title-Case key (e.g., `Derived-from`). */
  readonly key: string;
  /** Value type from the 14-type system. */
  readonly type: AttributeValueType;
  /** How the value arrives in the model. */
  readonly origin: AttributeOrigin;
  /** Families on which the attribute may appear. */
  readonly families: readonly EntryFamily[];
  /** Whether the attribute is required by the family. */
  readonly required: boolean;
  /** Closed vocabulary — set when `type === "enum"`. */
  readonly enumValues?: readonly string[];
}

// ---------------------------------------------------------------------------
// ATTRIBUTE_CATALOG — ADR-002 Annex C
// ---------------------------------------------------------------------------

const ALL_FAMILIES: readonly EntryFamily[] = [
  "spec",
  "test",
  "element",
  "reference",
];

/** Families that carry `References:` — universal minus Reference per ADR-002 §Part 3. */
const CITING_FAMILIES: readonly EntryFamily[] = ["spec", "test", "element"];

/**
 * Full catalog of built-in attributes per ADR-002 Annex C.
 *
 * Order within the array has no semantic meaning; consumers look up by key via
 * {@linkcode attributeSpec} or filter by family via
 * {@linkcode attributesForFamily}.
 */
export const ATTRIBUTE_CATALOG: readonly AttributeSpec[] = [
  // Universal — all four families
  {
    key: "Labels",
    type: "tag-list",
    origin: "authored",
    families: ALL_FAMILIES,
    required: false,
  },
  {
    key: "Status",
    type: "enum",
    origin: "authored",
    families: ALL_FAMILIES,
    required: false,
    enumValues: STATUS_VALUES,
  },
  {
    key: "References",
    type: "citation",
    origin: "authored",
    families: CITING_FAMILIES,
    required: false,
  },
  {
    key: "External-id",
    type: "external-id",
    origin: "authored",
    families: ALL_FAMILIES,
    required: false,
  },
  {
    key: "Supersedes",
    type: "id",
    origin: "authored",
    families: ALL_FAMILIES,
    required: false,
  },
  {
    key: "Superseded-by",
    type: "id",
    origin: "generated",
    families: ALL_FAMILIES,
    required: false,
  },

  // Spec family
  {
    key: "Spec-id",
    type: "id",
    origin: "assigned",
    families: ["spec"],
    required: true,
  },
  {
    key: "Derived-from",
    type: "id-list",
    origin: "authored",
    families: ["spec"],
    required: false,
  },
  {
    key: "Satisfies",
    type: "id-list",
    origin: "authored",
    families: ["spec"],
    required: false,
  },
  {
    key: "Allocated-to",
    type: "id-list",
    origin: "authored",
    families: ["spec"],
    required: false,
  },
  {
    key: "Derives",
    type: "id-list",
    origin: "generated",
    families: ["spec"],
    required: false,
  },
  {
    key: "Satisfied-by",
    type: "id-list",
    origin: "generated",
    families: ["spec"],
    required: false,
  },
  {
    key: "Realized-by",
    type: "id-list",
    origin: "generated",
    families: ["spec"],
    required: false,
  },
  {
    key: "Verified-by",
    type: "id-list",
    origin: "generated",
    families: ["spec"],
    required: false,
  },

  // Test family
  {
    key: "Test-id",
    type: "id",
    origin: "assigned",
    families: ["test"],
    required: true,
  },
  {
    key: "Test-level",
    type: "enum",
    origin: "inferred",
    families: ["test"],
    required: false,
    enumValues: TEST_LEVEL_VALUES,
  },
  {
    key: "Verifies",
    type: "id-list",
    origin: "authored",
    families: ["test"],
    required: false,
  },
  {
    key: "Tests",
    type: "id-list",
    origin: "authored",
    families: ["test"],
    required: false,
  },

  // Element family
  {
    key: "Element-id",
    type: "id",
    origin: "assigned",
    families: ["element"],
    required: true,
  },
  {
    key: "Element-kind",
    type: "enum",
    origin: "inferred",
    families: ["element"],
    required: false,
    enumValues: ELEMENT_KIND_VALUES,
  },
  {
    key: "Part-of",
    type: "id",
    origin: "inferred",
    families: ["element"],
    required: false,
  },
  {
    key: "Realizes",
    type: "id-list",
    origin: "authored",
    families: ["element"],
    required: false,
  },
  {
    key: "Depends-on",
    type: "id-list",
    origin: "authored",
    families: ["element"],
    required: false,
  },
  {
    key: "Generated-from",
    type: "path-or-id",
    origin: "authored",
    families: ["element"],
    required: false,
  },
  {
    key: "Contains",
    type: "id-list",
    origin: "generated",
    families: ["element"],
    required: false,
  },
  {
    key: "Used-by",
    type: "id-list",
    origin: "generated",
    families: ["element"],
    required: false,
  },
  {
    key: "Allocated",
    type: "id-list",
    origin: "generated",
    families: ["element"],
    required: false,
  },
  {
    key: "Tested-by",
    type: "id-list",
    origin: "generated",
    families: ["element"],
    required: false,
  },

  // Reference family
  {
    key: "Reference-id",
    type: "uri",
    origin: "authored",
    families: ["reference"],
    required: true,
  },
  {
    key: "Reference-url",
    type: "url",
    origin: "authored",
    families: ["reference"],
    required: false,
  },
  {
    key: "Reference-document",
    type: "text",
    origin: "authored",
    families: ["reference"],
    required: false,
  },
  {
    key: "Cited-by",
    type: "id-list",
    origin: "generated",
    families: ["reference"],
    required: false,
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const SPEC_BY_KEY: ReadonlyMap<string, AttributeSpec> = new Map(
  ATTRIBUTE_CATALOG.map((spec) => [spec.key, spec]),
);

/** Look up an attribute specification by its canonical key. */
export function attributeSpec(key: string): AttributeSpec | undefined {
  return SPEC_BY_KEY.get(key);
}

/** All attribute specifications that apply to the given family. */
export function attributesForFamily(
  family: EntryFamily,
): readonly AttributeSpec[] {
  return ATTRIBUTE_CATALOG.filter((spec) => spec.families.includes(family));
}
