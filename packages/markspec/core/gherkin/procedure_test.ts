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

Deno.test("scenarioProcedure: Then, And, When opens a new step at the When", () => {
  const p = procedure("Scenario: S\n  Then a\n  And b\n  When c\n");
  assertEquals(p.steps.length, 2);
  assertEquals(texts(p.steps[0].expected), ["a", "b"]);
  assertEquals(p.steps[0].actions, []);
  assertEquals(texts(p.steps[1].actions), ["c"]);
});

Deno.test("scenarioProcedure: star, Then, But, When gives two steps", () => {
  const p = procedure("Scenario: S\n  * a\n  Then b\n  But c\n  When d\n");
  assertEquals(p.preconditions, []);
  assertEquals(p.steps.length, 2);
  assertEquals(texts(p.steps[0].actions), ["a"]);
  assertEquals(texts(p.steps[0].expected), ["b", "c"]);
  assertEquals(texts(p.steps[1].actions), ["d"]);
  assertEquals(p.steps[1].expected, []);
});

Deno.test("scenarioProcedure: feature and rule backgrounds come first with origin background", () => {
  const p = procedure(
    "Feature: F\n" +
      "  Background:\n    Given feature setup\n" +
      "  Rule: R\n" +
      "    Background:\n      Given rule setup\n" +
      "    Scenario: S\n      Given own setup\n      When act\n      Then check\n",
  );
  assertEquals(texts(p.preconditions), [
    "feature setup",
    "rule setup",
    "own setup",
  ]);
  assertEquals(p.preconditions.map((r) => r.origin), [
    "background",
    "background",
    "scenario",
  ]);
  assertEquals(p.steps.length, 1);
});

Deno.test("scenarioProcedure: a Background When is still a precondition", () => {
  const p = procedure(
    "Feature: F\n  Background:\n    When the system starts\n" +
      "  Scenario: S\n    When act\n    Then check\n",
  );
  assertEquals(texts(p.preconditions), ["the system starts"]);
  assertEquals(p.preconditions[0].role, "precondition");
  assertEquals(p.preconditions[0].origin, "background");
  assertEquals(texts(p.steps[0].actions), ["act"]);
});

Deno.test("scenarioProcedure: an outline is one procedure with placeholders kept", () => {
  const p = procedure(
    "Scenario Outline: O\n  Given <a>\n  When move to <d> m\n  Then range is <d> m\n" +
      "  Examples:\n    | a | d |\n    | x | 1 |\n    | y | 2 |\n",
  );
  assertEquals(texts(p.preconditions), ["<a>"]);
  assertEquals(p.steps.length, 1);
  assertEquals(texts(p.steps[0].actions), ["move to <d> m"]);
  assertEquals(texts(p.steps[0].expected), ["range is <d> m"]);
});

Deno.test("scenarioProcedure: a synthetic block gives the same procedure", () => {
  const body = "  Given a\n  When b\n  Then c\n";
  const bare = parseFeature(api, "Scenario: S\n" + body);
  const full = parseFeature(api, "Feature: F\n\n  Scenario: S\n" + body);
  assert(bare.ok && full.ok);
  assert(bare.feature.synthetic && !full.feature.synthetic);
  // Ranges differ with the line layout; compare the shape of the view.
  const shape = (p: ScenarioProcedure) => ({
    pre: p.preconditions.map((r) => [r.role, r.origin, r.step.text]),
    steps: p.steps.map((s) => [
      s.n,
      texts(s.setup),
      texts(s.actions),
      texts(s.expected),
    ]),
  });
  assertEquals(
    shape(scenarioProcedure(bare.feature.scenarios[0])),
    shape(scenarioProcedure(full.feature.scenarios[0])),
  );
});

Deno.test("scenarioProcedure: each scenario gets only its own Rule background", () => {
  const result = parseFeature(
    api,
    "Feature: F\n" +
      "  Background:\n    Given feature setup\n" +
      "  Rule: A\n" +
      "    Background:\n      Given rule A setup\n" +
      "    Scenario: SA\n      When act a\n      Then check a\n" +
      "  Rule: B\n" +
      "    Background:\n      Given rule B setup\n" +
      "    Scenario: SB\n      When act b\n      Then check b\n",
  );
  assert(result.ok, result.ok ? "" : result.message);
  const [sa, sb] = result.feature.scenarios.map(scenarioProcedure);
  assertEquals(texts(sa.preconditions), ["feature setup", "rule A setup"]);
  assertEquals(texts(sb.preconditions), ["feature setup", "rule B setup"]);
});

const PURITY_SOURCE = "Feature: F\n  Background:\n    Given setup\n" +
  "  Scenario: S\n    Given a\n    When b\n    Then c\n    When d\n";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

Deno.test("scenarioProcedure: does not mutate a deeply frozen scenario", () => {
  const result = parseFeature(api, PURITY_SOURCE);
  assert(result.ok, result.ok ? "" : result.message);
  const scenario = deepFreeze(result.feature.scenarios[0]);
  const before = structuredClone(scenario);
  scenarioProcedure(scenario);
  assertEquals(scenario, before);
});

Deno.test("scenarioProcedure: two calls on one scenario are deep-equal", () => {
  const result = parseFeature(api, PURITY_SOURCE);
  assert(result.ok, result.ok ? "" : result.message);
  const scenario = result.feature.scenarios[0];
  assertEquals(scenarioProcedure(scenario), scenarioProcedure(scenario));
});

Deno.test("scenarioProcedure: the same source parsed twice gives equal views", () => {
  assertEquals(procedure(PURITY_SOURCE), procedure(PURITY_SOURCE));
});
