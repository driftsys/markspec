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

Deno.test("lsp traceability: closing the buffer of a target file keeps links to it resolved", async () => {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\nversion: 0.1.0\n",
    ".markspec.yaml": "profiles:\n  - ./profiles/p\n",
    "profiles/p/markspec.yaml": PROFILE_YAML,
    "reqs.md": MD.replace("REQ-0099", "REQ-0001"),
    "target.md": `- [REQ-0001] A requirement

  Body text.

      Id: 01REQ000000000000000000001
      Type: requirement
`,
  });
  try {
    await client.initialize();
    const reqsUri = toFileUrl(join(client.workDir, "reqs.md")).href;
    const targetUri = toFileUrl(join(client.workDir, "target.md")).href;
    for (const name of ["reqs.md", "target.md"]) {
      const uri = toFileUrl(join(client.workDir, name)).href;
      await client.notify("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: "markdown",
          version: 1,
          text: Deno.readTextFileSync(join(client.workDir, name)),
        },
      });
    }
    await client.waitUntil(
      () => client.latestPublishIsCrossFile(reqsUri),
      "first cross-file diagnostics for reqs.md",
      10000,
    );
    const l006Count = (): number =>
      (client.latestDiagnosticsFor(reqsUri) ?? []).filter((d) =>
        d.code === "MSL-L006"
      ).length;
    // Edit the target buffer so its id disappears: the link breaks.
    await client.notify("textDocument/didChange", {
      textDocument: { uri: targetUri, version: 2 },
      contentChanges: [{
        text: Deno.readTextFileSync(join(client.workDir, "target.md"))
          .replace("REQ-0001", "REQ-0002"),
      }],
    });
    await client.waitUntil(
      () => client.latestPublishIsCrossFile(reqsUri) && l006Count() === 1,
      "MSL-L006 for reqs.md after the target buffer changed",
      10000,
    );
    // The close parses the file from disk again and schedules a validation
    // run: the link resolves again.
    await client.notify("textDocument/didClose", {
      textDocument: { uri: targetUri },
    });
    await client.waitUntil(
      () => client.latestPublishIsCrossFile(reqsUri) && l006Count() === 0,
      "no MSL-L006 for reqs.md after the close",
      10000,
    );
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp traceability: closing the buffer of a file created after startup keeps links to it resolved (#955)", async () => {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\nversion: 0.1.0\n",
    ".markspec.yaml": "profiles:\n  - ./profiles/p\n",
    "profiles/p/markspec.yaml": PROFILE_YAML,
    "reqs.md": MD.replace("REQ-0099", "REQ-0001"),
  });
  try {
    await client.initialize();
    const reqsUri = toFileUrl(join(client.workDir, "reqs.md")).href;
    const newPath = join(client.workDir, "created.md");
    const newUri = toFileUrl(newPath).href;
    const text = `- [REQ-0001] A requirement

  Body text.

      Id: 01REQ000000000000000000001
      Type: requirement
`;
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: reqsUri,
        languageId: "markdown",
        version: 1,
        text: Deno.readTextFileSync(join(client.workDir, "reqs.md")),
      },
    });
    // The new file is created in the editor after startup: it is not on disk
    // yet, so the startup walk did not index it.
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: newUri,
        languageId: "markdown",
        version: 1,
        text,
      },
    });
    const l006Count = (): number =>
      (client.latestDiagnosticsFor(reqsUri) ?? []).filter((d) =>
        d.code === "MSL-L006"
      ).length;
    await client.waitUntil(
      () => client.latestPublishIsCrossFile(reqsUri) && l006Count() === 0,
      "no MSL-L006 for reqs.md while the new buffer is open",
      10000,
    );
    // Save, then close.
    Deno.writeTextFileSync(newPath, text);
    const before = client.publishCountFor(reqsUri);
    await client.notify("textDocument/didClose", {
      textDocument: { uri: newUri },
    });
    await client.waitUntil(
      () => client.publishCountFor(reqsUri) > before,
      "a validation run for reqs.md after the close",
      10000,
    );
    assertEquals(l006Count(), 0);
  } finally {
    await client.shutdown();
  }
});
