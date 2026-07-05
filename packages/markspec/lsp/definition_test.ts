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
import {
  entryToLspLocation,
  hasNavigableLocation,
  resolveNavigableLocation,
} from "./definition.ts";

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
    source: { kind: "markdown" },
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

function makeUpstreamEntry(file: string): Entry {
  return {
    ...makeEntry(file, 12, 1),
    origin: { kind: "upstream", upstreamId: "product", version: "v2.1.0" },
  };
}

Deno.test("resolveNavigableLocation: project entry resolves to its location", () => {
  const entry = makeEntry("/abs/req.md", 5, 1);
  const loc = resolveNavigableLocation(entry);
  assertEquals(loc, entryToLspLocation(entry));
});

Deno.test("resolveNavigableLocation: upstream entry is a no-op (null)", () => {
  const entry = makeUpstreamEntry("docs/product/stk.md");
  assertEquals(resolveNavigableLocation(entry), null);
});

Deno.test("resolveNavigableLocation: delivered-corpus (profile) entry still resolves", () => {
  const entry: Entry = {
    ...makeEntry("/abs/cache/req.md", 5, 1),
    origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
  };
  // Delivered-corpus entries have a real local file — go-to-definition must
  // still navigate (only upstream entries are the no-op).
  assertEquals(resolveNavigableLocation(entry), entryToLspLocation(entry));
});

// --- hasNavigableLocation ---

Deno.test("hasNavigableLocation: upstream entry has no navigable location", () => {
  const entry = makeUpstreamEntry("docs/product/stk.md");
  assertEquals(hasNavigableLocation(entry), false);
});

Deno.test("hasNavigableLocation: project entry has a navigable location", () => {
  const entry = makeEntry("/abs/req.md", 5, 1);
  assertEquals(hasNavigableLocation(entry), true);
});

Deno.test("hasNavigableLocation: delivered-corpus (profile) entry has a navigable location", () => {
  const entry: Entry = {
    ...makeEntry("/abs/cache/req.md", 5, 1),
    origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
  };
  assertEquals(hasNavigableLocation(entry), true);
});
