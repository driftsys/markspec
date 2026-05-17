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
const BOTH_SHAPES: readonly EntryShape[] = ["Authored", "Reference"];

/**
 * Shapes that carry `References:` — identified entries only. A referenced
 * entry does not itself cite other referenced entries via `References:`
 * (the replacement relation is expressed via universal `Supersedes:`).
 */
const CITING_SHAPES: readonly EntryShape[] = ["Authored"];

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

  // Universal classification (spec §1.3 / §1.4) — apply to every entry.
  // `Type` carries the information-layer classification; `Source` and
  // `Origin` are universal authoring metadata (SSoT pointer, synthesis
  // flag). They live in the catalogue so validators / formatters can
  // look them up without per-call special-casing.
  {
    key: "Type",
    type: "enum",
    origin: "authored",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Source",
    type: "path-or-id",
    origin: "authored",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Origin",
    type: "enum",
    origin: "authored",
    shapes: BOTH_SHAPES,
    required: false,
    enumValues: ["authored", "synthesized"],
  },

  // Reference-shape navigation (spec §1.5) — promoted from the RefHub
  // profile to core in PR #277.
  {
    key: "Reference-url",
    type: "url",
    origin: "authored",
    shapes: ["Reference"],
    required: false,
  },
  {
    key: "Reference-document",
    type: "text",
    origin: "authored",
    shapes: ["Reference"],
    required: false,
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

  // Generated inverses from ADR-003 §Part 3. These are NEVER authored
  // in source; the compiler computes them from authored relations at
  // build time. MSL-A030 catches anyone who tries to write them
  // manually.
  {
    key: "Derives",
    type: "id-list",
    origin: "generated",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Satisfied-by",
    type: "id-list",
    origin: "generated",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Realized-by",
    type: "id-list",
    origin: "generated",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Verified-by",
    type: "id-list",
    origin: "generated",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Tested-by",
    type: "id-list",
    origin: "generated",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Allocated",
    type: "id-list",
    origin: "generated",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Contains",
    type: "id-list",
    origin: "generated",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Provided-by",
    type: "id-list",
    origin: "generated",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Required-by",
    type: "id-list",
    origin: "generated",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Used-by",
    type: "id-list",
    origin: "generated",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Caused",
    type: "id-list",
    origin: "generated",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Affected-by",
    type: "id-list",
    origin: "generated",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Mitigates",
    type: "id-list",
    origin: "generated",
    shapes: BOTH_SHAPES,
    required: false,
  },
  {
    key: "Cited-by",
    type: "id-list",
    origin: "generated",
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
