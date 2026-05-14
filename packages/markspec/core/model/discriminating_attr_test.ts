/**
 * @module core/model/discriminating_attr_test
 *
 * Unit tests for {@linkcode inferTypeFromDiscriminatingAttr} — the spec
 * §1.3.1 step 6 discriminating-attribute pattern matcher.
 */

import { assertEquals } from "@std/assert";
import { inferTypeFromDiscriminatingAttr } from "./discriminating_attr.ts";

// Test — Verifies / Tests
Deno.test("inferTypeFromDiscriminatingAttr: Verifies → Test", () => {
  assertEquals(inferTypeFromDiscriminatingAttr(["Verifies"]), "Test");
});

Deno.test("inferTypeFromDiscriminatingAttr: Tests → Test", () => {
  assertEquals(inferTypeFromDiscriminatingAttr(["Tests"]), "Test");
});

// Contract — Schema-language
Deno.test("inferTypeFromDiscriminatingAttr: Schema-language → Contract", () => {
  assertEquals(
    inferTypeFromDiscriminatingAttr(["Schema-language"]),
    "Contract",
  );
});

// Record / Risk — single-owner discriminators only
Deno.test("inferTypeFromDiscriminatingAttr: Affects → Record", () => {
  assertEquals(inferTypeFromDiscriminatingAttr(["Affects"]), "Record");
});

Deno.test("inferTypeFromDiscriminatingAttr: Mitigated-by → Risk", () => {
  assertEquals(inferTypeFromDiscriminatingAttr(["Mitigated-by"]), "Risk");
});

// SoftwareComponent
Deno.test("inferTypeFromDiscriminatingAttr: License → SoftwareComponent", () => {
  assertEquals(
    inferTypeFromDiscriminatingAttr(["License"]),
    "SoftwareComponent",
  );
});

Deno.test("inferTypeFromDiscriminatingAttr: Build-manifest → SoftwareComponent", () => {
  assertEquals(
    inferTypeFromDiscriminatingAttr(["Build-manifest"]),
    "SoftwareComponent",
  );
});

Deno.test("inferTypeFromDiscriminatingAttr: Package-manager → SoftwareComponent", () => {
  assertEquals(
    inferTypeFromDiscriminatingAttr(["Package-manager"]),
    "SoftwareComponent",
  );
});

// HardwareInterface
Deno.test("inferTypeFromDiscriminatingAttr: Bus-protocol → HardwareInterface", () => {
  assertEquals(
    inferTypeFromDiscriminatingAttr(["Bus-protocol"]),
    "HardwareInterface",
  );
});

Deno.test("inferTypeFromDiscriminatingAttr: Connector-type → HardwareInterface", () => {
  assertEquals(
    inferTypeFromDiscriminatingAttr(["Connector-type"]),
    "HardwareInterface",
  );
});

Deno.test("inferTypeFromDiscriminatingAttr: Voltage-level → HardwareInterface", () => {
  assertEquals(
    inferTypeFromDiscriminatingAttr(["Voltage-level"]),
    "HardwareInterface",
  );
});

Deno.test("inferTypeFromDiscriminatingAttr: Signal-direction → HardwareInterface", () => {
  assertEquals(
    inferTypeFromDiscriminatingAttr(["Signal-direction"]),
    "HardwareInterface",
  );
});

// SoftwareUnit
Deno.test("inferTypeFromDiscriminatingAttr: Symbol → SoftwareUnit", () => {
  assertEquals(inferTypeFromDiscriminatingAttr(["Symbol"]), "SoftwareUnit");
});

Deno.test("inferTypeFromDiscriminatingAttr: Language → SoftwareUnit", () => {
  assertEquals(inferTypeFromDiscriminatingAttr(["Language"]), "SoftwareUnit");
});

// HardwareUnit
Deno.test("inferTypeFromDiscriminatingAttr: Footprint → HardwareUnit", () => {
  assertEquals(inferTypeFromDiscriminatingAttr(["Footprint"]), "HardwareUnit");
});

Deno.test("inferTypeFromDiscriminatingAttr: Value → HardwareUnit", () => {
  assertEquals(inferTypeFromDiscriminatingAttr(["Value"]), "HardwareUnit");
});

// Definition
Deno.test("inferTypeFromDiscriminatingAttr: Aliases → Definition", () => {
  assertEquals(inferTypeFromDiscriminatingAttr(["Aliases"]), "Definition");
});

Deno.test("inferTypeFromDiscriminatingAttr: See-also → Definition", () => {
  assertEquals(inferTypeFromDiscriminatingAttr(["See-also"]), "Definition");
});

// Source-order: first matching discriminator wins
Deno.test("inferTypeFromDiscriminatingAttr: first matching key wins (Verifies before Schema-language)", () => {
  assertEquals(
    inferTypeFromDiscriminatingAttr(["Verifies", "Schema-language"]),
    "Test",
  );
});

Deno.test("inferTypeFromDiscriminatingAttr: first matching key wins (Schema-language before Bus-protocol)", () => {
  assertEquals(
    inferTypeFromDiscriminatingAttr(["Schema-language", "Bus-protocol"]),
    "Contract",
  );
});

// Non-discriminating keys (ambiguous or universal) → ignored
Deno.test("inferTypeFromDiscriminatingAttr: Caused-by ignored (Record OR Risk — ambiguous)", () => {
  assertEquals(inferTypeFromDiscriminatingAttr(["Caused-by"]), undefined);
});

Deno.test("inferTypeFromDiscriminatingAttr: Manufacturer ignored (HardwareComponent OR HardwareUnit — ambiguous)", () => {
  assertEquals(inferTypeFromDiscriminatingAttr(["Manufacturer"]), undefined);
});

Deno.test("inferTypeFromDiscriminatingAttr: universal trace keys ignored (Satisfies, Derived-from)", () => {
  assertEquals(
    inferTypeFromDiscriminatingAttr(["Satisfies", "Derived-from"]),
    undefined,
  );
});

Deno.test("inferTypeFromDiscriminatingAttr: empty input → undefined", () => {
  assertEquals(inferTypeFromDiscriminatingAttr([]), undefined);
});
