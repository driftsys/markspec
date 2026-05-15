/**
 * @module core/validator/modal_keywords_test
 *
 * Unit tests for the MSL-M060 / MSL-M061 validator.
 *
 * PR 5: validates the AST-based migration. Tests build entry bodies
 * using `buildBodyAst` to populate `entry.bodyAst`, ensuring the
 * validator consumes the pre-built AST rather than re-scanning the
 * body string.
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../model/mod.ts";
import { buildBodyAst } from "../ast/build.ts";
import { validateModalKeywords } from "./modal_keywords.ts";

function makeEntry(
  displayId: string,
  body: string,
  type?: string,
): Entry {
  const bodyAst = buildBodyAst(body);
  return {
    displayId,
    title: "Test entry",
    body,
    bodyAst,
    rawAttributes: [],
    id: undefined,
    shape: "identified",
    location: { file: "test.md", line: 10, column: 1 },
    source: "markdown",
    typedAttributes: new Map(type ? [["Type", [type]]] : []),
    type,
  };
}

// ---------------------------------------------------------------------------
// MSL-M060 — uppercase modal keywords
// ---------------------------------------------------------------------------

Deno.test("validateModalKeywords: lowercase shall — no MSL-M060", () => {
  const entry = makeEntry(
    "REQ-001",
    "The system shall handle all requests.",
  );
  const diags = validateModalKeywords(entry);
  const m060 = diags.filter((d) => d.code === "MSL-M060");
  assertEquals(m060, []);
});

Deno.test("validateModalKeywords: uppercase SHALL — fires MSL-M060", () => {
  const entry = makeEntry(
    "REQ-001",
    "The system SHALL handle all requests.",
  );
  const diags = validateModalKeywords(entry);
  const m060 = diags.filter((d) => d.code === "MSL-M060");
  assertEquals(m060.length, 1);
  assertEquals(m060[0].severity, "warning");
  assertEquals(m060[0].message.includes("SHALL"), true);
});

Deno.test("validateModalKeywords: uppercase keyword in code fence — NOT flagged", () => {
  // MSL-M060 — keywords inside verbatim code blocks must be excluded.
  // The AST does not extract ModalMarkers from CodeNode content.
  const body = [
    "Prose before the fence.",
    "",
    "```",
    "SHALL_CONSTANT = 42",
    "```",
    "",
    "Prose after the fence.",
  ].join("\n");
  const entry = makeEntry("REQ-001", body);
  const diags = validateModalKeywords(entry);
  const m060 = diags.filter((d) => d.code === "MSL-M060");
  assertEquals(m060, []);
});

Deno.test("validateModalKeywords: uppercase modal in list item — fires MSL-M060", () => {
  const body = [
    "Conditions:",
    "",
    "- The sensor SHOULD report every 10 ms.",
  ].join("\n");
  const entry = makeEntry("REQ-001", body);
  const diags = validateModalKeywords(entry);
  const m060 = diags.filter((d) => d.code === "MSL-M060");
  assertEquals(m060.length, 1);
  assertEquals(m060[0].message.includes("SHOULD"), true);
});

// ---------------------------------------------------------------------------
// MSL-M061 — Requirement entry with no modal keyword
// ---------------------------------------------------------------------------

Deno.test("validateModalKeywords: Requirement type with no modal → MSL-M061", () => {
  const entry = makeEntry(
    "REQ-001",
    "The system handles requests.",
    "Requirement",
  );
  const diags = validateModalKeywords(entry);
  const m061 = diags.filter((d) => d.code === "MSL-M061");
  assertEquals(m061.length, 1);
  assertEquals(m061[0].severity, "info");
});

Deno.test("validateModalKeywords: non-Requirement type with no modal → no MSL-M061", () => {
  const entry = makeEntry(
    "TST-001",
    "Verify that the system handles all requests.",
    "Test",
  );
  const diags = validateModalKeywords(entry);
  const m061 = diags.filter((d) => d.code === "MSL-M061");
  assertEquals(m061, []);
});
