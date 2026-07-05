import { assertEquals } from "@std/assert";
import type {
  BodyBlock,
  ListItemNode,
  ListNode,
  ParagraphNode,
} from "../ast/nodes.ts";
import type { BodyToken } from "../model/mod.ts";
import {
  extractUxBullets,
  extractUxRootSpans,
  stripUxilLeadingSpan,
} from "./surfaces.ts";

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

function inlineCode(text: string, line = 1, column = 1): BodyToken {
  return {
    kind: "inline-code",
    text,
    location: { file: "a.md", line, column },
  };
}

Deno.test("extractUxRootSpans: only root-form inline spans", () => {
  const tokens: BodyToken[] = [
    inlineCode("`ux:media.home : screen`", 5, 10),
    inlineCode("`ux:media.home/play`", 6, 3), // citation, not a root decl
    inlineCode("`/play : activate`", 7, 3), // element decl, not a root
  ];
  const out = extractUxRootSpans(tokens);
  assertEquals(out.length, 1);
  assertEquals(out[0].source, "ux:media.home : screen");
});

Deno.test("extractUxBullets: element + child bullets with parent links", () => {
  const play = para("`/play : activate` — starts playback.", 3);
  const dialog = para("`.confirm_dialog @ default` — delete dialog.", 4);
  const confirm = para("`/confirm : activate` — confirms.", 5);
  const blocks: BodyBlock[] = [
    list([
      item([play]),
      item([dialog, list([item([confirm])])]),
    ]),
  ];
  const result = extractUxBullets(blocks);
  assertEquals(result.length, 3);
  // .source is the raw paragraph text (backticks + trailing prose intact) —
  // classification uses the stripped span internally but the returned
  // declaration keeps the verbatim paragraph, matching parseElementBullet's
  // own (self-splitting) input contract.
  assertEquals(result.map((r) => r.source), [
    "`/play : activate` — starts playback.",
    "`.confirm_dialog @ default` — delete dialog.",
    "`/confirm : activate` — confirms.",
  ]);
  assertEquals(result[0].parent, undefined);
  assertEquals(result[1].parent, undefined);
  assertEquals(result[2].parent, 1); // nested under the child-surface bullet
});

Deno.test("extractUxBullets: ignores non-uxil bullets", () => {
  const blocks: BodyBlock[] = [
    list([
      item([para("just a regular bullet", 3)]),
    ]),
  ];
  assertEquals(extractUxBullets(blocks), []);
});

Deno.test("extractUxBullets: ignores a bullet with a non-uxil leading code span", () => {
  const blocks: BodyBlock[] = [
    list([
      item([para("`$Speed : signal float[0..300]` — a typl binding.", 3)]),
    ]),
  ];
  assertEquals(extractUxBullets(blocks), []);
});

Deno.test("stripUxilLeadingSpan: extracts single- and double-backtick spans", () => {
  assertEquals(
    stripUxilLeadingSpan("`/play : activate` — starts."),
    "/play : activate",
  );
  assertEquals(stripUxilLeadingSpan("``/play`` trailing"), "/play");
  assertEquals(stripUxilLeadingSpan("no leading span here"), undefined);
  assertEquals(stripUxilLeadingSpan("`unterminated"), undefined);
});
