import { assertEquals } from "@std/assert";
import type { BodyBlock, CodeNode, ListItemNode, ListNode } from "../ast/nodes.ts";
import { extractTyplFences } from "./fence.ts";

function code(lang: string | undefined, text: string, line = 1): CodeNode {
  return {
    kind: "code",
    lang,
    text,
    range: {
      start: { line, column: 1 },
      end: { line: line + text.split("\n").length + 1, column: 4 },
    },
  };
}

Deno.test("extractTyplFences: empty input → empty result", () => {
  assertEquals(extractTyplFences([]), []);
});

Deno.test("extractTyplFences: ignores non-typl fences", () => {
  const blocks: BodyBlock[] = [
    code("ts", "const x = 1;"),
    code("json", "{}"),
    code(undefined, "bare fence"),
  ];
  assertEquals(extractTyplFences(blocks), []);
});

Deno.test("extractTyplFences: finds single typl fence at top level", () => {
  const fence = code("typl", "$Speed : signal float[0..300]", 5);
  const result = extractTyplFences([fence]);
  assertEquals(result.length, 1);
  assertEquals(result[0].source, "$Speed : signal float[0..300]");
  assertEquals(result[0].range, fence.range);
});

Deno.test("extractTyplFences: multiple fences returned in source order", () => {
  const f1 = code("typl", "$A : signal", 3);
  const f2 = code("ts", "ignored", 5);
  const f3 = code("typl", "$B : event", 7);
  const result = extractTyplFences([f1, f2, f3]);
  assertEquals(result.length, 2);
  assertEquals(result[0].source, "$A : signal");
  assertEquals(result[1].source, "$B : event");
});

Deno.test("extractTyplFences: recurses into list-item children", () => {
  // ListNode.items is readonly ListItemNode[]; each ListItemNode.blocks
  // carries nested BodyBlock[]. Build a list with two items, one of which
  // contains a typl fence.
  const nestedFence = code("typl", "$Pressure : signal float[0..10]", 12);
  const otherCode = code("ts", "// ignored", 10);

  const item1: ListItemNode = {
    blocks: [otherCode],
    range: { start: { line: 10, column: 1 }, end: { line: 11, column: 4 } },
  };
  const item2: ListItemNode = {
    blocks: [nestedFence],
    range: { start: { line: 12, column: 1 }, end: { line: 15, column: 4 } },
  };
  const list: ListNode = {
    kind: "list",
    ordered: false,
    spread: false,
    items: [item1, item2],
    range: { start: { line: 10, column: 1 }, end: { line: 15, column: 4 } },
  };

  const blocks: BodyBlock[] = [list];
  const result = extractTyplFences(blocks);
  assertEquals(result.length, 1);
  assertEquals(result[0].source, "$Pressure : signal float[0..10]");
  assertEquals(result[0].range, nestedFence.range);
});

Deno.test("extractTyplFences: case-sensitive — 'TYPL' is NOT recognised", () => {
  const blocks: BodyBlock[] = [code("TYPL", "$X : signal")];
  assertEquals(extractTyplFences(blocks), []);
});
