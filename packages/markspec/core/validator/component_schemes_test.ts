/**
 * @module validator/component_schemes_test
 *
 * Unit tests for the component Id-scheme parsers.
 */

import { assertEquals, assertMatch } from "@std/assert";
import { deriveTermSlug } from "../parser/glossary.ts";
import {
  isSchemeQualifiedUri,
  parseComponentScheme,
  parseCpeId,
  parseGtinId,
  parseMfgId,
  parsePurl,
  parseUrnSystemOrTool,
} from "./component_schemes.ts";

// ---------------------------------------------------------------------------
// isSchemeQualifiedUri
// ---------------------------------------------------------------------------

Deno.test("isSchemeQualifiedUri: accepts pkg: prefix", () => {
  assertEquals(isSchemeQualifiedUri("pkg:cargo/serde"), true);
});

Deno.test("isSchemeQualifiedUri: accepts custom: prefix", () => {
  assertEquals(isSchemeQualifiedUri("custom:foo:bar"), true);
});

Deno.test("isSchemeQualifiedUri: rejects plain string", () => {
  assertEquals(isSchemeQualifiedUri("notauri"), false);
});

Deno.test("isSchemeQualifiedUri: rejects empty string", () => {
  assertEquals(isSchemeQualifiedUri(""), false);
});

// ---------------------------------------------------------------------------
// parsePurl (§5.1)
// ---------------------------------------------------------------------------

Deno.test("parsePurl: valid cargo purl → SoftwareComponent", () => {
  const r = parsePurl("pkg:cargo/serde@1.0.0");
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.type, "SoftwareComponent");
});

Deno.test("parsePurl: valid npm purl → SoftwareComponent", () => {
  const r = parsePurl("pkg:npm/%40angular/core@12.3.1");
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.type, "SoftwareComponent");
});

Deno.test("parsePurl: valid hw purl → HardwareComponent", () => {
  const r = parsePurl("pkg:hw/stm32/stm32f4");
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.type, "HardwareComponent");
});

Deno.test("parsePurl: purl with subpath → SoftwareUnit", () => {
  const r = parsePurl("pkg:cargo/serde@1.0.0#src/lib.rs");
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.type, "SoftwareUnit");
});

Deno.test("parsePurl: unknown purl type → Component (fallback)", () => {
  const r = parsePurl("pkg:unknown-type/some-package");
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.type, "Component");
});

Deno.test("parsePurl: missing type → L031 error", () => {
  const r = parsePurl("pkg:/name");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L031");
});

Deno.test("parsePurl: missing name → L031 error", () => {
  const r = parsePurl("pkg:cargo/");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L031");
});

Deno.test("parsePurl: not a purl → L031 error", () => {
  const r = parsePurl("npm:foo");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L031");
});

// ---------------------------------------------------------------------------
// parseMfgId (§5.2)
// ---------------------------------------------------------------------------

Deno.test("parseMfgId: valid mfg: id → HardwareComponent", () => {
  const r = parseMfgId("mfg:bosch:R0402-100K");
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.type, "HardwareComponent");
});

Deno.test("parseMfgId: partno with colons is valid", () => {
  const r = parseMfgId("mfg:ti:LP3943:TSSOP-24");
  assertEquals(r.ok, true);
});

Deno.test("parseMfgId: missing vendor → L032 error", () => {
  const r = parseMfgId("mfg::R0402");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L032");
});

Deno.test("parseMfgId: missing partno → L032 error", () => {
  const r = parseMfgId("mfg:bosch:");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L032");
});

Deno.test("parseMfgId: missing colon separator → L032 error", () => {
  const r = parseMfgId("mfg:bosch");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L032");
});

Deno.test("parseMfgId: vendor with invalid char → L032 error", () => {
  const r = parseMfgId("mfg:bos ch:R0402");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L032");
});

Deno.test("parseMfgId: not mfg: prefix → L032 error", () => {
  const r = parseMfgId("pkg:cargo/foo");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L032");
});

// ---------------------------------------------------------------------------
// parseGtinId (§5.3)
// ---------------------------------------------------------------------------

Deno.test("parseGtinId: valid GTIN-8 73513537 → HardwareComponent", () => {
  const r = parseGtinId("gtin:73513537");
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.type, "HardwareComponent");
});

Deno.test("parseGtinId: valid GTIN-13 5901234123457 → HardwareComponent", () => {
  // GTIN-13: 5901234123457 — verified check digit
  const r = parseGtinId("gtin:5901234123457");
  assertEquals(r.ok, true);
});

Deno.test("parseGtinId: wrong length (6 digits) → L033 error", () => {
  const r = parseGtinId("gtin:123456");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L033");
});

Deno.test("parseGtinId: non-digit chars → L033 error", () => {
  const r = parseGtinId("gtin:12345abc");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L033");
});

Deno.test("parseGtinId: bad check digit → L034 error", () => {
  const r = parseGtinId("gtin:12345678"); // check should be 5, not 8
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L034");
});

Deno.test("parseGtinId: not gtin: prefix → L033 error", () => {
  const r = parseGtinId("ean:12345678");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L033");
});

// ---------------------------------------------------------------------------
// parseCpeId (§5.4)
// ---------------------------------------------------------------------------

Deno.test("parseCpeId: valid CPE 2.3 OS → SoftwareComponent", () => {
  const r = parseCpeId(
    "cpe:2.3:o:linux:linux_kernel:5.4:*:*:*:*:*:*:*",
  );
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.type, "SoftwareComponent");
});

