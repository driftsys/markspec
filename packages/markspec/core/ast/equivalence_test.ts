import { assert, assertFalse } from "@std/assert";
import { astEquivalent } from "./equivalence.ts";
import type { BodyBlock } from "./nodes.ts";

const para = (text: string, line = 1): BodyBlock[] => [{
  kind: "paragraph",
  content: { text },
  range: { start: { line, column: 1 }, end: { line, column: 1 } },
}];

Deno.test("astEquivalent: identical structure, different range → equivalent", () => {
  assert(astEquivalent(para("x", 1), para("x", 9)));
});

Deno.test("astEquivalent: differing text → not equivalent", () => {
  assertFalse(astEquivalent(para("x"), para("y")));
});

Deno.test("astEquivalent: differing block count → not equivalent", () => {
  assertFalse(astEquivalent([...para("a")], [...para("a"), ...para("b", 3)]));
});

Deno.test("astEquivalent: Unknown raw differs → not equivalent", () => {
  const u = (raw: string): BodyBlock[] => [{
    kind: "unknown",
    raw,
    range: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
  }];
  assertFalse(astEquivalent(u("---"), u("***")));
  assert(astEquivalent(u("---"), u("---")));
});

Deno.test("astEquivalent: feature AST is a function of source, ranges ignored", async () => {
  const { loadGherkin } = await import("../gherkin/load.ts");
  const { buildBodyAst } = await import("./build.ts");
  await loadGherkin();
  const block = "```gherkin\nScenario: x\n  Given a\n```";
  const at1 = buildBodyAst(block);
  const at9 = buildBodyAst("\n\n\n\n\n\n\n\n" + block);
  assert(astEquivalent(at1, at9));
});

Deno.test("astEquivalent: feature node with and without the derived AST is equivalent", async () => {
  const { loadGherkin } = await import("../gherkin/load.ts");
  const { buildBodyAst } = await import("./build.ts");
  await loadGherkin();
  const withAst = buildBodyAst("```gherkin\nScenario: x\n  Given a\n```");
  const [node] = withAst as (BodyBlock & { feature?: unknown })[];
  assert(node.kind === "feature" && node.feature !== undefined);
  // The same node as the build gives it while the parser is not loaded.
  const { feature: _feature, ...without } = node;
  assert(astEquivalent([without as BodyBlock], withAst));
  const other = buildBodyAst("```gherkin\nScenario: y\n  Given a\n```");
  assertFalse(astEquivalent(withAst, other));
});

Deno.test("astEquivalent: feature node with and without parseError is equivalent", async () => {
  const { loadGherkin } = await import("../gherkin/load.ts");
  const { buildBodyAst } = await import("./build.ts");
  await loadGherkin();
  const broken = buildBodyAst(
    "```gherkin\nScenario: x\n  Given a\nBogus line\n```",
  );
  const [node] = broken as (BodyBlock & { parseError?: unknown })[];
  assert(node.kind === "feature" && node.parseError !== undefined);
  const { parseError: _parseError, ...without } = node;
  assert(astEquivalent([without as BodyBlock], broken));
});
