/**
 * @module lsp/formatting_test
 *
 * Unit tests for {@linkcode buildFormattingEdits} — pure helper that
 * turns a (currentText, formattedText) pair into the LSP `TextEdit[]`
 * payload the LSP `textDocument/formatting` handler returns.
 */

import { assertEquals } from "@std/assert";
import {
  buildF012FallbackMessage,
  buildFormattingEdits,
} from "./formatting.ts";

Deno.test("buildF012FallbackMessage: undefined when no MSL-F012 diagnostics", () => {
  assertEquals(buildF012FallbackMessage([]), undefined);
  assertEquals(
    buildF012FallbackMessage([{ code: "MSL-F010" }, { code: "MSL-F001" }]),
    undefined,
  );
});

Deno.test("buildF012FallbackMessage: counts only MSL-F012 and names the count", () => {
  const msg = buildF012FallbackMessage([
    { code: "MSL-F012" },
    { code: "MSL-F010" },
    { code: "MSL-F012" },
  ]);
  assertEquals(typeof msg, "string");
  assertEquals(msg!.includes("2 segment(s)"), true);
  assertEquals(msg!.includes("MSL-F012"), true);
});

Deno.test("buildFormattingEdits: unchanged text returns empty array", () => {
  const text = "- [STK_0001] Title\n\n  Body.\n";
  assertEquals(buildFormattingEdits(text, text), []);
});

Deno.test("buildFormattingEdits: single-line change returns whole-document edit", () => {
  const current = "hello\n";
  const formatted = "world\n";
  const edits = buildFormattingEdits(current, formatted);
  assertEquals(edits.length, 1);
  assertEquals(edits[0].range, {
    start: { line: 0, character: 0 },
    end: { line: 1, character: 0 },
  });
  assertEquals(edits[0].newText, "world\n");
});

Deno.test("buildFormattingEdits: multi-line change spans full document", () => {
  const current = "line one\nline two\nline three\n";
  const formatted = "LINE ONE\nLINE TWO\nLINE THREE\n";
  const edits = buildFormattingEdits(current, formatted);
  assertEquals(edits.length, 1);
  assertEquals(edits[0].range, {
    start: { line: 0, character: 0 },
    end: { line: 3, character: 0 },
  });
  assertEquals(edits[0].newText, formatted);
});

Deno.test("buildFormattingEdits: document without trailing newline", () => {
  const current = "no newline";
  const formatted = "NO NEWLINE";
  const edits = buildFormattingEdits(current, formatted);
  assertEquals(edits.length, 1);
  assertEquals(edits[0].range, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: "no newline".length },
  });
  assertEquals(edits[0].newText, "NO NEWLINE");
});

Deno.test("buildFormattingEdits: empty current document", () => {
  const edits = buildFormattingEdits("", "new content\n");
  assertEquals(edits.length, 1);
  assertEquals(edits[0].range, {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  });
  assertEquals(edits[0].newText, "new content\n");
});
