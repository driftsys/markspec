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

Deno.test("lsp lifecycle: server stays alive past watchdog interval (regression for 2026-05-02 bug)", async () => {
  // The vscode-languageserver framework runs a parent-process watchdog every
  // 3 seconds. It calls process.kill(parentPid, 0) — which requires
  // --allow-run in Deno. If --allow-run is missing OR processId is null, the
  // test won't catch the bug. Both conditions matter.
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
  });
  try {
    await client.initialize({ processId: Deno.pid });
    // Wait past the 3-second watchdog window.
    await new Promise((r) => setTimeout(r, 5000));
    // Server should still be responsive — issue an arbitrary request.
    const result = await client.request("shutdown", null);
    assertEquals(result, null);
  } finally {
    await client.shutdown();
  }
});
