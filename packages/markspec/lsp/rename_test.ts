/**
 * @module lsp/rename_test
 *
 * Unit tests for {@linkcode findIdOccurrencesInFile} — locates every
 * whole-word occurrence of a display ID in a file's text, returning
 * `TextEdit`s ready to feed into an LSP `WorkspaceEdit`.
 */

import { findOccurrencesInFile } from "./highlights.ts";

import { assertEquals } from "@std/assert";
import { TextDocument } from "vscode-languageserver-textdocument";
import { fencedLinesForFile } from "./context.ts";
import {
  displayIdForRename,
  findIdOccurrencesInFile,
  prepareRenameRange,
} from "./rename.ts";

Deno.test("rename: slash belongs to the whole ID and its cursor range", () => {
  const line = "SYS_A/SYS_B";
  const range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 11 },
  };
  assertEquals(prepareRenameRange(line, 5, 0), {
    range,
    placeholder: "SYS_A/SYS_B",
  });
  assertEquals(findIdOccurrencesInFile(line, line, "NEW_ID"), [{
    range,
    newText: "NEW_ID",
  }]);
  for (const id of ["SYS_A", "SYS_B"]) {
    assertEquals(findIdOccurrencesInFile(line, id, "NEW_ID"), []);
  }
});

Deno.test("rename: trailing ID characters belong to the range", () => {
  for (const id of ["REQ_", "REQ-", "REQ.", "REQ/", "REQ.part-_"]) {
    const range = {
      start: { line: 0, character: 1 },
      end: { line: 0, character: id.length + 1 },
    };
    assertEquals(prepareRenameRange(`[${id}]`, 2, 0), {
      range,
      placeholder: id,
    });
    assertEquals(findIdOccurrencesInFile(`[${id}]`, id, "NEW_ID"), [{
      range,
      newText: "NEW_ID",
    }]);
  }
});

Deno.test("prepareRenameRange: rejects an underscore-leading token", () => {
  assertEquals(prepareRenameRange("[_REQ]", 2, 0), null);
});

for (const separator of [".", "_", "-"]) {
  for (const side of ["left", "right"]) {
    Deno.test(`rename: ${separator} on the ${side} prevents a partial ID replacement`, () => {
      const text = side === "left"
        ? `See ${separator}REQ-001`
        : `See REQ-001${separator}`;
      assertEquals(findIdOccurrencesInFile(text, "REQ-001", "NEW_ID"), []);
    });
  }
}

for (const separator of [".", "/", "-"]) {
  Deno.test(`rename: scans left across ${separator} from an ID suffix`, () => {
    assertEquals(prepareRenameRange(`[REQ${separator}part]`, 6, 0), {
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 9 },
      },
      placeholder: `REQ${separator}part`,
    });
  });
}

Deno.test("displayIdForRename: resolves the LSP cursor line after a CR", () => {
  const text = "# Heading\rREQ-001\nREQ-002";
  const document = TextDocument.create("file:///reqs.md", "markdown", 1, text);
  const line = document.getText({
    start: { line: 1, character: 0 },
    end: { line: 1, character: Number.MAX_SAFE_INTEGER },
  });
  assertEquals(line, "REQ-001");
  assertEquals(displayIdForRename(text, line, 1, 2), "REQ-001");
});

Deno.test("displayIdForRename: rejects fenced cursors that reuse a real ID", () => {
  for (const fence of ["```", "~~~"]) {
    const text = [
      "- [REQ-001] Real requirement",
      `${fence}markdown`,
      "- [REQ-001] Illustrative example",
      fence,
      "      Satisfies: REQ-001",
    ].join("\n");
    const lines = text.split("\n");

    assertEquals(displayIdForRename(text, lines[2], 2, 5), undefined);
    assertEquals(displayIdForRename(text, lines[1], 1, 4), undefined);
    assertEquals(displayIdForRename(text, lines[0], 0, 5), "REQ-001");
    assertEquals(displayIdForRename(text, lines[4], 4, 20), "REQ-001");
  }
});

