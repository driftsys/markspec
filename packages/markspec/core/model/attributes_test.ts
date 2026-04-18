/**
 * @module model/attributes_test
 *
 * Catalog-shape invariants per ADR-002 Annex C.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import {
  ATTRIBUTE_CATALOG,
  attributesForFamily,
  attributeSpec,
  ELEMENT_KIND_VALUES,
  STATUS_VALUES,
  TEST_LEVEL_VALUES,
} from "./attributes.ts";
import {
  type EntryFamily,
  FAMILY_BY_IDENTITY_KEY,
  IDENTITY_KEY_BY_FAMILY,
} from "./mod.ts";

Deno.test("ATTRIBUTE_CATALOG: keys are unique", () => {
  const keys = ATTRIBUTE_CATALOG.map((s) => s.key);
  assertEquals(keys.length, new Set(keys).size);
});

Deno.test("ATTRIBUTE_CATALOG: identity attributes appear exactly once per family", () => {
  for (const family of ["spec", "test", "element", "reference"] as const) {
    const key = IDENTITY_KEY_BY_FAMILY[family];
    const spec = attributeSpec(key);
    assertExists(spec, `${key} missing from catalog`);
    assertEquals(spec.families, [family]);
    assertEquals(spec.required, true);
  }
});

Deno.test("ATTRIBUTE_CATALOG: enum attributes declare enumValues", () => {
  for (const spec of ATTRIBUTE_CATALOG) {
    if (spec.type === "enum") {
      assertExists(
        spec.enumValues,
        `enum attribute ${spec.key} missing enumValues`,
      );
      assert(spec.enumValues.length > 0);
    }
  }
});

Deno.test("ATTRIBUTE_CATALOG: Status is universal and carries the four-value vocabulary", () => {
  const status = attributeSpec("Status");
  assertExists(status);
  assertEquals(status.families.length, 4);
  assertEquals(status.enumValues, STATUS_VALUES);
});

Deno.test("ATTRIBUTE_CATALOG: References applies to spec/test/element, not reference", () => {
  const refs = attributeSpec("References");
  assertExists(refs);
  assertEquals([...refs.families].sort(), ["element", "spec", "test"]);
});

Deno.test("ATTRIBUTE_CATALOG: Test-level enum matches ADR-002 Part 4", () => {
  const level = attributeSpec("Test-level");
  assertExists(level);
  assertEquals(level.enumValues, TEST_LEVEL_VALUES);
  assertEquals(level.origin, "inferred");
});

Deno.test("ATTRIBUTE_CATALOG: Element-kind enum matches ADR-002 Part 5", () => {
  const kind = attributeSpec("Element-kind");
  assertExists(kind);
  assertEquals(kind.enumValues, ELEMENT_KIND_VALUES);
});

Deno.test("attributesForFamily: every family sees its identity attribute", () => {
  const families: EntryFamily[] = ["spec", "test", "element", "reference"];
  for (const family of families) {
    const specs = attributesForFamily(family);
    const identityKey = IDENTITY_KEY_BY_FAMILY[family];
    assert(
      specs.some((s) => s.key === identityKey),
      `${family} catalog missing ${identityKey}`,
    );
  }
});

Deno.test("FAMILY_BY_IDENTITY_KEY and IDENTITY_KEY_BY_FAMILY are inverse", () => {
  for (const [key, family] of Object.entries(FAMILY_BY_IDENTITY_KEY)) {
    assertEquals(IDENTITY_KEY_BY_FAMILY[family as EntryFamily], key);
  }
});
