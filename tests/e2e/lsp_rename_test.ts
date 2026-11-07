/**
 * @module tests/e2e/lsp_rename_test
 *
 * Rename requests sent directly to the LSP server over stdio.
 */

import { assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

Deno.test("lsp rename: a fenced cursor cannot rename a real declaration (#704)", async () => {
  const declaration = [
    "- [REQ-001] Real requirement",
    "",
    "  The system shall work.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "",
  ].join("\n");
  const example = [
    "# Example",
    "",
    "```markdown",
    "- [REQ-001] Illustrative example",
    "```",
    "",
  ].join("\n");
  const client = await LspTestClient.create({
    "project.yaml": "name: rename-test\n",
    "reqs.md": declaration,
    "example.md": example,
  });
  try {
    await client.initialize();
    await client.waitForNotification("markspec/indexed", 15000);
    const declarationUri = toFileUrl(join(client.workDir, "reqs.md")).href;
    const exampleUri = toFileUrl(join(client.workDir, "example.md")).href;
    for (
      const [uri, text] of [
        [declarationUri, declaration],
        [exampleUri, example],
      ]
    ) {
      await client.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "markdown", version: 1, text },
      });
    }

    // A live cursor must produce an edit to the real declaration.
    const liveRename = await client.request("textDocument/rename", {
      textDocument: { uri: declarationUri },
      position: { line: 0, character: 5 },
      newName: "REQ-100",
    });
    assertEquals(liveRename, {
      changes: {
        [declarationUri]: [{
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 10 },
          },
          newText: "REQ-100",
        }],
      },
    });

    // Send rename directly, without a preceding prepareRename request.
    const fencedRename = await client.request("textDocument/rename", {
      textDocument: { uri: exampleUri },
      position: { line: 3, character: 5 },
      newName: "REQ-100",
    });
    assertEquals(fencedRename, null);
  } finally {
    await client.shutdown();
    await Deno.remove(client.workDir, { recursive: true });
  }
});

for (const newline of ["\n", "\r\n"]) {
  Deno.test(`lsp source fences: indented Java doc comment (${JSON.stringify(newline)})`, async (t) => {
    const source = [
      "class Example {",
      "    /**",
      "    [REQ_001] Real requirement",
      "    ",
      "      ```markdown",
      "      - [REQ_001] Illustrative example",
      "      ```",
      "    ",
      "          Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
      "    */",
      "    void run() {}",
      "}",
    ].join(newline);
    const client = await LspTestClient.create({
      "project.yaml": "name: source-rename-test\n",
      "Example.java": source,
    });
    try {
      await client.initialize();
      await client.waitForNotification("markspec/indexed", 15000);
      const uri = toFileUrl(join(client.workDir, "Example.java")).href;
      await client.notify("textDocument/didOpen", {
        textDocument: { uri, languageId: "java", version: 1, text: source },
      });
      const textDocument = { uri };
      const symbols = await client.request("textDocument/documentSymbol", {
        textDocument,
      }) as Array<{ name: string }>;
      assertEquals(symbols.map((symbol) => symbol.name), ["REQ_001"]);
      const livePosition = { line: 2, character: 7 };
      const examplePosition = { line: 5, character: 11 };
      await t.step("rename emits exactly one edit", async () => {
        assertEquals(
          await client.request("textDocument/rename", {
            textDocument,
            position: livePosition,
            newName: "REQ_100",
          }),
          {
            changes: {
              [uri]: [{
                range: {
                  start: { line: 2, character: 5 },
                  end: { line: 2, character: 12 },
                },
                newText: "REQ_100",
              }],
            },
          },
        );
      });
      await t.step("highlights exclude the example", async () => {
        assertEquals(
          await client.request("textDocument/documentHighlight", {
            textDocument,
            position: livePosition,
          }),
          [{
            range: {
              start: { line: 2, character: 5 },
              end: { line: 2, character: 12 },
            },
            kind: 3,
          }],
        );
      });
      for (const method of ["rename", "prepareRename", "documentHighlight"]) {
        await t.step(`${method} rejects the example cursor`, async () => {
          assertEquals(
            await client.request(`textDocument/${method}`, {
              textDocument,
              position: examplePosition,
              ...(method === "rename" ? { newName: "REQ_100" } : {}),
            }),
            null,
          );
        });
      }
    } finally {
      await client.shutdown();
      await Deno.remove(client.workDir, { recursive: true });
    }
  });
}
