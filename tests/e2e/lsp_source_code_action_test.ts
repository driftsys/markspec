/**
 * @module tests/e2e/lsp_source_code_action_test
 *
 * E2E test: a `textDocument/codeAction` request on a Rust file reaches the
 * A030 and T020 quick fixes, which locate their line from the doc-comment
 * entries that the source parser extracted (#965).
 */

import { assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

const LINES = [
  "/**",
  " * [REQ-001] First",
  " *",
  " *     Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
  " *     Superseded-by: REQ-009",
  " *     Type: Requirment",
  " */",
  "fn a() {}",
  "",
  "/**",
  " * [REQ-002] Second",
  " *",
  " *     Id: 01HGW2Q8MNP3RSTVWXYZABCDEG",
  " *     Superseded-by: REQ-009",
  " *     Type: Requirment",
  " */",
  "fn b() {}",
  "",
];

type Edit = {
  range: { start: { line: number; character: number } };
  newText: string;
};

Deno.test("e2e lsp: codeAction on a .rs file fixes A030 and T020 in the diagnosed entry (#965)", async () => {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
  });
  try {
    await client.initialize();
    const uri = toFileUrl(join(client.workDir, "a.rs")).href;
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: "rust",
        version: 1,
        text: LINES.join("\n"),
      },
    });
    await client.waitUntil(
      () => client.latestDiagnosticsFor(uri) !== undefined,
      "parse diagnostics",
      10000,
    );
    // The diagnostics are on the title line of the second entry.
    const title = LINES.findIndex((l) => l.includes("[REQ-002]"));
    const diagnostics = [
      {
        code: "MSL-A030",
        severity: 2,
        source: "markspec",
        message: "REQ-002: 'Superseded-by' has generated origin",
        range: {
          start: { line: title, character: 0 },
          end: { line: title, character: 100 },
        },
      },
      {
        code: "MSL-T020",
        severity: 2,
        source: "markspec",
        message: "REQ-002: Type: 'Requirment' is not a core type",
        range: {
          start: { line: title, character: 0 },
          end: { line: title, character: 100 },
        },
      },
    ];
    const actions = await client.request("textDocument/codeAction", {
      textDocument: { uri },
      range: {
        start: { line: title, character: 0 },
        end: { line: title, character: 0 },
      },
      context: { diagnostics },
    }) as Array<{ title: string; edit: { changes: Record<string, Edit[]> } }>;
    assertEquals(actions.length, 2);
    const remove = actions.find((a) => a.title.startsWith("Remove"))!;
    assertEquals(
      remove.edit.changes[uri][0].range.start.line,
      LINES.findIndex((l, n) => n > title && l.includes("Superseded-by")),
    );
    const replace = actions.find((a) => a.title.startsWith("Replace"))!;
    assertEquals(replace.edit.changes[uri][0].newText, "Requirement");
    assertEquals(
      replace.edit.changes[uri][0].range.start.line,
      LINES.findIndex((l, n) => n > title && l.includes("Requirment")),
    );
  } finally {
    await client.shutdown();
  }
});
