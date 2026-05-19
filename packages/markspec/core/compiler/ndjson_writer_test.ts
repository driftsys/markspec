/**
 * @module compiler/ndjson_writer_test
 *
 * Unit tests for the NDJSON stream builder functions.
 */

import { assertEquals, assertGreater } from "@std/assert";
import type { Entry, Link } from "../model/mod.ts";
import {
  buildEdgesNdjson,
  buildEntriesNdjson,
  indexToJson,
} from "./ndjson_writer.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(displayId: string, body = "Body."): Entry {
  return {
    displayId,
    title: `Title ${displayId}`,
    body,
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "test.md", line: 1, column: 1 },
    source: "markdown",
  };
}

function makeAuthoredLink(from: string, to: string): Link {
  return {
    from,
    to,
    kind: "satisfies",
    location: { file: "test.md", line: 1, column: 1 },
  };
}

function makeGeneratedLink(from: string, to: string): Link {
  return {
    from,
    to,
    kind: "satisfies",
    location: { file: "test.md", line: 1, column: 1 },
    origin: "generated",
  };
}

// ---------------------------------------------------------------------------
// buildEntriesNdjson
// ---------------------------------------------------------------------------

Deno.test("buildEntriesNdjson: 3 entries produce 3 newline-terminated lines", () => {
  const entries = new Map([
    ["C_0001", makeEntry("C_0001")],
    ["A_0001", makeEntry("A_0001")],
    ["B_0001", makeEntry("B_0001")],
  ]);
  const { ndjson } = buildEntriesNdjson(entries);
  const text = new TextDecoder().decode(ndjson);
  const lines = text.split("\n").filter((l) => l.length > 0);
  assertEquals(lines.length, 3);
  // Every line must end with \n (i.e. the file ends with \n)
  assertEquals(text.at(-1), "\n");
});

Deno.test("buildEntriesNdjson: each line is valid JSON with correct displayId", () => {
  const entries = new Map([
    ["STK_0001", makeEntry("STK_0001")],
    ["STK_0002", makeEntry("STK_0002")],
  ]);
  const { ndjson } = buildEntriesNdjson(entries);
  const text = new TextDecoder().decode(ndjson);
  const lines = text.split("\n").filter((l) => l.length > 0);
  const parsed = lines.map((l) => JSON.parse(l));
  const ids = parsed.map((e) => e.displayId).sort();
  assertEquals(ids, ["STK_0001", "STK_0002"]);
});

Deno.test("buildEntriesNdjson: lines are sorted by displayId", () => {
  const entries = new Map([
    ["C_0003", makeEntry("C_0003")],
    ["A_0001", makeEntry("A_0001")],
    ["B_0002", makeEntry("B_0002")],
  ]);
  const { ndjson } = buildEntriesNdjson(entries);
  const text = new TextDecoder().decode(ndjson);
  const lines = text.split("\n").filter((l) => l.length > 0);
  const ids = lines.map((l) => JSON.parse(l).displayId);
  assertEquals(ids, ["A_0001", "B_0002", "C_0003"]);
});

Deno.test("buildEntriesNdjson: index has correct byte offsets and lengths", () => {
  const entries = new Map([
    ["B_0001", makeEntry("B_0001")],
    ["A_0001", makeEntry("A_0001")],
  ]);
  const { ndjson, index } = buildEntriesNdjson(entries);

  assertEquals(index.size, 2);
  assertGreater(index.get("A_0001")!.length, 0);
  assertGreater(index.get("B_0001")!.length, 0);

  // A_0001 comes first (sorted), so its offset is 0
  assertEquals(index.get("A_0001")!.offset, 0);
  // B_0001 offset is A's length
  assertEquals(index.get("B_0001")!.offset, index.get("A_0001")!.length);

  // Verify seek-and-compare: read the bytes at the declared position and
  // confirm they match the original line.
  for (const [displayId, { offset, length }] of index) {
    const slice = ndjson.slice(offset, offset + length);
    const line = new TextDecoder().decode(slice);
    const parsed = JSON.parse(line);
    assertEquals(parsed.displayId, displayId);
  }
});

