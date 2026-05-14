/**
 * @module lsp/rename_test
 *
 * Unit tests for {@linkcode findIdOccurrencesInFile} — locates every
 * whole-word occurrence of a display ID in a file's text, returning
 * `TextEdit`s ready to feed into an LSP `WorkspaceEdit`.
 */

import { assertEquals } from "@std/assert";
import { findIdOccurrencesInFile } from "./rename.ts";

Deno.test("findIdOccurrencesInFile: finds bracketed declaration", () => {
  const text = `# Test

- [REQ-001] My req

  Body.
`;
  const edits = findIdOccurrencesInFile(text, "REQ-001", "REQ-100");
  assertEquals(edits.length, 1);
  assertEquals(edits[0].newText, "REQ-100");
  // Line 3 (0-based: 2), starting after the `[`.
  assertEquals(edits[0].range.start.line, 2);
  assertEquals(edits[0].range.start.character, 3);
  assertEquals(edits[0].range.end.character, 10);
});

Deno.test("findIdOccurrencesInFile: finds trace attribute reference", () => {
  const text = `# Test

- [TST-001] My test

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Verifies: REQ-001
`;
  const edits = findIdOccurrencesInFile(text, "REQ-001", "REQ-100");
  assertEquals(edits.length, 1);
  // Position of REQ-001 on the Verifies line.
  assertEquals(edits[0].range.start.line, 5);
});

Deno.test("findIdOccurrencesInFile: finds multiple occurrences", () => {
  const text = `- [REQ-001] First

      Satisfies: SYS-001

- [REQ-002] Second

      Satisfies: REQ-001
      Derived-from: REQ-001
`;
  const edits = findIdOccurrencesInFile(text, "REQ-001", "REQ-100");
  assertEquals(edits.length, 3);
});

Deno.test("findIdOccurrencesInFile: whole-token only — REQ-001 does not match REQ-0010", () => {
  const text = `- [REQ-0010] Renamed sibling

      Satisfies: REQ-001-extra
`;
  const edits = findIdOccurrencesInFile(text, "REQ-001", "REQ-100");
  assertEquals(edits, []);
});

Deno.test("findIdOccurrencesInFile: empty text yields empty result", () => {
  assertEquals(findIdOccurrencesInFile("", "REQ-001", "REQ-100"), []);
});

Deno.test("findIdOccurrencesInFile: no match yields empty result", () => {
  const text = `- [TST-001] Just a test\n\n  Body.\n`;
  assertEquals(findIdOccurrencesInFile(text, "REQ-001", "REQ-100"), []);
});
