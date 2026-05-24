/**
 * @module parser/translate_test
 *
 * Unit tests for translateEntryLocations.
 *
 * Uses a fake LineMap that adds a fixed offset (dLine, dCol) so
 * round-trips are mechanically verifiable. No real parsing involved.
 */

import { assertEquals, assertNotStrictEquals } from "@std/assert";
import type { Entry, SourceLocation } from "../model/mod.ts";
import type { LineMap } from "./line_map.ts";
import { translateEntryLocations } from "./translate.ts";

function fakeLineMap(dLine: number, dCol: number): LineMap {
  return {
    translate(line, column) {
      return { line: line + dLine, column: column + dCol };
    },
  };
}

function loc(line: number, column: number, file = "t.md"): SourceLocation {
  return { file, line, column };
}

function minimalEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    displayId: "STK_0001" as Entry["displayId"],
    title: "Title",
    body: "Body",
    bodyAst: [],
    rawAttributes: [],
    typedAttributes: new Map(),
    id: undefined,
    type: undefined,
    shape: "Authored",
    location: loc(5, 1),
    source: { kind: "markdown" },
    properties: { file: { path: "t.md", line: 5, column: 1 } },
    bodyTokens: [],
    ...overrides,
  };
}

Deno.test("translateEntryLocations: translates entry.location", () => {
  const entries = [minimalEntry({ location: loc(5, 1) })];
  const out = translateEntryLocations(entries, fakeLineMap(10, 0));
  assertEquals(out[0].location.line, 15);
  assertEquals(out[0].location.column, 1);
  assertEquals(out[0].location.file, "t.md");
});

Deno.test("translateEntryLocations: translates bodyTokens locations", () => {
  const entries = [minimalEntry({
    bodyTokens: [
      {
        kind: "modal",
        text: "shall",
        case: "lower",
        location: loc(7, 3),
      },
    ],
  })];
  const out = translateEntryLocations(entries, fakeLineMap(10, 5));
  assertEquals(out[0].bodyTokens.length, 1);
  assertEquals(out[0].bodyTokens[0].location.line, 17);
  assertEquals(out[0].bodyTokens[0].location.column, 8);
});

Deno.test("translateEntryLocations: translates bodyAst paragraph range", () => {
  // SourceRange.start / .end are { line, column } — no `file` field.
  const entries = [minimalEntry({
    bodyAst: [
      {
        kind: "paragraph",
        content: { text: "Body" },
        range: { start: { line: 6, column: 1 }, end: { line: 6, column: 5 } },
      },
    ] as Entry["bodyAst"],
  })];
  const out = translateEntryLocations(entries, fakeLineMap(10, 0));
  const block = out[0].bodyAst![0];
  assertEquals(block.range.start.line, 16);
  assertEquals(block.range.end.line, 16);
});

Deno.test("translateEntryLocations: list-block items recurse", () => {
  const entries = [minimalEntry({
    bodyAst: [
      {
        kind: "list",
        ordered: false,
        spread: false,
        items: [
          {
            range: {
              start: { line: 6, column: 1 },
              end: { line: 6, column: 9 },
            },
            blocks: [
              {
                kind: "paragraph",
                content: { text: "nested" },
                range: {
                  start: { line: 6, column: 3 },
                  end: { line: 6, column: 9 },
                },
              },
            ],
          },
        ],
        range: { start: { line: 6, column: 1 }, end: { line: 6, column: 9 } },
      },
    ] as Entry["bodyAst"],
  })];
  const out = translateEntryLocations(entries, fakeLineMap(10, 0));
  const listBlock = out[0].bodyAst![0];
  assertEquals(listBlock.range.start.line, 16);
  // Narrow the union before reaching into items.
  if (listBlock.kind !== "list") throw new Error("expected list");
  const nested = listBlock.items[0].blocks[0];
  assertEquals(nested.range.start.line, 16);
});

Deno.test("translateEntryLocations: undefined translate falls back to entry.location", () => {
  const sometimesUndefined: LineMap = {
    translate(line, column) {
      if (line === 99) return undefined;
      return { line: line + 1, column };
    },
  };
  const entries = [minimalEntry({
    location: loc(5, 1),
    bodyTokens: [
      { kind: "modal", text: "x", case: "lower", location: loc(99, 7) },
    ],
  })];
  const out = translateEntryLocations(entries, sometimesUndefined);
  // entry.location was 5 → translates to 6 (offset +1)
  assertEquals(out[0].location.line, 6);
  // token was at 99 → translate returned undefined → falls back to translated
  // entry.location.line with column reset to 1.
  assertEquals(out[0].bodyTokens[0].location.line, 6);
  assertEquals(out[0].bodyTokens[0].location.column, 1);
});

Deno.test("translateEntryLocations: returns a fresh array — originals not mutated", () => {
  const original = minimalEntry({ location: loc(5, 1) });
  const out = translateEntryLocations([original], fakeLineMap(10, 0));
  assertEquals(original.location.line, 5); // unchanged
  assertEquals(out[0].location.line, 15); // translated
  assertNotStrictEquals(out[0], original);
});