Deno.test("buildEntriesNdjson: byte lengths use UTF-8 encoding, not JS string .length", () => {
  // "😀" is 4 bytes in UTF-8 but 2 code units in JS (surrogate pair).
  const entries = new Map([
    ["X_0001", makeEntry("X_0001", "Body with emoji 😀")],
  ]);
  const { ndjson, index } = buildEntriesNdjson(entries);
  const { offset, length } = index.get("X_0001")!;
  const slice = ndjson.slice(offset, offset + length);
  const decoded = new TextDecoder().decode(slice);
  const parsed = JSON.parse(decoded);
  assertEquals(parsed.displayId, "X_0001");
  // The byte length should be greater than the character count
  assertGreater(length, new TextDecoder().decode(ndjson).split("\n")[0].length);
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

Deno.test("buildEntriesNdjson: output is byte-identical regardless of Map insertion order", () => {
  const a = new Map([
    ["C_0001", makeEntry("C_0001")],
    ["A_0001", makeEntry("A_0001")],
    ["B_0001", makeEntry("B_0001")],
  ]);
  const b = new Map([
    ["A_0001", makeEntry("A_0001")],
    ["B_0001", makeEntry("B_0001")],
    ["C_0001", makeEntry("C_0001")],
  ]);
  const { ndjson: na } = buildEntriesNdjson(a);
  const { ndjson: nb } = buildEntriesNdjson(b);
  assertEquals(na, nb);
});

// ---------------------------------------------------------------------------
// indexToJson
// ---------------------------------------------------------------------------

Deno.test("indexToJson: produces compact single-line JSON", () => {
  const index = new Map([
    ["B_0001", { offset: 100, length: 50 }],
    ["A_0001", { offset: 0, length: 100 }],
  ]);
  const json = indexToJson(index);
  // Must be parseable
  const parsed = JSON.parse(json);
  assertEquals(parsed["A_0001"], { offset: 0, length: 100 });
  assertEquals(parsed["B_0001"], { offset: 100, length: 50 });
  // Must be compact (no newlines)
  assertEquals(json.includes("\n"), false);
});

Deno.test("indexToJson: keys are sorted lexicographically", () => {
  const index = new Map([
    ["Z_0001", { offset: 200, length: 30 }],
    ["A_0001", { offset: 0, length: 100 }],
    ["M_0001", { offset: 100, length: 100 }],
  ]);
  const json = indexToJson(index);
  const keys = Object.keys(JSON.parse(json));
  assertEquals(keys, ["A_0001", "M_0001", "Z_0001"]);
});

// ---------------------------------------------------------------------------
// buildEdgesNdjson
// ---------------------------------------------------------------------------

Deno.test("buildEdgesNdjson: writes all links (authored and generated)", () => {
  const links: Link[] = [
    makeAuthoredLink("A_0001", "B_0001"),
    makeGeneratedLink("B_0001", "A_0001"),
    makeAuthoredLink("C_0001", "D_0001"),
  ];
  const ndjson = buildEdgesNdjson(links);
  const text = new TextDecoder().decode(ndjson);
  const lines = text.split("\n").filter((l) => l.length > 0);
  assertEquals(lines.length, 3);
});

Deno.test("buildEdgesNdjson: edge records have from, to, kind, origin", () => {
  const links: Link[] = [makeGeneratedLink("X_0001", "Y_0001")];
  const ndjson = buildEdgesNdjson(links);
  const text = new TextDecoder().decode(ndjson);
  const edge = JSON.parse(text.trim());
  assertEquals(Object.keys(edge).sort(), ["from", "kind", "origin", "to"]);
});

Deno.test("buildEdgesNdjson: authored link preserves origin undefined", () => {
  const links: Link[] = [
    makeAuthoredLink("A_0001", "B_0001"),
  ];
  const ndjson = buildEdgesNdjson(links);
  const text = new TextDecoder().decode(ndjson);
  const edge = JSON.parse(text.trim());
  assertEquals(edge.from, "A_0001");
  assertEquals(edge.to, "B_0001");
  // authored links have no origin field — JSON.stringify omits undefined
  assertEquals(edge.origin, undefined);
});

Deno.test("buildEdgesNdjson: generated link preserves origin field", () => {
  const links: Link[] = [makeGeneratedLink("B_0001", "A_0001")];
  const ndjson = buildEdgesNdjson(links);
  const text = new TextDecoder().decode(ndjson);
  const edge = JSON.parse(text.trim());
  assertEquals(edge.origin, "generated");
});

Deno.test("buildEdgesNdjson: empty result when no links", () => {
  const links: Link[] = [];
  const ndjson = buildEdgesNdjson(links);
  const text = new TextDecoder().decode(ndjson);
  assertEquals(text.trim(), "");
});

Deno.test("buildEdgesNdjson: multiple links each on own line", () => {
  const links: Link[] = [
    makeGeneratedLink("B_0001", "A_0001"),
    makeAuthoredLink("C_0001", "A_0001"),
  ];
  const ndjson = buildEdgesNdjson(links);
  const text = new TextDecoder().decode(ndjson);
  const lines = text.split("\n").filter((l) => l.length > 0);
  assertEquals(lines.length, 2);
});
