/**
 * @module tests/e2e/lsp_lifecycle_test
 *
 * E2E test: LSP server initialize → shutdown → exit lifecycle.
 */

import { assertEquals, assertExists } from "@std/assert";
import { LspTestClient } from "./lsp_helpers.ts";

Deno.test("lsp lifecycle: initialize returns capabilities", async () => {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
  });
  try {
    const result = await client.initialize() as Record<string, unknown>;
    assertExists(result);
    const capabilities = result.capabilities as Record<string, unknown>;
    assertExists(capabilities);
    // Verify text document sync
    assertEquals(capabilities.textDocumentSync, 1); // Full
    // Verify completion provider
    const completion = capabilities.completionProvider as Record<
      string,
      unknown
    >;
    assertExists(completion);
    assertEquals(completion.triggerCharacters, ["[", ":"]);
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp lifecycle: shutdown completes without error", async () => {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
  });
  const result = await client.initialize();
  assertExists(result);
  // Shutdown should not throw
  await client.shutdown();
});
