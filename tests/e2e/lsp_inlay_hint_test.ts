// tests/e2e/lsp_inlay_hint_test.ts

/**
 * @module tests/e2e/lsp_inlay_hint_test
 *
 * E2E test for `textDocument/inlayHint` — drives the LSP via JSON-RPC
 * and verifies hint emission for the two kinds defined by spec §5.2.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

interface InlayHint {
  position: { line: number; character: number };
  label: string;
  kind?: number;
  paddingLeft?: boolean;
  paddingRight?: boolean;
}

Deno.test("lsp inlayHint: dependents hint appears for referenced entry", async () => {
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
    await new Promise((r) => setTimeout(r, 500));

    const hints = await client.request("textDocument/inlayHint", {
      textDocument: { uri: fileUri },
      range: {
        start: { line: 0, character: 0 },
        end: { line: 100, character: 0 },
      },
    }) as InlayHint[];

    assertExists(hints);
    const depHint = hints.find((h) =>
      h.label.startsWith("(") && h.label.includes("dependent")
    );
    assert(
      depHint !== undefined,
      `Expected a dependents hint, got: ${
        JSON.stringify(hints.map((h) => h.label))
      }`,
    );
    assertEquals(depHint?.label, "(1 dependent)");
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp inlayHint: returns empty array for non-MarkSpec file", async () => {
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

    const hints = await client.request("textDocument/inlayHint", {
      textDocument: { uri: fileUri },
      range: {
        start: { line: 0, character: 0 },
        end: { line: 100, character: 0 },
      },
    }) as InlayHint[];

    assertEquals(hints, []);
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp inlayHint: isolated entry yields no hints", async () => {
  // Single entry, no Satisfies refs, default-profile opted out → no
  // type inference, no dependents.
  const md = `- [STK_AEB_0001] Isolated requirement

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    ".markspec.yaml": "default-profile: false\nprofiles: []\n",
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

    const hints = await client.request("textDocument/inlayHint", {
      textDocument: { uri: fileUri },
      range: {
        start: { line: 0, character: 0 },
        end: { line: 100, character: 0 },
      },
    }) as InlayHint[];

    assertEquals(hints, []);
  } finally {
    await client.shutdown();
  }
});
