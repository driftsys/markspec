/**
 * @module model/attributes
 *
 * Built-in attribute catalog per the language spec (Part 2.1).
 *
 * The core defines one reserved identity slot (`Id:`) plus a small
 * universal attribute set. Profile-declared attributes extend this
 * catalog at runtime. Type-specific attributes (`Derived-from`,
 * `Verifies`, `Allocated-to`, `Element-kind`, `Test-level`, …) are not
 * built-ins — they are declared by the active profile.
 */

import type { AttributeOrigin, AttributeValueType, EntryShape } from "./mod.ts";

// ---------------------------------------------------------------------------
// Attribute specification
// ---------------------------------------------------------------------------

/** Specification of a single built-in attribute. */
export interface AttributeSpec {
  /** Canonical Title-Case key (e.g., `Id`, `Labels`). */
  readonly key: string;
  /** Value type from the 14-type system. */
  readonly type: AttributeValueType;
  /** How the value arrives in the model. */
  readonly origin: AttributeOrigin;
  /**
   * Shapes on which the attribute may appear. An empty list means the
   * attribute applies to both shapes (universal).
   */
  readonly shapes: readonly EntryShape[];
  /** Whether the attribute is required. */
  readonly required: boolean;
  /** Closed vocabulary — set when `type === "enum"`. */
  readonly enumValues?: readonly string[];
}

// ---------------------------------------------------------------------------
// Universal attribute catalog
// ---------------------------------------------------------------------------

/** Both shapes. */
const BOTH_SHAPES: readonly EntryShape[] = ["identified", "referenced"];

/**
 * Shapes that carry `References:` — identified entries only. A referenced
 * entry does not itself cite other referenced entries via `References:`
 * (the replacement relation is expressed via universal `Supersedes:`).
 */
const CITING_SHAPES: readonly EntryShape[] = ["identified"];

/**
 * Full catalog of core built-in attributes.
 *
 * Order within the array has no semantic meaning; consumers look up by key
 * via {@linkcode attributeSpec}.
 *
 * Profile-declared attributes (`type:`, `Derived-from:`, `Verifies:`,
 * `Allocated-to:`, `Element-kind:`, `Test-level:`, compliance attributes,
 * …) are not listed here; they appear at runtime via the active profile's
 * manifest.
 */
export const ATTRIBUTE_CATALOG: readonly AttributeSpec[] = [
  // Identity — required on every entry, shape-discriminated by value format
  {
    key: "Id",
    type: "id",
    origin: "assigned",
    shapes: BOTH_SHAPES,
    required: true,
  },

  // Universal — apply to every entry
  {
    key: "Labels",
    type: "tag-list",
    origin: "authored",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "References",
    type: "citation",
    origin: "authored",
    shapes: CITING_SHAPES,
    required: false,
  },
  {
    key: "External-id",
    type: "external-id",
    origin: "authored",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Supersedes",
    type: "id",
    origin: "authored",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Superseded-by",
    type: "id",
    origin: "generated",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Deprecated",
    type: "text",
    origin: "authored",
    shapes: BOTH_SHAPES,
    required: false,
  },
];

/** Canonical Title-Case attribute keys the core recognizes. */
export const UNIVERSAL_ATTRIBUTE_KEYS: readonly string[] = ATTRIBUTE_CATALOG
  .map((spec) => spec.key);

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
