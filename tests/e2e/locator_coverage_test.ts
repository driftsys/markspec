/**
 * @module tests/e2e/locator_coverage_test
 *
 * E2E acceptance tests for scenario locators (epic #915, scenario-locator
 * slice). A `Verifies` value may address one scenario of its target:
 * `Verifies: REQ_BRK_0010 [Brake at 20 m]`. The locator is kept in the
 * compiled graph, checked by `markspec check`, and counted per criterion in
 * `markspec report coverage`.
 *
 * Plan: docs/wip/2026-11-13-gherkin-scenario-locators-plan.md (Task 0).
 * Each test is ignored until the task that makes it pass lands.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROFILE_YAML = `id: "@acme/brk"
version: 0.1.0
markspec-schema: "1"
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ_BRK_{n:04d}"
    test:
      extends: Test
      display-id-pattern: "TST_BRK_{n:04d}"
      traceability:
        Verifies:
          target: [requirement]
          cardinality: 0..3
          required: false
`;

const ENTRIES_MD = `# Braking

- [REQ_BRK_0010] Emergency braking for close obstacles

  The braking controller shall start braking when an obstacle is detected
  closer than 40 m at speeds of 60 km/h or less.

  \`\`\`feature
  Scenario: Brake at 20 m
    When an obstacle appears at 20 m
    Then braking starts within 200 ms

  Scenario: No braking beyond 40 m
    When an obstacle appears at 50 m
    Then the controller does not brake
  \`\`\`

      Id: 01REQ00000000000000000010A

- [TST_BRK_0012] Brake reaction at 20 m

  Place the target at 20 m and measure the brake reaction.

      Id: 01TST00000000000000000012A
      Verifies: REQ_BRK_0010 [Brake at 20 m]

- [TST_BRK_0013] Brake reaction at 30 m

  Place the target at 30 m and measure the brake reaction.

      Id: 01TST00000000000000000013A
      Verifies: REQ_BRK_0010 [Brake at 30 m]
`;

const FILES = {
  "project.yaml": `name: brk\nversion: 0.1.0\n`,
  ".markspec.yaml": `profiles:\n  - ./profiles/brk\n`,
  "profiles/brk/markspec.yaml": PROFILE_YAML,
  "docs/braking.md": ENTRIES_MD,
};

// Enabled by Task 4 (compiler keeps locators and attaches criteria).
Deno.test({
  name: "locator coverage: compile json keeps the locator",
  fn: async () => {
    const { code, stdout } = await markspec(
      ["compile", "docs/braking.md", "--format", "json"],
      FILES,
    );
    assertEquals(code, 0);
    const compiled = JSON.parse(stdout);
    // deno-lint-ignore no-explicit-any
    const link = (compiled.links as any[]).find((l) =>
      l.from === "TST_BRK_0012" && l.to === "REQ_BRK_0010"
    );
    assertEquals(link?.from, "TST_BRK_0012");
    assertEquals(link?.locator, "Brake at 20 m");
    assertEquals(link?.locatorResolved, true);
    // deno-lint-ignore no-explicit-any
    const unresolved = (compiled.links as any[]).find((l) =>
      l.from === "TST_BRK_0013" && l.to === "REQ_BRK_0010"
    );
    assertEquals(unresolved?.locator, "Brake at 30 m");
    assertEquals(unresolved?.locatorResolved, false);
  },
});

// Enabled by Task 5 (diagnostics MSL-L007).
Deno.test({
  name: "locator coverage: check warns on an unresolved locator",
  fn: async () => {
    const { code, stderr } = await markspec(
      ["check", "docs/braking.md"],
      FILES,
    );
    assertStringIncludes(stderr, "MSL-L007");
    assertStringIncludes(stderr, "Brake at 30 m");
    // The resolved locator on TST_BRK_0012 raises no MSL-L007.
    const l007 = stderr.split("\n").filter((l) => l.includes("MSL-L007"));
    assertEquals(l007.length, 1);
    assertEquals(l007.some((l) => l.includes("TST_BRK_0012")), false);
    // Exit 2 = warnings only; the fixture raises no other warning.
    assertEquals(code, 2);
  },
});

// Task 5: a locator is not part of the target for value-type and
// existence checks, project-wide included.
Deno.test({
  name: "locator coverage: check does not treat a locator as part of the id",
  fn: async () => {
    const { stderr } = await markspec(["check"], FILES);
    assertStringIncludes(stderr, "MSL-L007");
    assertEquals(stderr.includes("MSL-A004"), false);
    assertEquals(stderr.includes("MSL-L006"), false);
  },
});

// Enabled by Task 7 (criterion-level coverage report).
Deno.test({
  name: "locator coverage: report coverage json has criteria",
  fn: async () => {
    const { code, stdout } = await markspec(
      ["report", "coverage", "docs/braking.md", "--format", "json"],
      FILES,
    );
    assertEquals(code, 0);
    const report = JSON.parse(stdout);
    // deno-lint-ignore no-explicit-any
    const first = (report.criteria.entries as any[]).find((e) =>
      e.displayId === "REQ_BRK_0010"
    );
    assertEquals(first?.displayId, "REQ_BRK_0010");
    assertEquals(first.state, "partial");
    assertEquals(first.verified, 1);
    assertEquals(first.total, 2);
  },
});
