/**
 * @module lsp/folding_test
 *
 * Unit tests for {@linkcode entriesToFoldingRanges} — one foldable
 * region per entry block, spanning from the entry's title line to
 * one line before the next entry (or the file's last line for the
 * final entry).
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../core/model/mod.ts";
import { entriesToFoldingRanges } from "./folding.ts";

function makeEntry(displayId: string, line: number): Entry {
  return {
    displayId,
    title: displayId,
    body: "",
    rawAttributes: [{ key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" }],
    typedAttributes: new Map(),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    location: { file: "t.md", line, column: 1 },
    source: "markdown",
  };
}

Deno.test("entriesToFoldingRanges: empty entries yields empty array", () => {
  assertEquals(entriesToFoldingRanges([], 10), []);
});

Deno.test("entriesToFoldingRanges: single entry folds to end of file", () => {
  const entries = [makeEntry("REQ-001", 3)];
  // Total document is 10 lines (1-based count); fold from entry start
  // to last line.
  const ranges = entriesToFoldingRanges(entries, 10);
  assertEquals(ranges.length, 1);
  // LSP uses 0-based line numbers.
  assertEquals(ranges[0].startLine, 2);
  assertEquals(ranges[0].endLine, 9);
});

Deno.test("entriesToFoldingRanges: two entries fold up to the next entry's previous line", () => {
  const entries = [
    makeEntry("REQ-001", 3),
    makeEntry("REQ-002", 9),
  ];
  const ranges = entriesToFoldingRanges(entries, 15);
  assertEquals(ranges.length, 2);
  // REQ-001: lines 3 to 8 (1-based) → 2 to 7 (0-based).
  assertEquals(ranges[0].startLine, 2);
  assertEquals(ranges[0].endLine, 7);
  // REQ-002: lines 9 to 15 → 8 to 14.
  assertEquals(ranges[1].startLine, 8);
  assertEquals(ranges[1].endLine, 14);
});

Deno.test("entriesToFoldingRanges: drops single-line entries (start == end)", () => {
  // If two entries are on adjacent lines, the first's range collapses
  // to a single line and shouldn't be returned — folding a 1-line
  // region is meaningless.
  const entries = [
    makeEntry("REQ-001", 3),
    makeEntry("REQ-002", 4),
  ];
  const ranges = entriesToFoldingRanges(entries, 20);
  assertEquals(ranges.length, 1);
  assertEquals(ranges[0].startLine, 3);
});

Deno.test("entriesToFoldingRanges: kind defaults to 'region'", () => {
  const entries = [makeEntry("REQ-001", 1)];
  const ranges = entriesToFoldingRanges(entries, 10);
  assertEquals(ranges[0].kind, "region");
});
