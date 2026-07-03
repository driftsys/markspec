/**
 * @module core/decl/surfaces_test
 *
 * Unit tests for the DSL-agnostic declaration-surface walkers. Fixtures use
 * a deliberately NON-typl vocabulary — `foo`-tagged fences, `@`-prefixed
 * bullet text, `#`-prefixed inline text — so the tests prove the machinery
 * carries no typl-specific knowledge and works for any recognizer.
 */

import { assertEquals } from "@std/assert";
import type {
  BodyBlock,
  CodeNode,
  ListItemNode,
  ListNode,
  ParagraphNode,
} from "../ast/nodes.ts";
import type { BodyToken } from "../model/mod.ts";
import {
  extractBulletDeclarations,
  extractFenceDeclarations,
  extractInlineDeclarations,
  stripCodeSpanDelimiters,
} from "./surfaces.ts";

// --- fixture builders (mirror the typl surface tests) ----------------------

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
    range: { start: { line, column: 1 }, end: { line, column: 1 } },
  };
}

function list(items: ListItemNode[]): ListNode {
  return {
    kind: "list",
    ordered: false,
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
    location: { file: "x.md", line, column },
  };
}

// --- fence surface ---------------------------------------------------------

const isFoo = (lang: string | undefined) => lang === "foo";

Deno.test("extractFenceDeclarations: empty input → empty result", () => {
  assertEquals(extractFenceDeclarations([], isFoo), []);
});

Deno.test("extractFenceDeclarations: ignores fences the recognizer rejects", () => {
  const blocks: BodyBlock[] = [
    code("rust", "fn x() {}"),
    code(undefined, "bare"),
  ];
  assertEquals(extractFenceDeclarations(blocks, isFoo), []);
});

Deno.test("extractFenceDeclarations: finds a matching fence with its range", () => {
  const fence = code("foo", "decl body");
  const result = extractFenceDeclarations([fence], isFoo);
  assertEquals(result.length, 1);
  assertEquals(result[0].source, "decl body");
  assertEquals(result[0].range, fence.range);
});

Deno.test("extractFenceDeclarations: multiple fences in source order", () => {
  const f1 = code("foo", "A", 1);
  const f2 = code("rust", "skip", 3);
  const f3 = code("foo", "B", 5);
  const result = extractFenceDeclarations([f1, f2, f3], isFoo);
  assertEquals(result.map((r) => r.source), ["A", "B"]);
});

Deno.test("extractFenceDeclarations: recurses into list-item children", () => {
  const nested = code("foo", "nested", 2);
  const blocks: BodyBlock[] = [list([item([nested], 2)])];
  const result = extractFenceDeclarations(blocks, isFoo);
  assertEquals(result.length, 1);
  assertEquals(result[0].source, "nested");
  assertEquals(result[0].range, nested.range);
});

// --- bullet surface --------------------------------------------------------

const isAt = (text: string) => text.startsWith("@");

Deno.test("extractBulletDeclarations: empty input → empty result", () => {
  assertEquals(extractBulletDeclarations([], isAt), []);
});

Deno.test("extractBulletDeclarations: ignores non-list blocks", () => {
  assertEquals(extractBulletDeclarations([para("@nope")], isAt), []);
});

Deno.test("extractBulletDeclarations: finds a matching bullet with its range", () => {
  const p = para("@decl one");
  const blocks: BodyBlock[] = [list([item([p])])];
  const result = extractBulletDeclarations(blocks, isAt);
  assertEquals(result.length, 1);
  assertEquals(result[0].source, "@decl one");
  assertEquals(result[0].range, p.range);
});

Deno.test("extractBulletDeclarations: mixed list — only matching items", () => {
  const blocks: BodyBlock[] = [
    list([
      item([para("@a")]),
      item([para("prose bullet")]),
      item([para("@b")]),
    ]),
  ];
  const result = extractBulletDeclarations(blocks, isAt);
  assertEquals(result.map((r) => r.source), ["@a", "@b"]);
});

Deno.test("extractBulletDeclarations: recurses into nested list-in-item", () => {
  const inner = list([item([para("@inner")])]);
  const blocks: BodyBlock[] = [list([item([para("@outer"), inner])])];
  const result = extractBulletDeclarations(blocks, isAt);
  assertEquals(result.map((r) => r.source), ["@outer", "@inner"]);
});

// --- inline surface --------------------------------------------------------

const isHash = (text: string) => text.startsWith("#");

Deno.test("extractInlineDeclarations: empty input → empty result", () => {
  assertEquals(extractInlineDeclarations([], isHash), []);
});

Deno.test("extractInlineDeclarations: ignores non-inline-code tokens", () => {
  const tokens: BodyToken[] = [
    {
      kind: "modal",
      text: "#nope",
      case: "lower",
      location: { file: "x.md", line: 1, column: 1 },
    },
  ];
  assertEquals(extractInlineDeclarations(tokens, isHash), []);
});

Deno.test("extractInlineDeclarations: ignores inline-code the recognizer rejects", () => {
  assertEquals(extractInlineDeclarations([inlineCode("`foo()`")], isHash), []);
});

Deno.test("extractInlineDeclarations: finds a matching span, strips backticks, keeps location", () => {
  const span = inlineCode("`#decl one`", 4, 7);
  const result = extractInlineDeclarations([span], isHash);
  assertEquals(result.length, 1);
  assertEquals(result[0].source, "#decl one");
  assertEquals(result[0].location, span.location);
});

Deno.test("extractInlineDeclarations: multiple spans in source order", () => {
  const tokens = [
    inlineCode("`#a`", 1),
    inlineCode("`foo`", 2),
    inlineCode("`#b`", 3),
  ];
  assertEquals(
    extractInlineDeclarations(tokens, isHash).map((r) => r.source),
    ["#a", "#b"],
  );
});

// --- backtick stripping ----------------------------------------------------

Deno.test("stripCodeSpanDelimiters: single, double, and non-fenced", () => {
  assertEquals(stripCodeSpanDelimiters("`x`"), "x");
  assertEquals(stripCodeSpanDelimiters("``x``"), "x");
  assertEquals(stripCodeSpanDelimiters("no ticks"), "no ticks");
  assertEquals(stripCodeSpanDelimiters("`"), "`"); // too short to strip
  assertEquals(stripCodeSpanDelimiters("``"), "``"); // too short to strip
});
