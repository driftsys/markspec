/**
 * @module parser/line_map_test
 *
 * Unit tests for the LineMap interface + buildBlockLineMap factory.
 *
 * Tests use only synthetic DocCommentBlockMeta inputs — no tree-sitter,
 * no real comment strippers — to isolate the column-math.
 */

import { assertEquals } from "@std/assert";
import { buildBlockLineMap, type DocCommentBlockMeta } from "./line_map.ts";

Deno.test("buildBlockLineMap: line 1 with c >= 3 uses prefixWidths[0]", () => {
  // Source line at file row 10, col 5: "/// foo"
  // Cleaned line[0] = "foo", prefixWidths[0] = 4 (strips "/// ")
  // Wrapped buffer line 1 = "- foo" (cols 1-2 are "- ", col 3 = 'f')
  const meta: DocCommentBlockMeta = {
    startLine: 10,
    startColumn: 5,
    prefixWidths: [4],
  };
  const lm = buildBlockLineMap(meta);
  // buffer (1, 3) ('f' in "- foo") → source col 5 ('f' in "/// foo" at col 5)
  assertEquals(lm.translate(1, 3), { line: 10, column: 5 });
  // buffer (1, 5) ('o' last char in "- foo") → source col 7
  assertEquals(lm.translate(1, 5), { line: 10, column: 7 });
});

Deno.test("buildBlockLineMap: line 1 with c < 3 falls back to startColumn", () => {
  const meta: DocCommentBlockMeta = {
    startLine: 10,
    startColumn: 5,
    prefixWidths: [4],
  };
  const lm = buildBlockLineMap(meta);
  // buffer col 1 or 2 is the '- ' marker — safe fallback to startColumn
  assertEquals(lm.translate(1, 1), { line: 10, column: 5 });
  assertEquals(lm.translate(1, 2), { line: 10, column: 5 });
});

Deno.test("buildBlockLineMap: line N>=2 uses prefixWidths[N-1] with c>=3 offset", () => {
  // 3-line block at file row 20: each line "/// foo" (prefix 4 chars each)
  const meta: DocCommentBlockMeta = {
    startLine: 20,
    startColumn: 1,
    prefixWidths: [4, 4, 4],
  };
  const lm = buildBlockLineMap(meta);
  // buffer (2, 3) ('f' in "  foo" continuation) → source row 21 col 5
  assertEquals(lm.translate(2, 3), { line: 21, column: 5 });
  // buffer (3, 3) → row 22 col 5
  assertEquals(lm.translate(3, 3), { line: 22, column: 5 });
  // buffer (3, 5) → row 22 col 7
  assertEquals(lm.translate(3, 5), { line: 22, column: 7 });
});

Deno.test("buildBlockLineMap: line N>=2 with c<3 falls back to col 1", () => {
  const meta: DocCommentBlockMeta = {
    startLine: 20,
    startColumn: 1,
    prefixWidths: [4, 4, 4],
  };
  const lm = buildBlockLineMap(meta);
  assertEquals(lm.translate(2, 1), { line: 21, column: 1 });
  assertEquals(lm.translate(2, 2), { line: 21, column: 1 });
});

Deno.test("buildBlockLineMap: bufferLine > prefixWidths.length returns undefined", () => {
  const meta: DocCommentBlockMeta = {
    startLine: 10,
    startColumn: 1,
    prefixWidths: [4, 4],
  };
  const lm = buildBlockLineMap(meta);
  // 2 cleaned lines → buffer lines 1 and 2 valid; 3+ over-runs
  assertEquals(lm.translate(3, 3), undefined);
  assertEquals(lm.translate(100, 1), undefined);
});

Deno.test("buildBlockLineMap: bufferLine 0 returns undefined", () => {
  const meta: DocCommentBlockMeta = {
    startLine: 10,
    startColumn: 1,
    prefixWidths: [4],
  };
  const lm = buildBlockLineMap(meta);
  assertEquals(lm.translate(0, 3), undefined);
});

Deno.test("buildBlockLineMap: variable prefix widths (block continuation)", () => {
  // Simulates a /** Title\n * foo\n */ block:
  //   line 0 source: "/** Title"     prefixWidth 4
  //   line 1 source: " * foo"        prefixWidth 3
  const meta: DocCommentBlockMeta = {
    startLine: 5,
    startColumn: 1,
    prefixWidths: [4, 3],
  };
  const lm = buildBlockLineMap(meta);
  // buffer (1, 3) 'T' in "- Title" → source row 5 col 5
  assertEquals(lm.translate(1, 3), { line: 5, column: 5 });
  // buffer (2, 3) 'f' in "  foo" → source row 6 col 4
  assertEquals(lm.translate(2, 3), { line: 6, column: 4 });
});

Deno.test("buildBlockLineMap: empty prefixWidths returns undefined for everything", () => {
  const meta: DocCommentBlockMeta = {
    startLine: 1,
    startColumn: 1,
    prefixWidths: [],
  };
  const lm = buildBlockLineMap(meta);
  assertEquals(lm.translate(1, 1), undefined);
  assertEquals(lm.translate(1, 3), undefined);
});
