/**
 * @module core/validator/feature_ac_test
 *
 * Unit tests for the MSL-B044 validator (Feature block + Acceptance
 * criteria list collision).
 *
 * TDD: RED → GREEN per code.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Entry } from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";
import { buildBodyAst } from "../ast/build.ts";
import { validateFeatureAc } from "./feature_ac.ts";

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
// Positive cases — MSL-B044 should fire
// ---------------------------------------------------------------------------

Deno.test("validateFeatureAc: Feature + AC list (paragraph label before) → MSL-B044", () => {
  const body = [
    "The system shall handle emergency braking.",
    "",
    "```gherkin",
    "Feature: Emergency braking",
    "  Scenario: Collision avoidance",
    "    Given the vehicle is moving at 60 km/h",
    "    When an obstacle is detected at 30 m",
    "    Then emergency braking is applied",
    "```",
    "",
    "Acceptance criteria",
    "",
    "- The vehicle stops within the required distance",
    "- No false activations occur",
  ].join("\n");
  const entry = makeEntry("REQ-001", body);
  const diags = validateFeatureAc(entry);
  const b044 = diags.filter((d) => d.code === "MSL-B044");
  assertEquals(b044.length, 1, `expected 1 MSL-B044, got ${b044.length}`);
  assertEquals(b044[0].severity, "warning");
  assertStringIncludes(b044[0].message, "Feature");
  assertStringIncludes(b044[0].message, "Acceptance criteria");
});

Deno.test("validateFeatureAc: Feature + AC list (case-insensitive label) → MSL-B044", () => {
  const body = [
    "Body prose.",
    "",
    "```gherkin",
    "Feature: Braking",
    "  Scenario: Stop",
    "    Given moving",
    "    Then stopped",
    "```",
    "",
    "ACCEPTANCE CRITERIA",
    "",
    "- Criterion one",
    "- Criterion two",
  ].join("\n");
  const entry = makeEntry("REQ-002", body);
  const diags = validateFeatureAc(entry);
  assertEquals(diags.filter((d) => d.code === "MSL-B044").length, 1);
});

Deno.test("validateFeatureAc: Feature + AC list (label follows list) → MSL-B044", () => {
  const body = [
    "Body prose.",
    "",
    "```gherkin",
    "Feature: Braking",
    "  Scenario: Stop",
    "    Given moving",
    "    Then stopped",
    "```",
    "",
    "- Criterion one",
    "- Criterion two",
    "",
    "Acceptance Criteria for the requirement above.",
  ].join("\n");
  const entry = makeEntry("REQ-003", body);
  const diags = validateFeatureAc(entry);
  assertEquals(diags.filter((d) => d.code === "MSL-B044").length, 1);
});

// ---------------------------------------------------------------------------
// Negative cases — MSL-B044 should NOT fire
// ---------------------------------------------------------------------------

Deno.test("validateFeatureAc: Feature only, no AC list → no MSL-B044", () => {
  const body = [
    "Body prose.",
    "",
    "```gherkin",
    "Feature: Emergency braking",
    "  Scenario: Collision avoidance",
    "    Given moving",
    "    Then stopped",
    "```",
  ].join("\n");
  const entry = makeEntry("REQ-004", body);
  const diags = validateFeatureAc(entry);
  assertEquals(diags.filter((d) => d.code === "MSL-B044").length, 0);
});

Deno.test("validateFeatureAc: AC list only, no Feature → no MSL-B044", () => {
  const body = [
    "Acceptance criteria",
    "",
    "- Criterion one",
    "- Criterion two",
  ].join("\n");
  const entry = makeEntry("REQ-005", body);
  const diags = validateFeatureAc(entry);
  assertEquals(diags.filter((d) => d.code === "MSL-B044").length, 0);
});

Deno.test("validateFeatureAc: plain list without AC label → no MSL-B044", () => {
  const body = [
    "Body prose.",
    "",
    "```gherkin",
    "Feature: Emergency braking",
    "  Scenario: Stop",
    "    Given moving",
    "    Then stopped",
    "```",
    "",
    "Implementation notes",
    "",
    "- Note one",
    "- Note two",
  ].join("\n");
  const entry = makeEntry("REQ-006", body);
  const diags = validateFeatureAc(entry);
  assertEquals(diags.filter((d) => d.code === "MSL-B044").length, 0);
});

Deno.test("validateFeatureAc: Feature + list whose first item begins with 'Acceptance criteria' (Strategy 3 only) → MSL-B044", () => {
  // No separate label paragraph — Strategy 1 and Strategy 2 cannot match.
  // Only Strategy 3 (first list item text starts with "Acceptance criteria")
  // can trigger the diagnostic.
  const body = [
    "Body prose.",
    "",
    "```gherkin",
    "Feature: Emergency braking",
    "  Scenario: Collision avoidance",
    "    Given the vehicle is moving at 60 km/h",
    "    When an obstacle is detected at 30 m",
    "    Then emergency braking is applied",
    "```",
    "",
    "- Acceptance criteria: vehicle stops within distance",
    "- No false activations occur",
  ].join("\n");
  const entry = makeEntry("REQ-008", body);
  const diags = validateFeatureAc(entry);
  const b044 = diags.filter((d) => d.code === "MSL-B044");
  assertEquals(b044.length, 1, `expected 1 MSL-B044, got ${b044.length}`);
  assertEquals(b044[0].severity, "warning");
  assertStringIncludes(b044[0].message, "Acceptance criteria");
});

Deno.test("validateFeatureAc: no bodyAst → no MSL-B044", () => {
  const entry: Entry = {
    displayId: makeDisplayId("REQ-007"),
    title: "Test",
    body: "```gherkin\nFeature: X\n```\n\nAcceptance criteria\n\n- A",
    bodyAst: undefined,
    rawAttributes: [],
    id: undefined,
    shape: "Authored",
    location: { file: "test.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    typedAttributes: new Map(),
    bodyTokens: [],
  };
  const diags = validateFeatureAc(entry);
  assertEquals(diags.filter((d) => d.code === "MSL-B044").length, 0);
});
