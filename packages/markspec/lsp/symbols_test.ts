/**
 * @module lsp/symbols_test
 *
 * Unit tests for {@linkcode entriesToDocumentSymbols} — produces the
 * `DocumentSymbol[]` list for the LSP outline view.
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../core/model/mod.ts";
import { entriesToDocumentSymbols, SymbolKindClass } from "./symbols.ts";

function makeEntry(opts: {
  displayId: string;
  title: string;
  line: number;
  column?: number;
  type?: string;
  shape?: "identified" | "referenced";
}): Entry {
  return {
    displayId: opts.displayId,
    title: opts.title,
    body: "",
    rawAttributes: [{ key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" }],
    typedAttributes: new Map(),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: opts.shape ?? "identified",
    type: opts.type,
    location: { file: "t.md", line: opts.line, column: opts.column ?? 1 },
    source: "markdown",
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
