/**
 * @module lsp/find_entry_test
 */

import { assertEquals } from "@std/assert";
import { findEnclosingEntry } from "./find_entry.ts";
import type { Entry } from "../core/mod.ts";
import { makeDisplayId } from "../core/mod.ts";

function makeEntry(id: string, line: number): Entry {
  return {
    displayId: makeDisplayId(id),
    title: id,
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "f.md", line, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  };
}

Deno.test("findEnclosingEntry: empty list returns undefined", () => {
  assertEquals(findEnclosingEntry([], 5), undefined);
});

Deno.test("findEnclosingEntry: cursor above first entry returns undefined", () => {
  const entries = [makeEntry("A", 10), makeEntry("B", 20)];
  assertEquals(findEnclosingEntry(entries, 5), undefined);
});

Deno.test("findEnclosingEntry: cursor on title line picks that entry", () => {
  const entries = [makeEntry("A", 10), makeEntry("B", 20)];
  assertEquals(findEnclosingEntry(entries, 10)?.displayId, "A");
  assertEquals(findEnclosingEntry(entries, 20)?.displayId, "B");
});

Deno.test("findEnclosingEntry: cursor inside an entry block picks that entry", () => {
  const entries = [makeEntry("A", 10), makeEntry("B", 20)];
  assertEquals(findEnclosingEntry(entries, 15)?.displayId, "A");
  assertEquals(findEnclosingEntry(entries, 19)?.displayId, "A");
});

Deno.test("findEnclosingEntry: cursor below the last entry sticks to it", () => {
  const entries = [makeEntry("A", 10), makeEntry("B", 20)];
  assertEquals(findEnclosingEntry(entries, 100)?.displayId, "B");
});

Deno.test("findEnclosingEntry: out-of-order input is sorted internally", () => {
  const entries = [makeEntry("B", 20), makeEntry("A", 10), makeEntry("C", 30)];
  assertEquals(findEnclosingEntry(entries, 15)?.displayId, "A");
  assertEquals(findEnclosingEntry(entries, 25)?.displayId, "B");
  assertEquals(findEnclosingEntry(entries, 35)?.displayId, "C");
});
