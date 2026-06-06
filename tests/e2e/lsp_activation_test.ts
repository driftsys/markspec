/**
 * @module tests/e2e/lsp_activation_test
 *
 * E2E test: the LSP server is inert in a workspace that is not a MarkSpec
 * project. A MarkSpec project is marked by a `.markspec.yaml` activator
 * (ADR-008). With no `.markspec.yaml` discoverable, the server must not
 * write its `.markspec/` runtime directory (event log) — see issue #609.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return false;
    throw err;
  }
}

Deno.test("lsp activation: no .markspec.yaml → no .markspec/ artifacts written", async () => {
  const client = await LspTestClient.create({ "README.md": "# Plain repo\n" });
  try {
    await client.initialize();
    // Give the server time to index and attempt any default log write.
    await new Promise((r) => setTimeout(r, 300));
    const markspecDir = join(client.workDir, ".markspec");
    assertEquals(
      await exists(markspecDir),
      false,
      "server must not create .markspec/ in a workspace with no .markspec.yaml",
    );
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp activation: .markspec.yaml present → event log written under .markspec/", async () => {
  const client = await LspTestClient.create({
    ".markspec.yaml": "profiles: []\n",
    "doc.md": "# Doc\n",
  });
  try {
    await client.initialize();
    await new Promise((r) => setTimeout(r, 300));
    const logPath = join(client.workDir, ".markspec", "lsp.log");
    assert(
      await exists(logPath),
      "server must write .markspec/lsp.log when .markspec.yaml is present",
    );
  } finally {
    await client.shutdown();
  }
});
