import { assertEquals } from "@std/assert";
import type {
  BodyBlock,
  ListItemNode,
  ListNode,
  ParagraphNode,
} from "../ast/nodes.ts";
import { extractTyplBullets } from "./bullet.ts";

function para(text: string, line = 1): ParagraphNode {
  return {
    kind: "paragraph",
    content: { text },
    range: {
      start: { line, column: 1 },
      end: { line, column: text.length + 1 },
    },
  };
}

function item(blocks: BodyBlock[], line = 1): ListItemNode {
  return {
    blocks,
    range: {
      start: { line, column: 1 },
      end: { line, column: 1 },
    },
  };
}

function list(items: ListItemNode[], ordered = false): ListNode {
  return {
    kind: "list",
    ordered,
    spread: false,
    items,
    range: {
      start: { line: 1, column: 1 },
      end: { line: items.length, column: 1 },
    },
  };
}

Deno.test("extractTyplBullets: empty input → empty result", () => {
  assertEquals(extractTyplBullets([]), []);
});

Deno.test("extractTyplBullets: ignores non-list blocks", () => {
  const blocks: BodyBlock[] = [
    para("This is a paragraph, not a list", 1),
  ];
  assertEquals(extractTyplBullets(blocks), []);
});

Deno.test("extractTyplBullets: ignores list with no typl-shaped items", () => {
  const blocks: BodyBlock[] = [
    list([
      item([para("regular bullet 1")]),
      item([para("regular bullet 2")]),
    ]),
  ];
  assertEquals(extractTyplBullets(blocks), []);
});

Deno.test("extractTyplBullets: finds typl binding bullet", () => {
  const p = para("$Speed : signal float[0..300]", 5);
  const blocks: BodyBlock[] = [list([item([p])])];
  const result = extractTyplBullets(blocks);
  assertEquals(result.length, 1);
  assertEquals(result[0].source, "$Speed : signal float[0..300]");
  assertEquals(result[0].range, p.range);
});

Deno.test("extractTyplBullets: finds typl typedef bullet", () => {
  const p = para("type Frame = { id: int[0..255] }", 5);
  const blocks: BodyBlock[] = [list([item([p])])];
  const result = extractTyplBullets(blocks);
  assertEquals(result.length, 1);
  assertEquals(result[0].source, "type Frame = { id: int[0..255] }");
});

Deno.test("extractTyplBullets: mixed list — only typl items extracted", () => {
  const p1 = para("regular intro bullet", 3);
  const p2 = para("$A : signal", 4);
  const p3 = para("another regular bullet", 5);
  const p4 = para("$B : event", 6);
  const p5 = para("type T = int", 7);
  const blocks: BodyBlock[] = [
    list([
      item([p1]),
      item([p2]),
      item([p3]),
      item([p4]),
      item([p5]),
    ]),
  ];
  const result = extractTyplBullets(blocks);
  assertEquals(result.length, 3);
  assertEquals(result.map((r) => r.source), [
    "$A : signal",
    "$B : event",
    "type T = int",
  ]);
});

Deno.test("extractTyplBullets: recurses into nested list-in-item", () => {
  // An item whose first block is a paragraph AND second block is a nested
  // list containing typl bullets — both the outer paragraph (if it matches)
  // and the nested matching items should be returned.
  const outer = para("$Outer : signal", 3);
  const inner = para("$Inner : event", 5);
  const blocks: BodyBlock[] = [
    list([
      item([outer, list([item([inner])])]),
    ]),
  ];
  const result = extractTyplBullets(blocks);
  assertEquals(result.length, 2);
  assertEquals(result.map((r) => r.source), [
    "$Outer : signal",
    "$Inner : event",
  ]);
});

Deno.test("extractTyplBullets: ignores `$` not followed by colon (not a binding)", () => {
  const p = para("$Foo is a great name", 3);
  const blocks: BodyBlock[] = [list([item([p])])];
  assertEquals(extractTyplBullets(blocks), []);
});

Deno.test("extractTyplBullets: ignores `type` not followed by `=` (not a typedef)", () => {
  const p = para("type of error", 3);
  const blocks: BodyBlock[] = [list([item([p])])];
  assertEquals(extractTyplBullets(blocks), []);
});
