/**
 * @module core/validator/locators_test
 *
 * Unit tests for the locator and scenario-name diagnostics (epic #915):
 * MSL-L007, MSL-L008, MSL-L009, MSL-B060 and MSL-B061.
 */

import { assertEquals } from "@std/assert";
import type { Diagnostic } from "../model/mod.ts";
import { parse } from "../parser/mod.ts";
import { validateLocators } from "./locators.ts";

const REQ = `
- [REQ_BRK_0010] Emergency braking

  The controller shall brake.

  \`\`\`feature
  Scenario: Brake at 20 m
    When an obstacle appears at 20 m
    Then braking starts

  Scenario: Twice
    Given a

  Scenario: Twice
    Given b

  Scenario:
    Given c
  \`\`\`

      Id: 01REQ00000000000000000010A
      Type: Requirement

- [SWC_X] Brake controller

  The brake controller component.

      Id: 01SWC0000000000000000000XA
      Type: Component
`;

function run(tests: string): Diagnostic[] {
  // Stand in for Stage 2 classification: take the type from `Type:`.
  const entries = [
    ...parse(REQ, { file: "/r.md" }),
    ...parse(tests, { file: "/t.md" }),
  ].map((e) => ({ ...e, type: e.typedAttributes.get("Type")?.[0] }));
  return validateLocators(entries, null);
}

function codes(diags: readonly Diagnostic[], code: string): Diagnostic[] {
  return diags.filter((d) => d.code === code);
}

function testEntry(...trailer: string[]): string {
  return `
- [TST_BRK_0013] Brake reaction

  Measure the brake reaction.

      Id: 01TST00000000000000000013A
      Type: Test
${trailer.map((t) => `      ${t}`).join("\n")}
`;
}

Deno.test("validateLocators: unresolved locator → MSL-L007 at the trailer line", () => {
  const diags = codes(
    run(testEntry("Verifies: REQ_BRK_0010 [Brake at 30 m]")),
    "MSL-L007",
  );
  assertEquals(diags.length, 1);
  assertEquals(diags[0].severity, "warning");
  assertEquals(
    diags[0].message,
    "TST_BRK_0013: locator 'Brake at 30 m' matches no scenario of REQ_BRK_0010",
  );
  assertEquals(diags[0].location, { file: "/t.md", line: 8, column: 1 });
});

Deno.test("validateLocators: resolved locator → no MSL-L007", () => {
  const diags = run(testEntry("Verifies: REQ_BRK_0010 [Brake  at 20 m]"));
  assertEquals(codes(diags, "MSL-L007"), []);
});

Deno.test("validateLocators: locator naming a duplicate scenario → MSL-L007", () => {
  const diags = run(testEntry("Verifies: REQ_BRK_0010 [Twice]"));
  assertEquals(codes(diags, "MSL-L007").length, 1);
});

Deno.test("validateLocators: locator on an unresolved target → no MSL-L007", () => {
  const diags = run(testEntry("Verifies: REQ_BRK_9999 [Brake at 20 m]"));
  assertEquals(codes(diags, "MSL-L007"), []);
});

Deno.test("validateLocators: locator on a criteria-less target → no MSL-L007", () => {
  const diags = run(testEntry("Satisfies: SWC_X [anything]"));
  assertEquals(codes(diags, "MSL-L007"), []);
});

Deno.test("validateLocators: locator on a Reference target → no MSL-L007 or L008", () => {
  const diags = run(testEntry("References: ISO-26262-6 [§4.3, Table 7]"));
  assertEquals(codes(diags, "MSL-L007"), []);
  assertEquals(codes(diags, "MSL-L008"), []);
});

Deno.test("validateLocators: locator on Allocated-to → MSL-L008", () => {
  const diags = codes(run(testEntry("Allocated-to: SWC_X [foo]")), "MSL-L008");
  assertEquals(diags.length, 1);
  assertEquals(diags[0].severity, "warning");
  assertEquals(diags[0].location?.line, 8);
  assertEquals(
    diags[0].message,
    "TST_BRK_0013: 'Allocated-to' does not accept a locator ('foo'); " +
      "only Satisfies, Derived-from, References and Verifies do. " +
      "The link to SWC_X is kept",
  );
});

Deno.test("validateLocators: hand-written Verified-by locator → MSL-L008", () => {
  const diags = run(testEntry("Verified-by: REQ_BRK_0010 [Brake at 20 m]"));
  assertEquals(codes(diags, "MSL-L008").length, 1);
});

Deno.test("validateLocators: non-relation attribute with brackets → no MSL-L008", () => {
  const diags = run(testEntry("Labels: draft [x]"));
  assertEquals(codes(diags, "MSL-L008"), []);
  assertEquals(codes(diags, "MSL-L009"), []);
});

Deno.test("validateLocators: unterminated locator → MSL-L009", () => {
  const diags = codes(
    run(testEntry("Verifies: REQ_BRK_0010 [Brake at 20 m, REQ_BRK_0011")),
    "MSL-L009",
  );
  assertEquals(diags.length, 1);
  assertEquals(diags[0].severity, "warning");
  assertEquals(diags[0].location?.line, 8);
});

Deno.test("validateLocators: duplicate scenario → MSL-B060 on the second one", () => {
  const diags = codes(run(""), "MSL-B060");
  assertEquals(diags.length, 1);
  assertEquals(diags[0].severity, "warning");
  assertEquals(diags[0].location?.line, 14);
});

Deno.test("validateLocators: empty scenario name → MSL-B061 info", () => {
  const diags = codes(run(""), "MSL-B061");
  assertEquals(diags.length, 1);
  assertEquals(diags[0].severity, "info");
  assertEquals(diags[0].location?.line, 17);
});
