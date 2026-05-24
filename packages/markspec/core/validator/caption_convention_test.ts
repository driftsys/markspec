/**
 * @module core/validator/caption_convention_test
 *
 * Unit tests for the MSL-C072 validator (caption position vs
 * project-configured convention).
 *
 * TDD: RED → GREEN per code.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { CaptionConventions, Entry } from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";
import { buildBodyAst } from "../ast/build.ts";
import { validateCaptionConvention } from "./caption_convention.ts";

function makeEntry(displayId: string, body: string): Entry {
  return {
    displayId: makeDisplayId(displayId),
    title: "Test entry",
    body,
    bodyAst: buildBodyAst(body),
    rawAttributes: [],
    id: undefined,
    shape: "Authored",
    location: { file: "test.md", line: 10, column: 1 },
    source: { kind: "markdown" },
    typedAttributes: new Map(),
    bodyTokens: [],
  };
}

// ---------------------------------------------------------------------------
// Positive cases — MSL-C072 should fire
// ---------------------------------------------------------------------------

Deno.test("validateCaptionConvention: Figure below but convention=above → MSL-C072", () => {
  // Caption below the figure, but convention requires above.
  const body = [
    "![Brake diagram](brake.svg)",
    "",
    "Figure: Brake pressure diagram",
  ].join("\n");
  const conventions: CaptionConventions = { Figure: "above" };
  const entry = makeEntry("REQ-001", body);
  const diags = validateCaptionConvention(entry, conventions);
  const c072 = diags.filter((d) => d.code === "MSL-C072");
  assertEquals(c072.length, 1, `expected 1 MSL-C072, got ${c072.length}`);
  assertEquals(c072[0].severity, "warning");
  assertStringIncludes(c072[0].message, "Figure");
  assertStringIncludes(c072[0].message, "below");
  assertStringIncludes(c072[0].message, "above");
});

Deno.test("validateCaptionConvention: Table above but convention=below → MSL-C072", () => {
  // Caption above the table, but convention requires below.
  const body = [
    "Table: System requirements overview",
    "",
    "| Req | Description |",
    "| --- | ----------- |",
    "| R1  | Sensor input |",
  ].join("\n");
  const conventions: CaptionConventions = { Table: "below" };
  const entry = makeEntry("REQ-002", body);
  const diags = validateCaptionConvention(entry, conventions);
  const c072 = diags.filter((d) => d.code === "MSL-C072");
  assertEquals(c072.length, 1, `expected 1 MSL-C072, got ${c072.length}`);
  assertEquals(c072[0].severity, "warning");
  assertStringIncludes(c072[0].message, "Table");
});

Deno.test("validateCaptionConvention: multiple violations → multiple MSL-C072", () => {
  // Two figures both below, convention says above for Figure.
  const body = [
    "![Diagram 1](a.svg)",
    "",
    "Figure: Diagram one",
    "",
    "More text.",
    "",
    "![Diagram 2](b.svg)",
    "",
    "Figure: Diagram two",
  ].join("\n");
  const conventions: CaptionConventions = { Figure: "above" };
  const entry = makeEntry("REQ-003", body);
  const diags = validateCaptionConvention(entry, conventions);
  const c072 = diags.filter((d) => d.code === "MSL-C072");
  assertEquals(
    c072.length,
    2,
    `expected 2 MSL-C072, got ${c072.length}; diags: ${JSON.stringify(diags)}`,
  );
});

// ---------------------------------------------------------------------------
// Negative cases — MSL-C072 should NOT fire
// ---------------------------------------------------------------------------

Deno.test("validateCaptionConvention: Figure below and convention=below → no MSL-C072", () => {
  const body = [
    "![Brake diagram](brake.svg)",
    "",
    "Figure: Brake pressure diagram",
  ].join("\n");
  const conventions: CaptionConventions = { Figure: "below" };
  const entry = makeEntry("REQ-004", body);
  const diags = validateCaptionConvention(entry, conventions);
  assertEquals(diags.filter((d) => d.code === "MSL-C072").length, 0);
});

Deno.test("validateCaptionConvention: Figure above and convention=above → no MSL-C072", () => {
  const body = [
    "Figure: Brake pressure diagram",
    "",
    "![Brake diagram](brake.svg)",
  ].join("\n");
  const conventions: CaptionConventions = { Figure: "above" };
  const entry = makeEntry("REQ-005", body);
  const diags = validateCaptionConvention(entry, conventions);
  assertEquals(diags.filter((d) => d.code === "MSL-C072").length, 0);
});

Deno.test("validateCaptionConvention: empty conventions → no MSL-C072", () => {
  const body = [
    "![Brake diagram](brake.svg)",
    "",
    "Figure: Brake pressure diagram",
  ].join("\n");
  const conventions: CaptionConventions = {};
  const entry = makeEntry("REQ-006", body);
  const diags = validateCaptionConvention(entry, conventions);
  assertEquals(diags.filter((d) => d.code === "MSL-C072").length, 0);
});

Deno.test("validateCaptionConvention: Figure keyword not in conventions → no MSL-C072", () => {
  // Only Table is configured, Figure is unconstrained.
  const body = [
    "![Brake diagram](brake.svg)",
    "",
    "Figure: Brake pressure diagram",
  ].join("\n");
  const conventions: CaptionConventions = { Table: "above" };
  const entry = makeEntry("REQ-007", body);
  const diags = validateCaptionConvention(entry, conventions);
  assertEquals(diags.filter((d) => d.code === "MSL-C072").length, 0);
});

Deno.test("validateCaptionConvention: no bodyAst → no MSL-C072", () => {
  const entry: Entry = {
    displayId: makeDisplayId("REQ-008"),
    title: "Test",
    body: "Figure: Caption\n\n![x](y.svg)",
    bodyAst: undefined,
    rawAttributes: [],
    id: undefined,
    shape: "Authored",
    location: { file: "test.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    typedAttributes: new Map(),
    bodyTokens: [],
  };
  const conventions: CaptionConventions = { Figure: "below" };
  const diags = validateCaptionConvention(entry, conventions);
  assertEquals(diags.filter((d) => d.code === "MSL-C072").length, 0);
});
