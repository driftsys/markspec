/**
 * @module core/model/uri_scheme_map_test
 *
 * Unit tests for {@linkcode inferTypeFromUriScheme}. Covers the
 * patterns in ADR-003 §Part 6 and the unmapped-scheme behaviour.
 */

import { assertEquals } from "@std/assert";
import { inferTypeFromUriScheme } from "./uri_scheme_map.ts";

Deno.test("inferTypeFromUriScheme: pkg:cargo → SoftwareComponent", () => {
  assertEquals(
    inferTypeFromUriScheme("pkg:cargo/serde@1.0.0"),
    "SoftwareComponent",
  );
});

Deno.test("inferTypeFromUriScheme: pkg:npm → SoftwareComponent", () => {
  assertEquals(inferTypeFromUriScheme("pkg:npm/lodash"), "SoftwareComponent");
});

Deno.test("inferTypeFromUriScheme: pkg:hw → HardwareComponent", () => {
  assertEquals(
    inferTypeFromUriScheme("pkg:hw/bosch/0285008010"),
    "HardwareComponent",
  );
});

Deno.test("inferTypeFromUriScheme: urn:iso:std:iso → Requirement", () => {
  assertEquals(
    inferTypeFromUriScheme("urn:iso:std:iso:26262:-6:ed-2"),
    "Requirement",
  );
});

Deno.test("inferTypeFromUriScheme: urn:ietf:rfc → Requirement", () => {
  assertEquals(inferTypeFromUriScheme("urn:ietf:rfc:2119"), "Requirement");
});

Deno.test("inferTypeFromUriScheme: doi → Requirement", () => {
  assertEquals(
    inferTypeFromUriScheme("doi:10.1109/IEEESTD.2008.4610935"),
    "Requirement",
  );
});

Deno.test("inferTypeFromUriScheme: urn:openapi → Contract", () => {
  assertEquals(
    inferTypeFromUriScheme("urn:openapi:braking:1.0.0"),
    "Contract",
  );
});

Deno.test("inferTypeFromUriScheme: urn:can-bus → HardwareInterface", () => {
  assertEquals(
    inferTypeFromUriScheme("urn:can-bus:powertrain:2024"),
    "HardwareInterface",
  );
});

Deno.test("inferTypeFromUriScheme: urn:refhub:term → Definition", () => {
  assertEquals(
    inferTypeFromUriScheme("urn:refhub:term:asil"),
    "Definition",
  );
});

Deno.test("inferTypeFromUriScheme: codebeamer → Requirement", () => {
  assertEquals(
    inferTypeFromUriScheme("codebeamer:Braking:1234"),
    "Requirement",
  );
});

Deno.test("inferTypeFromUriScheme: unmapped scheme → undefined", () => {
  assertEquals(inferTypeFromUriScheme("jira:FOO-1"), undefined);
});

Deno.test("inferTypeFromUriScheme: empty string → undefined", () => {
  assertEquals(inferTypeFromUriScheme(""), undefined);
});

Deno.test("inferTypeFromUriScheme: ULID-looking value → undefined", () => {
  // Defensive: a value that looks like a ULID rather than a URI
  // should fall through to undefined (caller should have already
  // shape-discriminated, but the function is robust).
  assertEquals(
    inferTypeFromUriScheme("01HGW2Q8MNP3RSTVWXYZABCDEF"),
    undefined,
  );
});
