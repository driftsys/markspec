// tests/e2e/lsp_code_lens_test.ts

/**
 * @module tests/e2e/lsp_code_lens_test
 *
 * E2E test for `textDocument/codeLens` — drives the LSP via JSON-RPC
 * and verifies lens emission for the two kinds defined by spec §5.1.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

interface Command {
  title: string;
  command: string;
  arguments?: unknown[];
}
interface CodeLens {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  command?: Command;
}

Deno.test("lsp codeLens: dependents lens appears for referenced entry", async () => {
  const md = `- [STK_AEB_0001] Target requirement

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [SAD_AEB_0001] Child architecture item

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Satisfies: STK_AEB_0001
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

    // Give the server time to parse and index.
    await new Promise((r) => setTimeout(r, 500));

    const lenses = await client.request("textDocument/codeLens", {
      textDocument: { uri: fileUri },
    }) as CodeLens[];

    assertExists(lenses);
    // Expect 2 lenses: 1 dependents on STK_AEB_0001 + 1 Satisfies on SAD_AEB_0001.
    assertEquals(lenses.length, 2);
    const depLens = lenses.find((l) => l.command?.title.startsWith("↑"));
    assertEquals(depLens?.command?.title, "↑ 1 dependent");
    assertEquals(depLens?.command?.command, "markspec.openReferences");
    const satLens = lenses.find((l) => l.command?.title.startsWith("↓"));
    assert(
      satLens?.command?.title.startsWith("↓ Satisfies: STK_AEB_0001"),
      `Expected Satisfies lens, got: ${satLens?.command?.title}`,
    );
    assertEquals(satLens?.command?.command, "markspec.openDefinition");
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp codeLens: returns empty array for non-MarkSpec file", async () => {
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

    const lenses = await client.request("textDocument/codeLens", {
      textDocument: { uri: fileUri },
    }) as CodeLens[];

    assertEquals(lenses, []);
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp codeLens: isolated entry yields no lenses", async () => {
  const md = `- [STK_AEB_0001] Isolated requirement

  Body.

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
    await new Promise((r) => setTimeout(r, 500));

    const lenses = await client.request("textDocument/codeLens", {
      textDocument: { uri: fileUri },
    }) as CodeLens[];

    assertEquals(lenses, []);
  } finally {
    await client.shutdown();
  }
});
