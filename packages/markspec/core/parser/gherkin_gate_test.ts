/**
 * @module parser/gherkin_gate_test
 *
 * Tests for the Gherkin parse gate in {@linkcode parseFile}. The parser
 * cache is process-wide, so every check that needs an unloaded parser runs
 * in a new `deno eval` process; the other tests do not depend on the order
 * in which they run.
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import type { FeatureNode } from "../ast/nodes.ts";
import { loadedGherkin, loadGherkin } from "../gherkin/load.ts";
import { GHERKIN_FENCE_RE, parseFile } from "./mod.ts";

const featureOf = (
  entry: { readonly bodyAst?: readonly unknown[] },
): FeatureNode => {
  const node = entry.bodyAst?.find((b) =>
    (b as FeatureNode).kind === "feature"
  );
  assert(node, "entry has a feature node");
  return node as FeatureNode;
};

const entryWith = (fenceBody: string, lang = "gherkin"): string =>
  `# Doc

- [REQ-001] Brake

  The system shall brake.

  \`\`\`${lang}
${fenceBody}
  \`\`\`

      Id:
`;

Deno.test("parseFile: fills FeatureNode.feature for a gherkin fence", async () => {
  const md = entryWith(
    "  Feature: Braking\n    Scenario: Stop\n      Given a car\n      Then it stops",
  );
  const { entries } = await parseFile(md, { file: "a.md" });
  const node = featureOf(entries[0]);
  assertEquals(node.parseError, undefined);
  assertEquals(node.feature?.scenarios.length, 1);
});

Deno.test("parseFile: also gates on a feature fence", async () => {
  const md = entryWith("  Scenario: Stop\n    Given a car", "feature");
  const { entries } = await parseFile(md, { file: "a.md" });
  assertEquals(featureOf(entries[0]).feature?.scenarios.length, 1);
});

Deno.test("parseFile: sets parseError for a broken block", async () => {
  const md = entryWith("  Scenario: Stop\n    Given a car\n  Bogus line");
  const { entries } = await parseFile(md, { file: "a.md" });
  const node = featureOf(entries[0]);
  assertEquals(node.feature, undefined);
  assertEquals(node.parseError?.line, 3);
});

Deno.test("parseFile: synthetic Feature line does not shift lines after tags", async () => {
  const md = entryWith("  @smoke\n  # note\n  Scenario: Stop\n    Given a car");
  const { entries } = await parseFile(md, { file: "a.md" });
  const scenario = featureOf(entries[0]).feature?.scenarios[0];
  assertEquals(scenario?.range.start.line, 3);
});

Deno.test("parseFile: a Rust doc comment fence fills the feature", async () => {
  const rs = `/// [SRS_001] Brake
///
/// The unit shall brake.
///
/// \`\`\`gherkin
/// Scenario: Stop
///   Given a car
/// \`\`\`
///
///     Id:
fn brake() {}
`;
  const { entries } = await parseFile(rs, { file: "a.rs" });
  assertEquals(featureOf(entries[0]).feature?.scenarios.length, 1);
});

Deno.test("parseFile: loader state stays set after a load", async () => {
  const api = await loadGherkin();
  assertEquals(loadedGherkin(), api);
});

Deno.test("GHERKIN_FENCE_RE: matches the fence shapes that gate the load", () => {
  const matching = [
    "```gherkin",
    "~~~gherkin",
    "````gherkin",
    "~~~~feature",
    "```gherkin title",
    "```gherkin\tx",
    "> ```gherkin",
    "  > ~~~feature",
    "/// ```gherkin",
    "//! ```gherkin",
    " * ```feature",
    "# ```feature",
    "- ```gherkin",
    "  - ```gherkin",
    "* ```gherkin",
    "+ ~~~feature",
    "1. ```feature",
    "12) ```gherkin",
    "> - ```gherkin",
    "- > ```gherkin",
    "/// - ```gherkin",
    "- [REQ-001] t\n\n  ```gherkin\n  Scenario: a",
  ];
  for (const text of matching) assert(GHERKIN_FENCE_RE.test(text), text);
  const other = [
    "```ts",
    "``gherkin",
    "```gherkinish",
    "```gherkin-json",
    "```feature-custom",
    "```feature.x",
    "text gherkin",
    "text ```gherkin",
    "-```gherkin",
    "1.```gherkin",
    // The fence and the info word are on different lines.
    "```\ngherkin",
    "~~~\nfeature x",
    "-\n```ts\ngherkin",
    "\n\n   \n",
  ];
  for (const text of other) assertFalse(GHERKIN_FENCE_RE.test(text), text);
});

Deno.test("GHERKIN_FENCE_RE: scans long runs of blank lines in linear time", () => {
  const text = "\n".repeat(160_000) + " ".repeat(160_000);
  const start = performance.now();
  assertFalse(GHERKIN_FENCE_RE.test(text));
  assert(performance.now() - start < 2_000, "gate scan took too long");
});

/**
 * Run `body` in a new Deno process, where the Gherkin parser is not loaded
 * yet. `parseFile`, `loadedGherkin` and `buildCriteria` are in scope. The
 * process prints one JSON value, which is returned.
 */
