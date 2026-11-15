/**
 * @module tests/e2e/lsp_traceability_test
 *
 * E2E test: the language server publishes the traceability diagnostics of the
 * core pipeline (#938), the same as bare `markspec check`.
 */

import { assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

type Diag = { code?: string; message: string };

const PROFILE_YAML = `id: "@acme/lsp-trace"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
    system-requirement:
      extends: Requirement
      display-id-pattern: "SREQ-{n:04d}"
      traceability:
        Satisfies:
          target: [requirement]
          cardinality: 0..3
          required: false
`;

const MD = `- [SREQ-0001] A system requirement

  Body text.

      Id: 01SREQ00000000000000000001
      Type: system-requirement
      Satisfies: REQ-0099
`;

Deno.test("lsp traceability: a Satisfies target that does not exist is reported as MSL-L006", async () => {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\nversion: 0.1.0\n",
    ".markspec.yaml": "profiles:\n  - ./profiles/p\n",
    "profiles/p/markspec.yaml": PROFILE_YAML,
  });
  try {
    await client.initialize();
    const uri = toFileUrl(join(client.workDir, "reqs.md")).href;
    await client.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "markdown", version: 1, text: MD },
    });
    await client.waitUntil(
      () => client.latestPublishIsCrossFile(uri),
      "cross-file diagnostics for reqs.md",
      10000,
    );
    const diags = client.latestDiagnosticsFor(uri) as Diag[];
    assertEquals(
      diags.filter((d) => d.code === "MSL-L006").length,
      1,
      `got: ${JSON.stringify(diags)}`,
    );
  } finally {
    await client.shutdown();
  }
});
