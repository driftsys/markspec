// tests/e2e/lsp_document_link_test.ts

/**
 * @module tests/e2e/lsp_document_link_test
 *
 * E2E test for `textDocument/documentLink` — drives the LSP via
 * JSON-RPC and verifies link emission for `Verified-by:` file-path
 * values per spec §5.3.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

interface DocumentLink {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  target: string;
}

Deno.test("lsp documentLink: path-only Verified-by value produces a link", async () => {
  const md = `- [STK_AEB_0001] Requirement with file-path Verified-by

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Verified-by: tests/sit_bar.rs
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

    const links = await client.request("textDocument/documentLink", {
      textDocument: { uri: fileUri },
    }) as DocumentLink[];

    assertExists(links);
    assertEquals(links.length, 1);
    const expectedTarget =
      toFileUrl(join(client.workDir, "tests/sit_bar.rs")).href;
    assertEquals(links[0].target, expectedTarget);
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp documentLink: numeric :line suffix produces #L fragment", async () => {
  const md = `- [STK_AEB_0001] Requirement with line-suffixed Verified-by

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Verified-by: src/foo.rs:42
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

    const links = await client.request("textDocument/documentLink", {
      textDocument: { uri: fileUri },
    }) as DocumentLink[];

    assertEquals(links.length, 1);
    const expectedBase = toFileUrl(join(client.workDir, "src/foo.rs")).href;
    assertEquals(links[0].target, `${expectedBase}#L42`);
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp documentLink: display-ID Verified-by value is not linkified", async () => {
  const md = `- [STK_AEB_0001] Target

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [STK_AEB_0002] Verifies via display ID

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Verified-by: STK_AEB_0001
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

    const links = await client.request("textDocument/documentLink", {
      textDocument: { uri: fileUri },
    }) as DocumentLink[];

    assertEquals(links, []);
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp documentLink: returns empty array for non-MarkSpec file", async () => {
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

    const links = await client.request("textDocument/documentLink", {
      textDocument: { uri: fileUri },
    }) as DocumentLink[];

    assertEquals(links, []);
  } finally {
    await client.shutdown();
  }
});
