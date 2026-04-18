/**
 * @module parser/attributes_test
 *
 * Unit tests for attribute block parsing.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { parseAttributes, splitBodyAndAttributes } from "./attributes.ts";

// ---------------------------------------------------------------------------
// Backslash-separated attributes
// ---------------------------------------------------------------------------

Deno.test("parseAttributes: trailing backslash separators", () => {
  const lines = [
    "Id: SRS_01HGW2Q8MNP3\\",
    "Satisfies: SYS_BRK_0042\\",
    "Labels: ASIL-B",
  ];

  const attrs = parseAttributes(lines);
  assertEquals(attrs.length, 3);
  assertEquals(attrs[0], { key: "Id", value: "SRS_01HGW2Q8MNP3" });
  assertEquals(attrs[1], { key: "Satisfies", value: "SYS_BRK_0042" });
  assertEquals(attrs[2], { key: "Labels", value: "ASIL-B" });
});

// ---------------------------------------------------------------------------
// Single attribute (no backslash)
// ---------------------------------------------------------------------------

Deno.test("parseAttributes: single attribute without backslash", () => {
  const lines = ["Id: SRS_01HGW2Q8MNP3"];
  const attrs = parseAttributes(lines);
  assertEquals(attrs.length, 1);
  assertEquals(attrs[0], { key: "Id", value: "SRS_01HGW2Q8MNP3" });
});

// ---------------------------------------------------------------------------
// Reference entry attributes
// ---------------------------------------------------------------------------

Deno.test("parseAttributes: reference entry attributes (Document, URL)", () => {
  const lines = [
    "Document: ISO 26262-6:2018\\",
    "URL: https://www.iso.org/standard/68383.html",
  ];

  const attrs = parseAttributes(lines);
  assertEquals(attrs.length, 2);
  assertEquals(attrs[0], { key: "Document", value: "ISO 26262-6:2018" });
  assertEquals(attrs[1], {
    key: "URL",
    value: "https://www.iso.org/standard/68383.html",
  });
});

// ---------------------------------------------------------------------------
// Whitespace handling
// ---------------------------------------------------------------------------

Deno.test("parseAttributes: trims leading/trailing whitespace from values", () => {
  const lines = ["Id:   SRS_01HGW2Q8MNP3  \\", "Labels:  ASIL-B  "];
  const attrs = parseAttributes(lines);
  assertEquals(attrs[0].value, "SRS_01HGW2Q8MNP3");
  assertEquals(attrs[1].value, "ASIL-B");
});

// ---------------------------------------------------------------------------
// All known attribute keys
// ---------------------------------------------------------------------------

Deno.test("parseAttributes: all builtin typed entry attributes", () => {
  const lines = [
    "Id: SRS_01HGW2Q8MNP3\\",
    "Satisfies: SYS_BRK_0042\\",
    "Derived-from: ISO-26262-6 §9.4\\",
    "Labels: ASIL-B, safety",
  ];

  const attrs = parseAttributes(lines);
  assertEquals(attrs.length, 4);
  assertEquals(attrs[0].key, "Id");
  assertEquals(attrs[1].key, "Satisfies");
  assertEquals(attrs[2].key, "Derived-from");
  assertEquals(attrs[2].value, "ISO-26262-6 §9.4");
  assertEquals(attrs[3].key, "Labels");
  assertEquals(attrs[3].value, "ASIL-B, safety");
});

Deno.test("parseAttributes: reference entry specific attributes", () => {
  const lines = [
    "Document: RTCA DO-178C\\",
    "URL: https://www.rtca.org/products/do-178c/\\",
    "Status: active\\",
    "Superseded-by: DO-178D",
  ];

  const attrs = parseAttributes(lines);
  assertEquals(attrs.length, 4);
  assertEquals(attrs[0].key, "Document");
  assertEquals(attrs[1].key, "URL");
  assertEquals(attrs[2].key, "Status");
  assertEquals(attrs[2].value, "active");
  assertEquals(attrs[3].key, "Superseded-by");
  assertEquals(attrs[3].value, "DO-178D");
});

// ---------------------------------------------------------------------------
// Empty / no attributes
// ---------------------------------------------------------------------------

Deno.test("parseAttributes: empty input returns empty array", () => {
  assertEquals(parseAttributes([]), []);
});

// ---------------------------------------------------------------------------
// Non-attribute lines are not parsed
// ---------------------------------------------------------------------------

Deno.test("splitBodyAndAttributes: no blank line between body and attributes", () => {
  const content =
    "Body text directly adjacent to attributes.\nId: SRS_01HGW2Q8MNP3";
  const [body, attrs] = splitBodyAndAttributes(content);
  assertStringIncludes(body, "Body text directly adjacent");
  assertEquals(attrs.length, 1);
  assertEquals(attrs[0], "Id: SRS_01HGW2Q8MNP3");
});

Deno.test("parseAttributes: lines without Key: Value pattern are skipped", () => {
  const lines = [
    "This is just body text",
    "Id: SRS_01HGW2Q8MNP3",
  ];
  // parseAttributes only receives already-identified attribute lines
  // so this tests robustness — first line has no colon-space
  const attrs = parseAttributes(lines);
  // The first line doesn't match Key: Value, so it's skipped
  assertEquals(attrs.length, 1);
  assertEquals(attrs[0].key, "Id");
});

// ---------------------------------------------------------------------------
// collateAttributes — ADR-002 §2.6 repeatable attribute handling
// ---------------------------------------------------------------------------

import { collateAttributes } from "./attributes.ts";

Deno.test("collateAttributes: single-valued attribute is kept as-is", () => {
  const collated = collateAttributes([
    { key: "Spec-id", value: "01HGW2Q8MNP3" },
  ]);
  assertEquals(collated.get("Spec-id"), ["01HGW2Q8MNP3"]);
});

Deno.test("collateAttributes: id-list multi-line values merge", () => {
  const collated = collateAttributes([
    { key: "Derived-from", value: "SYS_BRK_0042" },
    { key: "Derived-from", value: "SYS_BRK_0043" },
  ]);
  assertEquals(collated.get("Derived-from"), ["SYS_BRK_0042", "SYS_BRK_0043"]);
});

Deno.test("collateAttributes: id-list CSV on one line splits", () => {
  const collated = collateAttributes([
    { key: "Derived-from", value: "SYS_BRK_0042, SYS_BRK_0043" },
  ]);
  assertEquals(collated.get("Derived-from"), ["SYS_BRK_0042", "SYS_BRK_0043"]);
});

Deno.test("collateAttributes: tag-list CSV splits", () => {
  const collated = collateAttributes([
    { key: "Labels", value: "ASIL-B, safety, automotive" },
  ]);
  assertEquals(collated.get("Labels"), ["ASIL-B", "safety", "automotive"]);
});

Deno.test("collateAttributes: citation does not CSV-split (locators may contain commas)", () => {
  const collated = collateAttributes([
    { key: "References", value: "ISO-26262-6 §9.4, Table 7" },
    { key: "References", value: "UNECE-R155" },
  ]);
  assertEquals(collated.get("References"), [
    "ISO-26262-6 §9.4, Table 7",
    "UNECE-R155",
  ]);
});

Deno.test("collateAttributes: external-id CSV splits", () => {
  const collated = collateAttributes([
    { key: "External-id", value: "doors:VHC:001, codebeamer:42" },
  ]);
  assertEquals(collated.get("External-id"), [
    "doors:VHC:001",
    "codebeamer:42",
  ]);
});

Deno.test("collateAttributes: unknown keys preserved one entry per occurrence", () => {
  const collated = collateAttributes([
    { key: "Bespoke", value: "alpha" },
    { key: "Bespoke", value: "beta" },
  ]);
  assertEquals(collated.get("Bespoke"), ["alpha", "beta"]);
});

Deno.test("collateAttributes: mixes multi-line and CSV correctly", () => {
  const collated = collateAttributes([
    { key: "Labels", value: "ASIL-B, safety" },
    { key: "Labels", value: "automotive" },
  ]);
  assertEquals(collated.get("Labels"), ["ASIL-B", "safety", "automotive"]);
});

Deno.test("collateAttributes: empty input returns empty map", () => {
  const collated = collateAttributes([]);
  assertEquals(collated.size, 0);
});
