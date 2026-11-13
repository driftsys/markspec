import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { StepKeywordType } from "@cucumber/messages";
import { loadedGherkin, loadGherkin } from "./load.ts";

Deno.test("loadGherkin: parses French and reports keywordType", async () => {
  assertEquals(loadedGherkin(), undefined);
  const api = await loadGherkin();
  assertStrictEquals(loadedGherkin(), api);
  const doc = api.parse(
    "# language: fr\nFonctionnalité: x\n  Scénario: y\n    Soit a\n    * b\n",
  );
  assertEquals(doc.feature?.language, "fr");
  const scenario = doc.feature?.children[0].scenario;
  assert(scenario);
  assertEquals(scenario.steps.map((s) => s.keywordType), [
    StepKeywordType.CONTEXT,
    StepKeywordType.UNKNOWN,
  ]);
  assert("fr" in api.dialects);
});

Deno.test("loadGherkin: two calls return the same object", async () => {
  const first = await loadGherkin();
  const second = await loadGherkin();
  assertStrictEquals(first, second);
});
