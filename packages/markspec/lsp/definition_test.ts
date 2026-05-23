/**
 * @module lsp/definition_test
 *
 * Unit tests for {@linkcode entryToLspLocation} — converts a core
 * Entry's source location to an LSP `Location` (URI + zero-based
 * range).
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../core/model/mod.ts";
import { makeDisplayId } from "../core/model/mod.ts";
import { entryToLspLocation } from "./definition.ts";

function makeEntry(file: string, line: number, column: number): Entry {
  return {
    displayId: makeDisplayId("REQ-001"),
    title: "Test",
    body: "",
    rawAttributes: [{ key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" }],
    typedAttributes: new Map(),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    location: { file, line, column },
    source: "markdown",
    bodyTokens: [],
  };
}

Deno.test("entryToLspLocation: converts file path to file:// URI", () => {
  const entry = makeEntry("/abs/path/req.md", 5, 1);
  const loc = entryToLspLocation(entry);
  assertEquals(loc.uri, "file:///abs/path/req.md");
});

Deno.test("entryToLspLocation: line and column are 0-based (LSP convention)", () => {
  const entry = makeEntry("/x/req.md", 5, 3);
  const loc = entryToLspLocation(entry);
  // Core uses 1-based line/column; LSP uses 0-based.
  assertEquals(loc.range.start.line, 4);
  assertEquals(loc.range.start.character, 2);
  assertEquals(loc.range.end.line, 4);
  assertEquals(loc.range.end.character, 2);
});

Deno.test("entryToLspLocation: percent-encodes path segments with special chars", () => {
  const entry = makeEntry("/path with spaces/req.md", 1, 1);
  const loc = entryToLspLocation(entry);
  assertEquals(loc.uri, "file:///path%20with%20spaces/req.md");
});

Deno.test("entryToLspLocation: line 1 column 1 → 0,0 range", () => {
  const entry = makeEntry("/x.md", 1, 1);
  const loc = entryToLspLocation(entry);
  assertEquals(loc.range.start.line, 0);
  assertEquals(loc.range.start.character, 0);
});
