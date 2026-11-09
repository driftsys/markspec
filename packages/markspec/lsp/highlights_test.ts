/**
 * @module lsp/highlights_test
 *
 * Unit tests for {@linkcode findOccurrencesInFile} — the document-
 * highlights helper that locates every whole-token occurrence of a
 * display ID in a file's text and returns LSP `DocumentHighlight`
 * payloads.
 */

import { assertEquals } from "@std/assert";
import {
  DocumentHighlightKindRead,
  DocumentHighlightKindText,
  DocumentHighlightKindWrite,
  findOccurrencesInFile,
} from "./highlights.ts";

Deno.test("findOccurrencesInFile: slash belongs to the whole ID", () => {
  const line = "SYS_A/SYS_B";
  assertEquals(findOccurrencesInFile(line, line), [{
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 11 },
    },
    kind: DocumentHighlightKindRead,
  }]);
  for (const id of ["SYS_A", "SYS_B"]) {
    assertEquals(findOccurrencesInFile(line, id), []);
  }
});

Deno.test("findOccurrencesInFile: trailing ID characters belong to the highlight", () => {
  for (const id of ["REQ_", "REQ-", "REQ.", "REQ/", "REQ.part-_"]) {
    assertEquals(findOccurrencesInFile(`[${id}]`, id), [{
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: id.length + 1 },
      },
      kind: DocumentHighlightKindWrite,
    }]);
  }
});

for (const separator of [".", "_"]) {
  for (const side of ["left", "right"]) {
    Deno.test(`findOccurrencesInFile: ${separator} on the ${side} prevents a partial ID highlight`, () => {
      const text = side === "left"
        ? `See ${separator}REQ-001`
        : `See REQ-001${separator}`;
      assertEquals(findOccurrencesInFile(text, "REQ-001"), []);
    });
  }
}

Deno.test("findOccurrencesInFile: bracketed declaration is a Write kind", () => {
  const text = `- [REQ-001] My req\n\n  Body.\n`;
  const highlights = findOccurrencesInFile(text, "REQ-001");
  assertEquals(highlights.length, 1);
  assertEquals(highlights[0].kind, DocumentHighlightKindWrite);
  assertEquals(highlights[0].range.start.line, 0);
  assertEquals(highlights[0].range.start.character, 3);
  assertEquals(highlights[0].range.end.character, 10);
});

Deno.test("findOccurrencesInFile: trace-attribute reference is a Read kind", () => {
  const text = `- [TST-001] My test

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Verifies: REQ-001
`;
  const highlights = findOccurrencesInFile(text, "REQ-001");
  assertEquals(highlights.length, 1);
  assertEquals(highlights[0].kind, DocumentHighlightKindRead);
});

Deno.test("findOccurrencesInFile: multiple occurrences across lines", () => {
  const text = `- [REQ-001] First

      Satisfies: SYS-001

- [REQ-002] Second

      Satisfies: REQ-001
`;
  const highlights = findOccurrencesInFile(text, "REQ-001");
  assertEquals(highlights.length, 2);
  // Declaration first (line 0), then reference (line 6).
  assertEquals(highlights[0].kind, DocumentHighlightKindWrite);
  assertEquals(highlights[1].kind, DocumentHighlightKindRead);
});

Deno.test("findOccurrencesInFile: whole-token only", () => {
  const text = `- [REQ-0010] Renamed sibling

      Satisfies: REQ-001-extra
`;
  assertEquals(findOccurrencesInFile(text, "REQ-001"), []);
});

Deno.test("findOccurrencesInFile: empty input yields empty result", () => {
  assertEquals(findOccurrencesInFile("", "REQ-001"), []);
});

// --- fenced code regions (#680) ---

Deno.test("findOccurrencesInFile: skips an occurrence inside a fenced code example", () => {
  const text = [
    `- [REQ-001] Real requirement`,
    ``,
    `  Body.`,
    ``,
    `\`\`\`markdown`,
    `- [REQ-001] Illustrative example`,
    `\`\`\``,
  ].join("\n");
  const highlights = findOccurrencesInFile(text, "REQ-001");
  assertEquals(highlights.length, 1);
  assertEquals(highlights[0].kind, DocumentHighlightKindWrite);
});

Deno.test("findOccurrencesInFile: tilde fences are also honored", () => {
  const text = [
    `~~~`,
    `- [REQ-001] Illustrative example`,
    `~~~`,
  ].join("\n");
  assertEquals(findOccurrencesInFile(text, "REQ-001"), []);
});

Deno.test("findOccurrencesInFile: kind constants are the LSP-defined integers", () => {
  // Spec: Text=1, Read=2, Write=3.
  assertEquals(DocumentHighlightKindText, 1);
  assertEquals(DocumentHighlightKindRead, 2);
  assertEquals(DocumentHighlightKindWrite, 3);
});

for (const newline of ["\n", "\r\n"]) {
  Deno.test(`findOccurrencesInFile: protects four-space list fence (${JSON.stringify(newline)})`, () => {
    const text = [
      "- [REQ-001] Real",
      "    ```md",
      "      Satisfies: REQ-001",
      "    ```",
    ].join(newline);
    assertEquals(
      findOccurrencesInFile(text, "REQ-001").map((item) =>
        item.range.start.line
      ),
      [0],
    );
  });
  Deno.test(`findOccurrencesInFile: resumes at sibling after unclosed long fence (${JSON.stringify(newline)})`, () => {
    const text = [
      "- Example",
      "  ````md",
      "  ```",
      "      Satisfies: REQ-001",
      "",
      "- [REQ-001] Sibling",
      "      Satisfies: REQ-001",
    ].join(newline);
    assertEquals(
      findOccurrencesInFile(text, "REQ-001").map((item) =>
        item.range.start.line
      ),
      [5, 6],
    );
  });
}
