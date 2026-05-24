/**
 * @module lsp/hover_test
 *
 * Unit tests for the LSP hover helpers — display-ID extraction at a
 * cursor position and Markdown-formatted hover content from an Entry.
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../core/model/mod.ts";
import { makeDisplayId } from "../core/model/mod.ts";
import { displayIdAtPosition, formatHoverContent } from "./hover.ts";

const ULID = "01HGW2Q8MNP3RSTVWXYZABCDEF";

function makeEntry(opts: {
  displayId: string;
  title: string;
  type?: string;
  body?: string;
}): Entry {
  return {
    displayId: makeDisplayId(opts.displayId),
    title: opts.title,
    body: opts.body ?? "",
    rawAttributes: [{ key: "Id", value: ULID }],
    typedAttributes: new Map(),
    id: ULID,
    shape: "Authored",
    type: opts.type,
    location: { file: "t.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  };
}

// --- displayIdAtPosition ---

Deno.test("displayIdAtPosition: extracts ID from inside [BRACKETED]", () => {
  const line = "- [REQ-001] My requirement";
  // Cursor at index 5 — middle of REQ-001.
  assertEquals(displayIdAtPosition(line, 5), "REQ-001");
});

Deno.test("displayIdAtPosition: extracts ID from trace value", () => {
  const line = "      Satisfies: REQ-001";
  // Cursor at index 20 — middle of REQ-001.
  assertEquals(displayIdAtPosition(line, 20), "REQ-001");
});

Deno.test("displayIdAtPosition: extracts ID from underscored form", () => {
  const line = "      Satisfies: SRS_BRK_0042";
  assertEquals(displayIdAtPosition(line, 23), "SRS_BRK_0042");
});

Deno.test("displayIdAtPosition: returns undefined when cursor is on whitespace", () => {
  const line = "      Satisfies:    ";
  assertEquals(displayIdAtPosition(line, 19), undefined);
});

Deno.test("displayIdAtPosition: returns undefined when cursor is past end", () => {
  const line = "- [REQ-001] My req";
  assertEquals(displayIdAtPosition(line, 999), undefined);
});

Deno.test("displayIdAtPosition: rejects short / non-ID-like tokens", () => {
  const line = "- [REQ-001] my requirement";
  // Cursor on the word "my".
  assertEquals(displayIdAtPosition(line, 13), undefined);
});

// --- formatHoverContent ---

Deno.test("formatHoverContent: returns title + type + Id when type is set", () => {
  const entry = makeEntry({
    displayId: "REQ-001",
    title: "Sensor debouncing",
    type: "Requirement",
  });
  const md = formatHoverContent(entry);
  assertEquals(md.includes("REQ-001"), true);
  assertEquals(md.includes("Sensor debouncing"), true);
  assertEquals(md.includes("Requirement"), true);
  assertEquals(md.includes(ULID), true);
});

Deno.test("formatHoverContent: omits type line when no type is set", () => {
  const entry = makeEntry({
    displayId: "TST-001",
    title: "Unit test",
  });
  const md = formatHoverContent(entry);
  assertEquals(md.includes("TST-001"), true);
  // 'Type:' label should be absent.
  assertEquals(md.includes("**Type:**"), false);
});

Deno.test("formatHoverContent: includes body excerpt (first paragraph)", () => {
  const entry = makeEntry({
    displayId: "REQ-001",
    title: "Title",
    body: "First paragraph.\n\nSecond paragraph.",
  });
  const md = formatHoverContent(entry);
  assertEquals(md.includes("First paragraph."), true);
  // Hover only previews first paragraph.
  assertEquals(md.includes("Second paragraph."), false);
});
