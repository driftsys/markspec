// tests/e2e/lsp_document_link_test.ts

/**
 * @module tests/e2e/lsp_document_link_test
 *
 * E2E test for `textDocument/documentLink` — drives the LSP via
 * JSON-RPC and verifies link emission for `Source:` values.
 */

import { assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

interface DocumentLink {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  target: string;
}

const entry = (sourceLine: string) =>
  `- [STK_AEB_0001] Requirement with a source

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      ${sourceLine}
`;

/** Open `reqs.md` in a project with the given extra files and ask for links. */
async function linksFor(
  md: string,
  extraFiles: Record<string, string> = {},
): Promise<{ links: DocumentLink[]; workDir: string }> {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    "reqs.md": md,
    ...extraFiles,
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
    return { links, workDir: client.workDir };
  } finally {
    await client.shutdown();
  }
}

Deno.test("lsp documentLink: existing relative Source path produces a link", async () => {
  const { links, workDir } = await linksFor(entry("Source: src/foo.rs"), {
    "src/foo.rs": "// code\n",
  });
  assertEquals(links.length, 1);
  assertEquals(links[0].target, toFileUrl(join(workDir, "src/foo.rs")).href);
});

Deno.test("lsp documentLink: numeric :line suffix produces #L fragment", async () => {
  const { links, workDir } = await linksFor(entry("Source: src/foo.rs:42"), {
    "src/foo.rs": "// code\n",
  });
  assertEquals(links.length, 1);
  assertEquals(
    links[0].target,
    `${toFileUrl(join(workDir, "src/foo.rs")).href}#L42`,
  );
});

Deno.test("lsp documentLink: missing Source file produces no link", async () => {
  const { links } = await linksFor(entry("Source: src/missing.rs"));
  assertEquals(links, []);
});

Deno.test("lsp documentLink: http(s) Source URI is linked as is", async () => {
  const { links } = await linksFor(entry("Source: https://example.com/a.html"));
  assertEquals(links.length, 1);
  assertEquals(links[0].target, "https://example.com/a.html");
});

Deno.test("lsp documentLink: display-ID Source value produces no link", async () => {
  const { links } = await linksFor(entry("Source: STK_AEB_0002"));
  assertEquals(links, []);
});

Deno.test("lsp documentLink: Verified-by value produces no link", async () => {
  const { links } = await linksFor(entry("Verified-by: src/foo.rs"), {
    "src/foo.rs": "// code\n",
  });
  assertEquals(links, []);
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
