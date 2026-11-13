import { assert, assertEquals } from "@std/assert";
import { loadGherkin } from "./load.ts";
import { parseFeature } from "./parse.ts";
import {
  type ScenarioProcedure,
  scenarioProcedure,
  type StepRole,
  stepRoles,
} from "./procedure.ts";

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

Deno.test("stepRoles: And after a star step is an action, not Given", () => {
  assertEquals(roles("Scenario: S\n  Given a\n  * b\n  And c\n"), [
    "precondition",
    "action",
    "action",
  ]);
});

function procedure(source: string): ScenarioProcedure {
  const result = parseFeature(api, source);
  assert(result.ok, result.ok ? "" : result.message);
  return scenarioProcedure(result.feature.scenarios[0]);
}

function texts(refs: ScenarioProcedure["preconditions"]): string[] {
  return refs.map((r) => r.step.text);
}

Deno.test("scenarioProcedure: the radar example has two steps", () => {
  const p = procedure(
    "Scenario: Radar calibration\n" +
      "  Given the radar is mounted on the bench\n" +
      "  * place the target at 10 m\n" +
      "  Then the measured range is 10 m\n" +
      "  * move the target to 50 m\n" +
      "  Then the measured range is 50 m\n",
  );
  assertEquals(texts(p.preconditions), ["the radar is mounted on the bench"]);
  assertEquals(p.preconditions[0].role, "precondition");
  assertEquals(p.preconditions[0].origin, "scenario");
  assertEquals(p.steps.length, 2);
  assertEquals(p.steps.map((s) => s.n), [1, 2]);
  assertEquals(texts(p.steps[0].actions), ["place the target at 10 m"]);
  assertEquals(texts(p.steps[0].expected), ["the measured range is 10 m"]);
  assertEquals(texts(p.steps[1].actions), ["move the target to 50 m"]);
  assertEquals(texts(p.steps[1].expected), ["the measured range is 50 m"]);
});

Deno.test("scenarioProcedure: Given and Then give one step without actions", () => {
  const p = procedure("Scenario: S\n  Given a\n  Then b\n");
  assertEquals(texts(p.preconditions), ["a"]);
  assertEquals(p.steps.length, 1);
  assertEquals(p.steps[0].actions, []);
  assertEquals(texts(p.steps[0].expected), ["b"]);
});

Deno.test("scenarioProcedure: a trailing action has no expected result", () => {
  const p = procedure("Scenario: S\n  When a\n  Then b\n  When c\n");
  assertEquals(p.steps.length, 2);
  assertEquals(texts(p.steps[1].actions), ["c"]);
  assertEquals(p.steps[1].expected, []);
});

Deno.test("scenarioProcedure: Given after an action opens a step with setup", () => {
  const p = procedure("Scenario: S\n  When a\n  Given b\n  Then c\n");
  assertEquals(p.steps.length, 2);
  assertEquals(texts(p.steps[0].actions), ["a"]);
  assertEquals(p.steps[0].setup, []);
  assertEquals(texts(p.steps[1].setup), ["b"]);
  assertEquals(p.steps[1].setup[0].role, "precondition");
  assertEquals(p.steps[1].actions, []);
  assertEquals(texts(p.steps[1].expected), ["c"]);
});

Deno.test("scenarioProcedure: When, star, Then and And are one step", () => {
  const p = procedure(
    "Scenario: S\n  When a\n  * b\n  Then c\n  And d\n",
  );
  assertEquals(p.steps.length, 1);
  assertEquals(texts(p.steps[0].actions), ["a", "b"]);
  assertEquals(texts(p.steps[0].expected), ["c", "d"]);
});

Deno.test("scenarioProcedure: an empty scenario has no steps", () => {
  const p = procedure("Scenario: S\n");
  assertEquals(p.preconditions, []);
  assertEquals(p.steps, []);
});

Deno.test("scenarioProcedure: a leading Then gives expected only, then an action opens step 2", () => {
  const p = procedure("Scenario: S\n  Then a\n  When b\n");
  assertEquals(p.steps.map((s) => s.n), [1, 2]);
  assertEquals(texts(p.steps[0].expected), ["a"]);
  assertEquals(texts(p.steps[1].actions), ["b"]);
});