Deno.test("displayIdForRename: rejects whitespace and missing lines", () => {
  const text = "- [REQ-001] Real requirement";
  assertEquals(displayIdForRename(text, text, 0, 1), undefined);
  assertEquals(displayIdForRename(text, "", 1, 5), undefined);
});

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

// --- fenced code regions (#680) ---

Deno.test("findIdOccurrencesInFile: skips an occurrence inside a fenced code example", () => {
  const text = [
    `- [REQ-001] Real requirement`,
    ``,
    `  Body.`,
    ``,
    `\`\`\`markdown`,
    `- [REQ-001] Illustrative example`,
    `\`\`\``,
  ].join("\n");
  const edits = findIdOccurrencesInFile(text, "REQ-001", "REQ-100");
  assertEquals(edits.length, 1);
  assertEquals(edits[0].range.start.line, 0);
});

Deno.test("findIdOccurrencesInFile: renames occurrences before and after a fenced example", () => {
  const text = [
    `- [REQ-001] Real requirement`,
    ``,
    `\`\`\`markdown`,
    `      Satisfies: REQ-001`,
    `\`\`\``,
    ``,
    `- [REQ-002] Other`,
    ``,
    `      Satisfies: REQ-001`,
  ].join("\n");
  const edits = findIdOccurrencesInFile(text, "REQ-001", "REQ-100");
  assertEquals(edits.length, 2);
  assertEquals(edits[0].range.start.line, 0);
  assertEquals(edits[1].range.start.line, 8);
});

Deno.test("findIdOccurrencesInFile: tilde fences are also honored", () => {
  const text = [
    `~~~`,
    `- [REQ-001] Illustrative example`,
    `~~~`,
  ].join("\n");
  assertEquals(findIdOccurrencesInFile(text, "REQ-001", "REQ-100"), []);
});

// --- prepareRenameRange ---

Deno.test("prepareRenameRange: returns range + placeholder when cursor is on a display ID", () => {
  const line = "      Satisfies: REQ-001";
  const result = prepareRenameRange(line, 20, 5);
  assertEquals(result, {
    range: {
      start: { line: 5, character: 17 },
      end: { line: 5, character: 24 },
    },
    placeholder: "REQ-001",
  });
});

Deno.test("prepareRenameRange: returns null when cursor lies on whitespace", () => {
  const line = "      Satisfies:    ";
  assertEquals(prepareRenameRange(line, 19, 3), null);
});

Deno.test("prepareRenameRange: returns null when cursor lands on a short token", () => {
  const line = "- [REQ-001] my requirement";
  // Cursor on the word 'my' — too short to be a display ID.
  assertEquals(prepareRenameRange(line, 13, 0), null);
});

Deno.test("prepareRenameRange: handles bracketed declaration", () => {
  const line = "- [REQ-001] Title";
  const result = prepareRenameRange(line, 5, 0);
  assertEquals(result?.placeholder, "REQ-001");
  assertEquals(result?.range.start.character, 3);
  assertEquals(result?.range.end.character, 10);
});

for (const newline of ["\n", "\r\n"]) {
  Deno.test(`findIdOccurrencesInFile: protects four-space list fence (${JSON.stringify(newline)})`, () => {
    const text = [
      "- [REQ-001] Real",
      "    ```md",
      "      Satisfies: REQ-001",
      "    ```",
    ].join(newline);
    assertEquals(
      findIdOccurrencesInFile(text, "REQ-001", "REQ-100").map((item) =>
        item.range.start.line
      ),
      [0],
    );
    assertEquals(
      displayIdForRename(text, "      Satisfies: REQ-001", 2, 20),
      undefined,
    );
  });
  Deno.test(`findIdOccurrencesInFile: resumes at sibling after unclosed long fence (${JSON.stringify(newline)})`, () => {
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
      findIdOccurrencesInFile(text, "REQ-001", "REQ-100").map((item) =>
        item.range.start.line
      ),
      [5, 6],
    );
  });
}

