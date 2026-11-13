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

Deno.test("loadGherkin (fresh process): a failed import is not cached", async () => {
  const load = new URL("./load.ts", import.meta.url).href;
  const script = `import { loadGherkin } from ${JSON.stringify(load)};
let failed = false;
try {
  await loadGherkin(() => Promise.reject(new Error("boom")));
} catch {
  failed = true;
}
const api = await loadGherkin();
console.log(JSON.stringify({ failed, retried: typeof api.parse }));`;
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--ext=ts", script],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(out.code, 0, new TextDecoder().decode(out.stderr));
  assertEquals(JSON.parse(new TextDecoder().decode(out.stdout)), {
    failed: true,
    retried: "function",
  });
});
