/**
 * @module tests/e2e/lsp_diagnostics_test
 *
 * E2E test: open a file with validation errors → receive publishDiagnostics.
 */

import { assertEquals, assertExists } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

Deno.test("lsp diagnostics: missing Id attribute reported", async () => {
  const md = `- [STK_AEB_0001] Test requirement

  This is a test.
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

    // Wait for diagnostics (file-local or cross-file)
    const notification = await client.waitForNotification(
      "textDocument/publishDiagnostics",
      10000,
    );
    assertExists(notification.params);
    const params = notification.params as {
      uri: string;
      diagnostics: Array<{ code?: string; message: string }>;
    };

    // Should have at least one diagnostic (missing Id)
    assertEquals(
      params.diagnostics.length > 0,
      true,
      `Expected diagnostics, got: ${JSON.stringify(params.diagnostics)}`,
    );
  } finally {
    await client.shutdown();
  }
});
