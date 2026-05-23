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