async function inFreshProcess(body: string): Promise<unknown> {
  const mod = (path: string) => new URL(path, import.meta.url).href;
  const script = `
import { parseFile } from ${JSON.stringify(mod("./mod.ts"))};
import { loadedGherkin } from ${JSON.stringify(mod("../gherkin/load.ts"))};
import { buildCriteria } from ${
    JSON.stringify(mod("../criteria/scenarios.ts"))
  };
const feature = (e) => e.bodyAst?.find((b) => b.kind === "feature");
${body}
`;
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--ext=ts", script],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = new TextDecoder().decode(out.stderr);
  assertEquals(out.code, 0, stderr);
  return JSON.parse(new TextDecoder().decode(out.stdout));
}

/** An entry whose feature fence is opened by `fenceLine`. */
const listEntry = (fenceLine: string): string =>
  `- [REQ-001] Brake

  The system shall brake.

${fenceLine}
     Scenario: Stop
       Given a car
     \`\`\`

      Id:
`;

Deno.test("parseFile (fresh process): only a gherkin or feature fence loads the parser", async () => {
  const cases: Record<string, string> = {
    plain: "# Doc\n\n- [REQ-001] Brake\n\n  The system shall brake.\n\n" +
      "  ```ts\n  const x = 1;\n  ```\n\n      Id:\n",
    json: listEntry("  ```gherkin-json"),
    custom: listEntry("  ```feature-custom"),
    dash: listEntry("  - ```gherkin"),
    numbered: listEntry("  1. ```feature"),
    paren: listEntry("  1) ```gherkin"),
  };
  const expected: Record<string, boolean> = {
    plain: false,
    json: false,
    custom: false,
    dash: true,
    numbered: true,
    paren: true,
  };
  for (const [name, md] of Object.entries(cases)) {
    const loaded = await inFreshProcess(`
await parseFile(${JSON.stringify(md)}, { file: "a.md" });
console.log(JSON.stringify(loadedGherkin() !== undefined));
`);
    assertEquals(loaded, expected[name], name);
  }
});

Deno.test("parseFile (fresh process): a fence after a list marker gets the AST", async () => {
  const md = `- [REQ-001] Brake

  The system shall brake.

  - \`\`\`gherkin
    Scenario: Stop
      Given a car
    \`\`\`

      Id:
`;
  const result = await inFreshProcess(`
const { entries } = await parseFile(${JSON.stringify(md)}, { file: "a.md" });
const find = (blocks) => {
  for (const b of blocks ?? []) {
    if (b.kind === "feature") return b;
    for (const item of b.items ?? []) {
      const hit = find(item.blocks);
      if (hit) return hit;
    }
  }
};
const nested = find(entries[0].bodyAst);
console.log(JSON.stringify(nested?.feature?.scenarios.length ?? null));
`);
  assertEquals(result, 1);
});

Deno.test("parseFile (fresh process): a failed parser load does not abort parsing", async () => {
  const md = entryWith("  Scenario: Stop\n    Given a car");
  const result = await inFreshProcess(`
const md = ${JSON.stringify(md)};
let calls = 0;
const failing = () => { calls++; return Promise.reject(new Error("boom")); };
const first = await parseFile(md, { file: "a.md", gherkinLoader: failing });
const node = feature(first.entries[0]);
const afterFailure = {
  entries: first.entries.length,
  calls,
  hasFeature: node?.feature !== undefined,
  loaded: loadedGherkin() !== undefined,
  criteria: buildCriteria(first.entries[0]).map((c) => c.name),
};
// The failure is not cached: the default loader loads the parser.
const second = await parseFile(md, { file: "a.md" });
console.log(JSON.stringify({
  afterFailure,
  retried: feature(second.entries[0])?.feature !== undefined,
}));
`);
  assertEquals(result, {
    afterFailure: {
      entries: 1,
      calls: 1,
      hasFeature: false,
      loaded: false,
      criteria: ["Stop"],
    },
    retried: true,
  });
});
