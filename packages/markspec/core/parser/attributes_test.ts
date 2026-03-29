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
  const content = "Body text directly adjacent to attributes.\nId: SRS_01HGW2Q8MNP3";
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
