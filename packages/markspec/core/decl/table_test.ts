/**
 * @module core/decl/table_test
 *
 * Unit tests for the DSL-agnostic table declaration surface. The toy
 * recognizer treats a row as a declaration when its first cell starts with
 * `@` (mapping `[@name, type, …]` → `@name = type`), and skips every other
 * row — no typl or uxil vocabulary, proving the surface is DSL-agnostic.
 */

import { assertEquals } from "@std/assert";
import type {
  BodyBlock,
  CaptionNode,
  InlineContent,
  ListItemNode,
  ListNode,
  TableNode,
} from "../ast/nodes.ts";
import { extractTableDeclarations, type RowRecognizer } from "./table.ts";

// --- fixture builders ------------------------------------------------------

function cells(...texts: string[]): InlineContent[] {
  return texts.map((text) => ({ text }));
}

/** Build a TableNode whose `range` and `raw` are consistent: `raw` is
 * header line + delimiter line + one line per data row, and `range.start`
 * is `line` (the header line). */
function table(dataRows: string[][], line = 1): TableNode {
  const header = "| a | b | c |";
  const delimiter = "| - | - | - |";
  const rowLines = dataRows.map((r) => `| ${r.join(" | ")} |`);
  const raw = [header, delimiter, ...rowLines].join("\n");
  return {
    kind: "table",
    header: cells("a", "b", "c"),
    rows: dataRows.map((r) => cells(...r)),
    raw,
    range: {
      start: { line, column: 1 },
      end: { line: line + 1 + dataRows.length, column: 1 },
    },
  };
}

function caption(
  text: string,
  position: "above" | "below",
  keyword: CaptionNode["keyword"] = "Table",
): CaptionNode {
  return {
    kind: "caption",
    keyword,
    text,
    position,
    range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
  };
}

function item(blocks: BodyBlock[]): ListItemNode {
  return {
    blocks,
    range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
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

// The toy DSL: a row declares when its first cell starts with `@`.
const rowToSource: RowRecognizer = (cs) =>
  cs[0]?.startsWith("@") ? `${cs[0]} = ${cs[1]}` : undefined;

// --- tests -----------------------------------------------------------------

Deno.test("extractTableDeclarations: empty input → empty result", () => {
  assertEquals(extractTableDeclarations([], rowToSource), []);
});

Deno.test("extractTableDeclarations: recognized rows → declarations; non-matching rows are skipped", () => {
  const t = table([
    ["@speed", "signal", "vehicle speed"],
    ["plain", "row", "not a declaration"],
    ["@brake", "command", "brake request"],
  ]);
  const result = extractTableDeclarations([t], rowToSource);
  assertEquals(result.map((r) => r.source), [
    "@speed = signal",
    "@brake = command",
  ]);
});

Deno.test("extractTableDeclarations: per-row range is line-precise (past header + delimiter)", () => {
  // Table header on body line 5 → data rows on lines 7, 8, …
  const t = table([["@a", "x", "d"], ["@b", "y", "e"]], 5);
  const result = extractTableDeclarations([t], rowToSource);
  assertEquals(result[0].range.start.line, 7);
  assertEquals(result[1].range.start.line, 8);
  // End column spans the row's raw line ("| @a | x | d |" = 14 chars).
  assertEquals(result[0].range.end.line, 7);
  assertEquals(result[0].range.end.column, "| @a | x | d |".length + 1);
});

Deno.test("extractTableDeclarations: a Table caption ABOVE a table attaches to every row", () => {
  const blocks: BodyBlock[] = [
    caption("ux:media.home — home surface", "above"),
    table([["@play", "activate", "start"]]),
  ];
  const result = extractTableDeclarations(blocks, rowToSource);
  assertEquals(result.length, 1);
  assertEquals(result[0].captionText, "ux:media.home — home surface");
});

Deno.test("extractTableDeclarations: a Table caption BELOW a table attaches to every row", () => {
  const blocks: BodyBlock[] = [
    table([["@play", "activate", "start"], ["@stop", "activate", "halt"]]),
    caption("ux:media.home", "below"),
  ];
  const result = extractTableDeclarations(blocks, rowToSource);
  assertEquals(result.map((r) => r.captionText), [
    "ux:media.home",
    "ux:media.home",
  ]);
});

Deno.test("extractTableDeclarations: a non-Table caption (Figure) is not a base", () => {
  const blocks: BodyBlock[] = [
    caption("a diagram", "above", "Figure"),
    table([["@play", "activate", "start"]]),
  ];
  const result = extractTableDeclarations(blocks, rowToSource);
  assertEquals(result[0].captionText, undefined);
});

Deno.test("extractTableDeclarations: no adjacent caption → captionText absent", () => {
  const result = extractTableDeclarations(
    [table([["@play", "activate", "start"]])],
    rowToSource,
  );
  assertEquals(result[0].captionText, undefined);
  assertEquals(Object.hasOwn(result[0], "captionText"), false);
});

Deno.test("extractTableDeclarations: recurses into tables nested in list items", () => {
  const blocks: BodyBlock[] = [
    list([item([table([["@nested", "signal", "d"]])])]),
  ];
  const result = extractTableDeclarations(blocks, rowToSource);
  assertEquals(result.map((r) => r.source), ["@nested = signal"]);
});
