/**
 * @module core/model/type_hierarchy_test
 *
 * Unit tests for {@linkcode attributesForType}, particularly the
 * `excludedAttrs` subtype-exclusion semantics that the spec lists
 * under ADR-003 §Part 2.
 */

import { assertEquals } from "@std/assert";
import { attributesForType, CORE_TYPE_SCOPED_ATTRS } from "./type_hierarchy.ts";

Deno.test("attributesForType: Requirement inherits Specification attrs", () => {
  const attrs = attributesForType("Requirement");
  assertEquals(attrs.has("Satisfies"), true);
  assertEquals(attrs.has("Derived-from"), true);
  assertEquals(attrs.has("Allocated-to"), true);
});

Deno.test("attributesForType: Test inherits Specification BUT excludes Allocated-to", () => {
  const attrs = attributesForType("Test");
  assertEquals(attrs.has("Verifies"), true); // own
  assertEquals(attrs.has("Tests"), true); // own
  assertEquals(attrs.has("Satisfies"), true); // inherited from Specification
  assertEquals(attrs.has("Derived-from"), true); // inherited
  // The spec exclusion — `Allocated-to` is not applicable on Test.
  assertEquals(attrs.has("Allocated-to"), false);
});

Deno.test("attributesForType: SoftwareComponent inherits Component attrs + own", () => {
  const attrs = attributesForType("SoftwareComponent");
  // Own
  assertEquals(attrs.has("License"), true);
  assertEquals(attrs.has("Build-manifest"), true);
  assertEquals(attrs.has("Package-manager"), true);
  // Inherited from Component
  assertEquals(attrs.has("Kind"), true);
  assertEquals(attrs.has("Part-of"), true);
  assertEquals(attrs.has("Realizes"), true);
  // Not a Component attribute
  assertEquals(attrs.has("Satisfies"), false);
});

Deno.test("attributesForType: HardwareInterface owns physical attrs, inherits Contract chain", () => {
  const attrs = attributesForType("HardwareInterface");
  // Own physical attributes retained after re-parenting.
  assertEquals(attrs.has("Bus-protocol"), true);
  assertEquals(attrs.has("Connector-type"), true);
  assertEquals(attrs.has("Voltage-level"), true);
  assertEquals(attrs.has("Signal-direction"), true);
  // Inherited from Contract → Specification.
  assertEquals(attrs.has("Schema-language"), true);
  assertEquals(attrs.has("Satisfies"), true);
  assertEquals(attrs.has("Derived-from"), true);
  // No longer inherited from Component.
  assertEquals(attrs.has("Provides"), false);
  assertEquals(attrs.has("Requires"), false);
  assertEquals(attrs.has("Kind"), false);
});

Deno.test("attributesForType: SoftwareInterface inherits Contract chain, no Component attrs", () => {
  const attrs = attributesForType("SoftwareInterface");
  assertEquals(attrs.has("Schema-language"), true); // from Contract
  assertEquals(attrs.has("Satisfies"), true); // from Specification
  assertEquals(attrs.has("Provides"), false); // not from Component anymore
  assertEquals(attrs.has("Kind"), false);
});

Deno.test("attributesForType: Item root → empty set", () => {
  const attrs = attributesForType("Item");
  assertEquals(attrs.size, 0);
});

Deno.test("attributesForType: unknown type → empty set", () => {
  const attrs = attributesForType("NotAType");
  assertEquals(attrs.size, 0);
});

Deno.test("CORE_TYPE_SCOPED_ATTRS contains union of every typed attr", () => {
  // Sample a few across families.
  assertEquals(CORE_TYPE_SCOPED_ATTRS.has("Allocated-to"), true);
  assertEquals(CORE_TYPE_SCOPED_ATTRS.has("Bus-protocol"), true);
  assertEquals(CORE_TYPE_SCOPED_ATTRS.has("License"), true);
  assertEquals(CORE_TYPE_SCOPED_ATTRS.has("Symbol"), true);
  assertEquals(CORE_TYPE_SCOPED_ATTRS.has("Aliases"), true);
  // Universal attrs are not "typed" — they live in the catalogue.
  assertEquals(CORE_TYPE_SCOPED_ATTRS.has("Labels"), false);
  assertEquals(CORE_TYPE_SCOPED_ATTRS.has("Id"), false);
});
