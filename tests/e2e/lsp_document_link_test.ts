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
  options: { docPath?: string; waitIndexed?: boolean; baseFiles?: boolean } =
    {},
): Promise<{ links: DocumentLink[]; workDir: string }> {
  const docPath = options.docPath ?? "reqs.md";
  const client = await LspTestClient.create({
    ...(options.baseFiles === false
      ? {}
      : { "project.yaml": "name: test-project\n" }),
    [docPath]: md,
    ...extraFiles,
  });
  try {
    await client.initialize();
    if (options.waitIndexed) {
      await client.waitForNotification("markspec/indexed", 15000);
    }
    const fileUri = toFileUrl(join(client.workDir, ...docPath.split("/"))).href;
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

Deno.test("lsp documentLink: a relative Source resolves against the nested project's root", async () => {
  // The workspace root holds two projects. The document is in a subfolder
  // of project `a`; the same relative path exists at several other places,
  // and only `a/src/foo.rs` is the project-root match.
  const { links, workDir } = await linksFor(
    entry("Source: src/foo.rs"),
    {
      ".markspec.yaml": "profiles: []\n",
      "a/.markspec.yaml": "profiles: []\n",
      "b/.markspec.yaml": "profiles: []\n",
      "src/foo.rs": "// workspace root\n",
      "a/src/foo.rs": "// project a\n",
      "a/docs/src/foo.rs": "// document folder\n",
      "b/src/foo.rs": "// project b\n",
    },
    { docPath: "a/docs/reqs.md", waitIndexed: true, baseFiles: false },
  );
  assertEquals(links.length, 1);
  assertEquals(links[0].target, toFileUrl(join(workDir, "a/src/foo.rs")).href);
});

Deno.test("lsp documentLink: an absolute Source path is linked as is", async () => {
  const abs = await Deno.makeTempFile({ suffix: ".rs" });
  try {
    const { links } = await linksFor(entry(`Source: ${abs}:3`));
    assertEquals(links.length, 1);
    assertEquals(links[0].target, `${toFileUrl(abs).href}#L3`);
  } finally {
    await Deno.remove(abs);
  }
});

Deno.test("lsp documentLink: a Source naming an existing directory produces no link", async () => {
  const { links } = await linksFor(entry("Source: src"), {
    "src/foo.rs": "// code\n",
  });
  assertEquals(links, []);
});

// A `.json` file is never indexed, so this test passes whatever the
// `isMarkspecFile` guard in the handler does: the guard is defence in depth.
// The test pins only that a file outside the index gets no links.
Deno.test("lsp documentLink: a file outside the index gets no links", async () => {
  const text = entry("Source: src/foo.rs");
  const { links } = await linksFor(text, { "src/foo.rs": "// code\n" }, {
    docPath: "data.json",
  });
  assertEquals(links, []);
});
