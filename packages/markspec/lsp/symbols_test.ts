/**
 * @module lsp/symbols_test
 *
 * Unit tests for {@linkcode entriesToDocumentSymbols} — produces the
 * `DocumentSymbol[]` list for the LSP outline view.
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../core/model/mod.ts";
import { makeDisplayId } from "../core/model/mod.ts";
import {
  entriesToDocumentSymbols,
  entriesToWorkspaceSymbols,
  SymbolKindClass,
} from "./symbols.ts";

function makeEntry(opts: {
  displayId: string;
  title: string;
  line: number;
  column?: number;
  type?: string;
  shape?: "Authored" | "Reference";
}): Entry {
  return {
    displayId: makeDisplayId(opts.displayId),
    title: opts.title,
    body: "",
    rawAttributes: [{ key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" }],
    typedAttributes: new Map(),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape ?? "Authored",
    type: opts.type,
    location: { file: "/t.md", line: opts.line, column: opts.column ?? 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  };
}

Deno.test("entriesToDocumentSymbols: one symbol per entry", () => {
  const entries = [
    makeEntry({ displayId: "REQ-001", title: "First", line: 3 }),
    makeEntry({ displayId: "REQ-002", title: "Second", line: 9 }),
  ];
  const symbols = entriesToDocumentSymbols(entries);
  assertEquals(symbols.length, 2);
  assertEquals(symbols[0].name, "REQ-001");
  assertEquals(symbols[0].detail, "First");
  assertEquals(symbols[1].name, "REQ-002");
});

Deno.test("entriesToDocumentSymbols: range/selectionRange use 0-based lines", () => {
  const entries = [
    makeEntry({ displayId: "REQ-001", title: "X", line: 5, column: 3 }),
  ];
  const sym = entriesToDocumentSymbols(entries)[0];
  assertEquals(sym.range.start.line, 4);
  assertEquals(sym.range.start.character, 2);
  assertEquals(sym.selectionRange.start.line, 4);
  assertEquals(sym.selectionRange.start.character, 2);
});

Deno.test("entriesToDocumentSymbols: detail prepends type when set", () => {
  const entries = [
    makeEntry({
      displayId: "REQ-001",
      title: "Sensor debouncing",
      line: 1,
      type: "Requirement",
    }),
  ];
  const sym = entriesToDocumentSymbols(entries)[0];
  // detail should include both type and title.
  assertEquals(sym.detail, "Requirement — Sensor debouncing");
});

Deno.test("entriesToDocumentSymbols: kind is the Class constant", () => {
  const entries = [makeEntry({ displayId: "REQ-001", title: "X", line: 1 })];
  const sym = entriesToDocumentSymbols(entries)[0];
  // LSP `SymbolKind.Class` = 5; assert via the named export.
  assertEquals(sym.kind, SymbolKindClass);
});

Deno.test("entriesToDocumentSymbols: empty entry list yields empty array", () => {
  assertEquals(entriesToDocumentSymbols([]), []);
});

// --- entriesToWorkspaceSymbols ---

Deno.test("entriesToWorkspaceSymbols: empty query returns all entries", () => {
  const entries = [
    makeEntry({ displayId: "REQ-001", title: "First", line: 1 }),
    makeEntry({ displayId: "TST-001", title: "Test", line: 5 }),
  ];
  const symbols = entriesToWorkspaceSymbols(entries, "");
  assertEquals(symbols.length, 2);
});

Deno.test("entriesToWorkspaceSymbols: matches by displayId substring (case-insensitive)", () => {
  const entries = [
    makeEntry({ displayId: "REQ-001", title: "Foo", line: 1 }),
    makeEntry({ displayId: "TST-001", title: "Bar", line: 5 }),
  ];
  const symbols = entriesToWorkspaceSymbols(entries, "req");
  assertEquals(symbols.length, 1);
  assertEquals(symbols[0].name, "REQ-001");
});

Deno.test("entriesToWorkspaceSymbols: matches by title substring (case-insensitive)", () => {
  const entries = [
    makeEntry({ displayId: "REQ-001", title: "Sensor debouncing", line: 1 }),
    makeEntry({ displayId: "TST-001", title: "Other thing", line: 5 }),
  ];
  const symbols = entriesToWorkspaceSymbols(entries, "Sensor");
  assertEquals(symbols.length, 1);
  assertEquals(symbols[0].name, "REQ-001");
});

Deno.test("entriesToWorkspaceSymbols: SymbolInformation carries location with file URI", () => {
  const entries = [
    makeEntry({ displayId: "REQ-001", title: "X", line: 3, column: 1 }),
  ];
  // Override location.file to an absolute path.
  entries[0] = {
    ...entries[0],
    location: { file: "/abs/path/req.md", line: 3, column: 1 },
  };
  const sym = entriesToWorkspaceSymbols(entries, "")[0];
  assertEquals(sym.location.uri, "file:///abs/path/req.md");
  assertEquals(sym.location.range.start.line, 2);
});

Deno.test("entriesToWorkspaceSymbols: kind is the Class constant", () => {
  const entries = [makeEntry({ displayId: "REQ-001", title: "X", line: 1 })];
  const sym = entriesToWorkspaceSymbols(entries, "")[0];
  assertEquals(sym.kind, SymbolKindClass);
});
