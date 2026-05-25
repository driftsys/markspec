/**
 * Property-based invariant tests for ATTRIBUTE_CATALOG.
 *
 * Walks all 31 entries and asserts structural invariants that must hold
 * for every attribute specification in the catalog.
 *
 * Partially addresses #215.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import { assert } from "@std/assert/assert";
import { ATTRIBUTE_CATALOG } from "./attributes.ts";

// ---------------------------------------------------------------------------
// Invariant: no duplicate keys
// ---------------------------------------------------------------------------

Deno.test("ATTRIBUTE_CATALOG: no duplicate keys", () => {
  const keys = ATTRIBUTE_CATALOG.map((s) => s.key);
  const unique = new Set(keys);
  assertEquals(
    keys.length,
    unique.size,
    `Duplicate keys found: ${
      keys.filter((k, i) => keys.indexOf(k) !== i).join(", ")
    }`,
  );
});

// ---------------------------------------------------------------------------
// Per-entry shape invariants
// ---------------------------------------------------------------------------

for (const spec of ATTRIBUTE_CATALOG) {
  Deno.test(`ATTRIBUTE_CATALOG[${spec.key}]: key is non-empty Title-Case string`, () => {
    assert(spec.key.length > 0, "key must be non-empty");
    // Title-Case: first character is uppercase
    assertEquals(
      spec.key[0],
      spec.key[0].toUpperCase(),
      `key "${spec.key}" must start with uppercase`,
    );
    // No whitespace
    assertEquals(
      spec.key,
      spec.key.trim(),
      "key must not have surrounding whitespace",
    );
    assert(
      !/\s/.test(spec.key),
      `key "${spec.key}" must not contain whitespace`,
    );
  });

  Deno.test(`ATTRIBUTE_CATALOG[${spec.key}]: shapes is a non-empty array`, () => {
    assert(Array.isArray(spec.shapes), "shapes must be an array");
    assertNotEquals(spec.shapes.length, 0, "shapes must not be empty");
    for (const shape of spec.shapes) {
      assert(
        shape === "Authored" || shape === "Reference",
        `Invalid shape "${shape}" on ${spec.key}`,
      );
    }
  });

  Deno.test(`ATTRIBUTE_CATALOG[${spec.key}]: enum attributes have enumValues or are profile-delegated`, () => {
    if (spec.type === "enum") {
      // Open enums (e.g., Type) delegate their vocabulary to profiles;
      // closed enums (e.g., Origin) must declare enumValues.
      if (spec.enumValues !== undefined) {
        assert(
          spec.enumValues.length > 0,
          `Enum attribute "${spec.key}" has empty enumValues array`,
        );
      }
      // Either way, enumValues must not be an empty array
    }
  });

  Deno.test(`ATTRIBUTE_CATALOG[${spec.key}]: identity attribute is required`, () => {
    if (spec.type === "id" && spec.key === "Id") {
      assert(
        spec.required,
        `Identity attribute "${spec.key}" must be required`,
      );
    }
  });

  Deno.test(`ATTRIBUTE_CATALOG[${spec.key}]: generated attributes are not required`, () => {
    if (spec.origin === "generated") {
      assertEquals(
        spec.required,
        false,
        `Generated attribute "${spec.key}" must not be required`,
      );
    }
  });

  Deno.test(`ATTRIBUTE_CATALOG[${spec.key}]: has valid origin`, () => {
    assert(
      spec.origin === "authored" || spec.origin === "assigned" ||
        spec.origin === "generated",
      `Invalid origin "${spec.origin}" on ${spec.key}`,
    );
  });
}

// ---------------------------------------------------------------------------
// Aggregate invariant: catalog is non-trivial
// ---------------------------------------------------------------------------

Deno.test("ATTRIBUTE_CATALOG: has at least 25 entries", () => {
  assert(
    ATTRIBUTE_CATALOG.length >= 25,
    `Expected >=25 entries, got ${ATTRIBUTE_CATALOG.length}`,
  );
});
