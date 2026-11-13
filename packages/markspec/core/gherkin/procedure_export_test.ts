import { assertEquals } from "@std/assert";
import {
  type ScenarioProcedure,
  scenarioProcedure,
  type StepRole,
  stepRoles,
} from "../mod.ts";

Deno.test("core/mod.ts exports the Gherkin procedure view", () => {
  const role: StepRole = "action";
  const empty: ScenarioProcedure = {
    preconditions: [],
    steps: [],
    unplacedLabels: [],
  };
  assertEquals(typeof scenarioProcedure, "function");
  assertEquals(stepRoles([]), []);
  assertEquals([role, empty.steps], ["action", []]);
});
