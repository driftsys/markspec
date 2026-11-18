/**
 * @module tests/e2e/lsp_formatting_test
 *
 * E2E test: open an unformatted MarkSpec file → request
 * `textDocument/formatting` → assert the returned edits stamp a ULID.
 *
 * Covers spec §3 acceptance criteria 1, 2, and 3:
 *   - `documentFormattingProvider` advertised (implicit — request returns
 *     without method-not-found error).
 *   - Returned edits produce the same content as `markspec format`.
 *   - ULID stamping happens on the LSP path.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

Deno.test("lsp formatting: stamps ULID for an unformatted entry", async () => {
  // Entry without an Id: trailer — the formatter must stamp one.
  const md = `- [STK_AEB_0001] Vehicle stops before collision

  The vehicle shall stop before an obstacle.
`;
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    "reqs.md": md,
  });
  try {
    await client.initialize();

    const fileUri = toFileUrl(join(client.workDir, "reqs.md")).href;
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: fileUri,
        languageId: "markdown",
        version: 1,
        text: md,
      },
    });

    const edits = await client.request("textDocument/formatting", {
      textDocument: { uri: fileUri },
      options: { tabSize: 2, insertSpaces: true },
    }) as Array<{
      range: { start: unknown; end: unknown };
      newText: string;
    }>;

    assertExists(edits);
    assertEquals(
      edits.length,
      1,
      `Expected exactly one edit, got ${edits.length}`,
    );
    // The replacement text must include the ULID-stamped Id: trailer.
    assert(
      /\n\s{6}Id:\s+[0-9A-HJKMNP-TV-Z]{26}\b/.test(edits[0].newText),
      `Expected ULID-stamped Id trailer in newText, got:\n${edits[0].newText}`,
    );
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp formatting: returns empty edits for already-formatted file", async () => {
  // File is already in canonical form — formatter is idempotent.
  const md = `- [STK_AEB_0001] Vehicle stops before collision

  The vehicle shall stop before an obstacle.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    "reqs.md": md,
  });
  try {
    await client.initialize();

    const fileUri = toFileUrl(join(client.workDir, "reqs.md")).href;
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: fileUri,
        languageId: "markdown",
        version: 1,
        text: md,
      },
    });

    const edits = await client.request("textDocument/formatting", {
      textDocument: { uri: fileUri },
      options: { tabSize: 2, insertSpaces: true },
    }) as Array<unknown>;

    assertExists(edits);
    assertEquals(
      edits.length,
      0,
      "Already-formatted file should yield no edits",
    );
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp formatting: returns empty edits for a source file (ADR-029 scope guard)", async () => {
  // Rust doc-comment carries an entry marker so `isDocCommentContext`
  // would treat this as MarkSpec-relevant on every OTHER position-level
  // handler — the formatting guard must still refuse to touch it, since
  // source files are read-only for formatting even when MarkSpec-relevant.
  const rust = [
    "/// [STK_0001] Vehicle stops before collision",
    "///",
    "/// The vehicle shall stop before an obstacle.",
    "fn main() {",
    "    let x = compute(1, 2);",
    '    println!("{}", x);',
    "}",
    "",
  ].join("\n");
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    "main.rs": rust,
  });
  try {
    await client.initialize();

    const fileUri = toFileUrl(join(client.workDir, "main.rs")).href;
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: fileUri,
        languageId: "rust",
        version: 1,
        text: rust,
      },
    });

    const edits = await client.request("textDocument/formatting", {
      textDocument: { uri: fileUri },
      options: { tabSize: 2, insertSpaces: true },
    });

    // ADR-029: the whole-document markdown pass is Markdown-only. A source
    // file must yield no edits — never [1 giant paragraph-joined edit].
    assertEquals(
      edits,
      [],
      "Source files must return empty edits, even when MarkSpec-relevant",
    );
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp formatting: returns empty edits for non-MarkSpec file", async () => {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    "config.json": '{"k":1}\n',
  });
  try {
    await client.initialize();

    const fileUri = toFileUrl(join(client.workDir, "config.json")).href;
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: fileUri,
        languageId: "json",
        version: 1,
        text: '{"k":1}\n',
      },
    });

    const edits = await client.request("textDocument/formatting", {
      textDocument: { uri: fileUri },
      options: { tabSize: 2, insertSpaces: true },
    });

    // Spec §3.4: non-MarkSpec files MUST return an empty TextEdit[] (not null).
    assertEquals(edits, [], "Non-MarkSpec files should return empty edits");
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp formatting: uses max_line_length from .editorconfig (#984)", async () => {
  // One 93-column paragraph: unchanged at width 100, wrapped at 80.
  const md = "# Doc\n\nThis paragraph is long enough to pass eighty columns " +
    "but it stays shorter than one hundred cols.\n";
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    ".editorconfig": "root = true\n[*.md]\nmax_line_length = 100\n",
    "doc.md": md,
  });
  try {
    await client.initialize();
    const fileUri = toFileUrl(join(client.workDir, "doc.md")).href;
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: fileUri,
        languageId: "markdown",
        version: 1,
        text: md,
      },
    });
    const edits = await client.request("textDocument/formatting", {
      textDocument: { uri: fileUri },
      options: { tabSize: 2, insertSpaces: true },
    }) as Array<unknown>;
    assertExists(edits);
    assertEquals(edits.length, 0, "width 100 must keep the paragraph as is");
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp formatting: a formatted CRLF buffer yields no edits (#984)", async () => {
  // No `end_of_line` anywhere: `markspec fmt` would write LF, but the LSP
  // leaves the buffer's line ending to the editor, so formatting converges.
  const md = "# Doc\r\n\r\nShort line.\r\n";
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    "doc.md": md,
  });
  try {
    await client.initialize();
    const fileUri = toFileUrl(join(client.workDir, "doc.md")).href;
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: fileUri,
        languageId: "markdown",
        version: 1,
        text: md,
      },
    });
    for (let i = 0; i < 2; i++) {
      const edits = await client.request("textDocument/formatting", {
        textDocument: { uri: fileUri },
        options: { tabSize: 2, insertSpaces: true },
      }) as Array<unknown>;
      assertExists(edits);
      assertEquals(edits.length, 0, `request ${i + 1}`);
    }
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp formatting: a profile with modal-keywords.casing: preserve keeps the casing", async () => {
  const md = `- [REQ-0001] Legacy wording

  The system SHALL act When requested.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
`;
  const client = await LspTestClient.create({
    "project.yaml": "name: casing-lsp\nversion: 0.1.0\n",
    ".markspec.yaml": "profiles:\n  - ./profiles/p\n",
    "profiles/p/markspec.yaml": `markspec-schema: "1"
id: "@acme/legacy"
version: 0.1.0
profile:
  conventions:
    modal-keywords:
      casing: preserve
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`,
    "reqs.md": md,
  });
  try {
    await client.initialize();
    const fileUri = toFileUrl(join(client.workDir, "reqs.md")).href;
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: fileUri,
        languageId: "markdown",
        version: 1,
        text: md,
      },
    });
    const edits = await client.request("textDocument/formatting", {
      textDocument: { uri: fileUri },
      options: { tabSize: 2, insertSpaces: true },
    }) as Array<unknown>;
    assertExists(edits);
    assertEquals(edits.length, 0, JSON.stringify(edits));
  } finally {
    await client.shutdown();
  }
});
