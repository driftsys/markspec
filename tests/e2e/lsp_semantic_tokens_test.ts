/**
 * @module tests/e2e/lsp_semantic_tokens_test
 *
 * E2E: spawn the LSP server, open a Markdown file containing an
 * entry, request `textDocument/semanticTokens/full`, and assert the
 * encoded response carries the expected token count.
 *
 * Full structural assertions live in the unit test
 * (`packages/markspec/lsp/semantic_tokens_test.ts`); this test
 * verifies the wire integration.
 */

import { assertEquals } from "@std/assert";
import { LspTestClient } from "./lsp_helpers.ts";

Deno.test("LSP: semanticTokens/full returns encoded tokens", async () => {
  const fixture = [
    "# Doc",
    "",
    "- [REQ-001] Brake response time",
    "",
    "  Body.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "      Satisfies: STK-001",
    "      Labels: ASIL-B",
    "",
  ].join("\n");

  const client = await LspTestClient.create({
    "doc.md": fixture,
  });

  try {
    const init = await client.initialize() as {
      capabilities: { semanticTokensProvider?: unknown };
    };
    assertEquals(typeof init.capabilities.semanticTokensProvider, "object");

    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: `file://${client.workDir}/doc.md`,
        languageId: "markdown",
        version: 1,
        text: fixture,
      },
    });

    // Give the server time to parse and index.
    await new Promise((r) => setTimeout(r, 300));

    const result = await client.request("textDocument/semanticTokens/full", {
      textDocument: { uri: `file://${client.workDir}/doc.md` },
    }) as { data: number[] };

    // Each token is 5 numbers; we expect at least:
    //   title line: enum (display ID) + class (title)            → 2
    //   Id line: property (key) + string (value)                  → 2
    //   Satisfies line: property (key) + enumMember (STK-001)     → 2
    //   Labels line: property (key) + enumMember (ASIL-B)         → 2
    // Total: 8 tokens × 5 ints = 40 entries.
    assertEquals(result.data.length, 40);
  } finally {
    await client.shutdown();
  }
});