Deno.test("parseCpeId: valid CPE 2.3 hardware → HardwareComponent", () => {
  const r = parseCpeId(
    "cpe:2.3:h:cisco:catalyst_9300:*:*:*:*:*:*:*:*",
  );
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.type, "HardwareComponent");
});

Deno.test("parseCpeId: valid CPE 2.3 application → SoftwareComponent", () => {
  const r = parseCpeId(
    "cpe:2.3:a:mozilla:firefox:100.0:*:*:*:*:*:*:*",
  );
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.type, "SoftwareComponent");
});

Deno.test("parseCpeId: legacy CPE 2.2 URI binding → L035 error", () => {
  const r = parseCpeId("cpe:/o:linux:linux_kernel:5.4");
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.code, "MSL-L035");
    assertMatch(r.message, /2\.3/);
  }
});

Deno.test("parseCpeId: invalid part 'x' → L036 error", () => {
  const r = parseCpeId("cpe:2.3:x:vendor:product:*:*:*:*:*:*:*:*");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L036");
});

Deno.test("parseCpeId: wrong component count → L035 error", () => {
  // Only 10 components instead of 11
  const r = parseCpeId("cpe:2.3:o:linux:kernel:5.4:*:*:*:*:*:*");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L035");
});

// ---------------------------------------------------------------------------
// parseUrnSystemOrTool (§5.5)
// ---------------------------------------------------------------------------

Deno.test("parseUrnSystemOrTool: valid urn:system: → Component", () => {
  const r = parseUrnSystemOrTool("urn:system:can-bus.main");
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.type, "Component");
});

Deno.test("parseUrnSystemOrTool: valid multi-segment urn:system:", () => {
  const r = parseUrnSystemOrTool("urn:system:backend:auth:service");
  assertEquals(r.ok, true);
});

Deno.test("parseUrnSystemOrTool: valid urn:tool: → SoftwareComponent", () => {
  const r = parseUrnSystemOrTool("urn:tool:gcc.13");
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.type, "SoftwareComponent");
});

Deno.test("parseUrnSystemOrTool: empty body → L037 error", () => {
  const r = parseUrnSystemOrTool("urn:system:");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L037");
});

Deno.test("parseUrnSystemOrTool: invalid char '@' → L037 error", () => {
  const r = parseUrnSystemOrTool("urn:tool:gcc@13");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L037");
});

Deno.test("parseUrnSystemOrTool: consecutive colons → L037 error", () => {
  const r = parseUrnSystemOrTool("urn:system:a::b");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L037");
});

Deno.test("parseUrnSystemOrTool: wrong prefix → L037 error", () => {
  const r = parseUrnSystemOrTool("urn:other:something");
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.code, "MSL-L037");
});

// ---------------------------------------------------------------------------
// parseComponentScheme — dispatcher
// ---------------------------------------------------------------------------

Deno.test("parseComponentScheme: routes pkg: to parsePurl", () => {
  const r = parseComponentScheme("pkg:cargo/serde");
  assertEquals(r !== null, true);
  assertEquals(r?.ok, true);
});

Deno.test("parseComponentScheme: routes mfg: to parseMfgId", () => {
  const r = parseComponentScheme("mfg:bosch:R0402");
  assertEquals(r !== null, true);
  assertEquals(r?.ok, true);
});

Deno.test("parseComponentScheme: routes gtin: to parseGtinId", () => {
  const r = parseComponentScheme("gtin:73513537");
  assertEquals(r !== null, true);
  assertEquals(r?.ok, true);
});

Deno.test("parseComponentScheme: routes cpe: to parseCpeId", () => {
  const r = parseComponentScheme(
    "cpe:2.3:o:linux:linux_kernel:5.4:*:*:*:*:*:*:*",
  );
  assertEquals(r !== null, true);
  assertEquals(r?.ok, true);
});

Deno.test("parseComponentScheme: routes urn:system: to parseUrnSystemOrTool", () => {
  const r = parseComponentScheme("urn:system:bus");
  assertEquals(r !== null, true);
  assertEquals(r?.ok, true);
});

Deno.test("parseComponentScheme: routes urn:tool: to parseUrnSystemOrTool", () => {
  const r = parseComponentScheme("urn:tool:cmake");
  assertEquals(r !== null, true);
  assertEquals(r?.ok, true);
});

Deno.test("parseComponentScheme: returns null for unknown scheme", () => {
  const r = parseComponentScheme("custom:foo:bar");
  assertEquals(r, null);
});

Deno.test("parseComponentScheme: returns null for plain RFC 3986 URI", () => {
  const r = parseComponentScheme("https://example.com/component");
  assertEquals(r, null);
});

// ---------------------------------------------------------------------------
// deriveTermSlug (from glossary parser — re-exported for testing)
// ---------------------------------------------------------------------------

Deno.test("deriveTermSlug: lowercase and trim", () => {
  assertEquals(deriveTermSlug("  ASIL  "), "asil");
});

Deno.test("deriveTermSlug: collapse whitespace to hyphen", () => {
  assertEquals(
    deriveTermSlug("Automotive Safety Integrity Level"),
    "automotive-safety-integrity-level",
  );
});

Deno.test("deriveTermSlug: drop invalid chars", () => {
  assertEquals(deriveTermSlug("C++"), "c");
});

Deno.test("deriveTermSlug: preserve allowed chars", () => {
  assertEquals(deriveTermSlug("my.term/path_1"), "my.term/path_1");
});

Deno.test("deriveTermSlug: parenthetical acronym in term", () => {
  // The acronym part stays after dropping parens
  assertEquals(
    deriveTermSlug("Automotive Safety Integrity Level (ASIL)"),
    "automotive-safety-integrity-level-asil",
  );
});
