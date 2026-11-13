import { assert, assertEquals } from "@std/assert";
import { loadGherkin } from "./load.ts";
import { parseFeature } from "./parse.ts";
import { type StepRole, stepRoles } from "./procedure.ts";

const api = await loadGherkin();

function roles(source: string): StepRole[] {
  const result = parseFeature(api, source);
  assert(result.ok, result.ok ? "" : result.message);
  return stepRoles(result.feature.scenarios[0].steps);
}

Deno.test("stepRoles: Given, When, Then", () => {
  assertEquals(roles("Scenario: S\n  Given a\n  When b\n  Then c\n"), [
    "precondition",
    "action",
    "outcome",
  ]);
});

Deno.test("stepRoles: And takes the role of the step before it", () => {
  assertEquals(
    roles(
      "Scenario: S\n  Given a\n  And b\n  When c\n  And d\n  Then e\n  And f\n",
    ),
    [
      "precondition",
      "precondition",
      "action",
      "action",
      "outcome",
      "outcome",
    ],
  );
});

Deno.test("stepRoles: But after Then is an outcome", () => {
  assertEquals(roles("Scenario: S\n  When a\n  Then b\n  But c\n"), [
    "action",
    "outcome",
    "outcome",
  ]);
});

Deno.test("stepRoles: a star step is an action after Then", () => {
  assertEquals(roles("Scenario: S\n  Then a\n  * b\n  And c\n"), [
    "outcome",
    "action",
    "action",
  ]);
});

Deno.test("stepRoles: a star step is an action after Given", () => {
  assertEquals(roles("Scenario: S\n  Given a\n  * b\n"), [
    "precondition",
    "action",
  ]);
});

Deno.test("stepRoles: a first And is an action", () => {
  assertEquals(roles("Scenario: S\n  And a\n  Then b\n"), [
    "action",
    "outcome",
  ]);
});

Deno.test("stepRoles: French keywords", () => {
  assertEquals(
    roles(
      "# language: fr\nScénario: S\n  Soit a\n  Quand b\n  Alors c\n  Et d\n",
    ),
    ["precondition", "action", "outcome", "outcome"],
  );
});

Deno.test("stepRoles: an empty list gives no roles", () => {
  assertEquals(stepRoles([]), []);
});
