/**
 * @module lsp/entry_trailer_test
 *
 * Unit tests for {@linkcode scanEntryTrailer} — walks an entry's
 * trailer block in document text and reports per-attribute key,
 * value, and embedded display-ID ranges.
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../core/model/mod.ts";
import { makeDisplayId } from "../core/model/mod.ts";
import { scanEntryTrailer } from "./entry_trailer.ts";

function makeEntry(displayId: string, line: number): Entry {
  return {
    displayId: makeDisplayId(displayId),
    title: displayId,
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "t.md", line, column: 1 },
    source: "markdown",
    bodyTokens: [],
  };
}

Deno.test("scanEntryTrailer: identifies Id key/value ranges", () => {
  const text = [
    "- [REQ-001] Title",
    "",
    "  Body paragraph.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
  ].join("\n");
  const result = scanEntryTrailer(makeEntry("REQ-001", 1), text.split("\n"), 5);
  assertEquals(result.length, 1);
  assertEquals(result[0].lineIndex, 4);
  assertEquals(result[0].key, "Id");
  assertEquals(result[0].keyStart, 6);
  assertEquals(result[0].keyLength, 2);
  assertEquals(result[0].valueStart, 10);
  assertEquals(result[0].valueLength, 26);
  // The ULID matches the display-ID token grammar shared with
  // `hover.ts` / `rename.ts` (alphanumeric start, ID chars, ≥3).
  assertEquals(result[0].idRanges, [{ start: 10, length: 26 }]);
});

Deno.test("scanEntryTrailer: extracts display IDs inside Satisfies value", () => {
  const text = [
    "- [REQ-001] Title",
    "",
    "      Satisfies: STK-001, STK-002",
  ].join("\n");
  const result = scanEntryTrailer(makeEntry("REQ-001", 1), text.split("\n"), 3);
  assertEquals(result.length, 1);
  assertEquals(result[0].key, "Satisfies");
  assertEquals(result[0].idRanges.length, 2);
  // First ID "STK-001" starts at column index 17 (6 indent + 9 key + colon + space)
  assertEquals(result[0].idRanges[0].start, 17);
  assertEquals(result[0].idRanges[0].length, 7);
  assertEquals(result[0].idRanges[1].start, 26);
  assertEquals(result[0].idRanges[1].length, 7);
});

Deno.test("scanEntryTrailer: handles multiple spaces after colon", () => {
  const text = [
    "- [REQ-001] Title",
    "",
    "      Satisfies:   STK-001",
  ].join("\n");
  const result = scanEntryTrailer(makeEntry("REQ-001", 1), text.split("\n"), 3);
  assertEquals(result.length, 1);
  assertEquals(result[0].key, "Satisfies");
  assertEquals(result[0].idRanges.length, 1);
  // Line: "      Satisfies:   STK-001"
  //        0123456789012345678901234567
  // STK-001 starts at column 19 (6 indent + 9 key + ':' + 3 spaces = 19).
  assertEquals(result[0].idRanges[0].start, 19);
  assertEquals(result[0].idRanges[0].length, 7);
  assertEquals(result[0].valueStart, 19);
});

Deno.test("scanEntryTrailer: stops at next entry's title line", () => {
  const text = [
    "- [REQ-001] First",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "",
    "- [REQ-002] Second",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG",
  ].join("\n");
  const result = scanEntryTrailer(makeEntry("REQ-001", 1), text.split("\n"), 5);
  assertEquals(result.length, 1);
  assertEquals(result[0].lineIndex, 2);
});

Deno.test("scanEntryTrailer: matches digit-leading and dotted display IDs", () => {
  const text = [
    "- [REQ-001] Title",
    "",
    "      Satisfies: 001.alpha, lower-case",
  ].join("\n");
  const result = scanEntryTrailer(makeEntry("REQ-001", 1), text.split("\n"), 3);
  assertEquals(result.length, 1);
  assertEquals(result[0].key, "Satisfies");
  assertEquals(result[0].idRanges.length, 2);
  // Line: "      Satisfies: 001.alpha, lower-case"
  //        0123456789012345678901234567890123456789
  // "001.alpha" starts at column 17, length 9.
  assertEquals(result[0].idRanges[0].start, 17);
  assertEquals(result[0].idRanges[0].length, 9);
  // "lower-case" starts at column 28, length 10.
  assertEquals(result[0].idRanges[1].start, 28);
  assertEquals(result[0].idRanges[1].length, 10);
});

Deno.test("scanEntryTrailer: empty for entry with no trailer", () => {
  const text = ["- [REQ-001] Title", "", "  Body only."].join("\n");
  const result = scanEntryTrailer(makeEntry("REQ-001", 1), text.split("\n"), 3);
  assertEquals(result, []);
});

Deno.test("scanEntryTrailer: trims trailing whitespace from valueLength", () => {
  // Line ends with 3 trailing spaces.
  const text = [
    "- [REQ-001] Title",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF   ",
  ].join("\n");
  const result = scanEntryTrailer(makeEntry("REQ-001", 1), text.split("\n"), 3);
  assertEquals(result.length, 1);
  // Without the fix, valueLength would be 29 (26 ULID + 3 trailing spaces).
  assertEquals(result[0].valueLength, 26);
});