for (const newline of ["\n", "\r\n"]) {
  for (
    const { name, lines, live } of [
      {
        name: "dedented closer",
        lines: ["   ~~~text", "   REQ-001", "~~~", "- [REQ-001] Live"],
        live: [3],
      },
      {
        name: "space-indented closer",
        lines: ["~~~text", "    ~~~", "REQ-001", "~~~", "REQ-001"],
        live: [4],
      },
      {
        name: "tab-indented closer",
        lines: ["~~~text", "\t~~~", "REQ-001", "~~~", "REQ-001"],
        live: [4],
      },
      {
        name: "block quote",
        lines: [" > ~~~text", " > REQ-001", " > ~~~", "REQ-001"],
        live: [3],
      },
      {
        name: "list marker",
        lines: ["- ~~~text", "  REQ-001", "  ~~~", "- REQ-001"],
        live: [3],
      },
    ]
  ) {
    Deno.test(`LSP fence consumers: ${name} (${JSON.stringify(newline)})`, () => {
      const text = lines.join(newline);
      assertEquals(
        findIdOccurrencesInFile(text, "REQ-001", "REQ-100").map((e) =>
          e.range.start.line
        ),
        live,
      );
      assertEquals(
        findOccurrencesInFile(text, "REQ-001").map((e) => e.range.start.line),
        live,
      );
      lines.forEach((line, i) => {
        const column = line.indexOf("REQ-001");
        if (column >= 0) {
          assertEquals(
            displayIdForRename(text, line, i, column),
            live.includes(i) ? "REQ-001" : undefined,
          );
        }
      });
    });
  }
}

Deno.test("findIdOccurrencesInFile: an ID inside a locator is not rewritten (#915)", () => {
  const text = [
    "- [REQ_1] Title",
    "",
    "  See REQ_1 [not a locator] in prose.",
    "",
    "      Verifies: REQ_1 [Check REQ_1 behaviour]",
  ].join("\n");
  const edits = findIdOccurrencesInFile(text, "REQ_1", "REQ_9");
  assertEquals(
    edits.map((e) => [e.range.start.line, e.range.start.character]),
    [[0, 3], [2, 6], [4, 16]],
  );
});

Deno.test("findIdOccurrencesInFile: a doc-comment trailer locator is skipped (#915)", () => {
  const text = "///     Verifies: REQ_1 [Check REQ_1 behaviour]";
  const edits = findIdOccurrencesInFile(text, "REQ_1", "REQ_9");
  assertEquals(edits.map((e) => e.range.start.character), [18]);
});

Deno.test("findIdOccurrencesInFile: '*' and '#' comment trailers skip locators (#915)", () => {
  for (const prefix of [" *", "#"]) {
    const text = `${prefix}     Verifies: REQ_1 [Check REQ_1 behaviour]`;
    const edits = findIdOccurrencesInFile(text, "REQ_1", "REQ_9");
    assertEquals(edits.length, 1, prefix);
  }
});

Deno.test("findIdOccurrencesInFile: a '[' without whitespace before it is not a locator (#915)", () => {
  const text = "      Satisfies: REQ_2[REQ_1]";
  assertEquals(findIdOccurrencesInFile(text, "REQ_1", "REQ_9").length, 1);
});

Deno.test("rename: .feature files rewrite IDs on # lines only and keep locators", () => {
  const text = [
    "# [TST_0001] Login",
    "# Verified-by: TST_0001[Login]",
    "Feature: F",
    "  Scenario: S",
    "    Given TST_0001",
    '    """',
    "    TST_0001",
    '    """',
  ].join("\n");
  const edits = findIdOccurrencesInFile(
    text,
    "TST_0001",
    "TST_0009",
    fencedLinesForFile(text, "a.feature"),
  );
  assertEquals(edits.map((e) => e.range.start.line), [0, 1]);
  assertEquals(
    edits[1].range.end.character - edits[1].range.start.character,
    8,
  );
});
