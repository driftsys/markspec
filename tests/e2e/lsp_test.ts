/**
 * @module tests/e2e/lsp_test
 *
 * E2E tests for the LSP server's real-time diagnostic and document-sync
 * behaviour. Uses the shared LspTestClient helper.
 *
 * Tests:
 *   1. textDocument/didOpen → publishDiagnostics for entry missing Id
 *   2. textDocument/didChange fixes the missing-Id → diagnostics cleared
 *   3. Cross-file validation: removing a Reference entry in B yields an
 *      unresolved-citation diagnostic in A
 *   4. textDocument/didClose → diagnostics cleared for that file
 */

import { assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * A minimal Markdown file with a missing Id attribute — produces an
 * immediate parse-level diagnostic (MSL-R003) without needing cross-file
 * validation or any debounce delay.
 */
const MISSING_ID_MD = `- [SWE_001] Software requirement

  Body text.
`;

/**
 * A fixed version of the same file that includes a valid ULID Id attribute.
 * The ULID below is deliberately all-uppercase and valid for parsing.
 */
const FIXED_MD = `- [SWE_001] Software requirement

  Body text.

      Id: 01JQZAP1XXXXXXXXXXXXXXXXXX
`;

/**
 * File A that cites a Reference-shape entry (slug: tech-ref) declared in B.
 * Uses the References: attribute — core validates that the slug resolves.
 */
const FILE_A_MD = `- [SWE_001] Software requirement

  Body text.

      Id: 01JQZAP1XXXXXXXXXXXXXXXXXX
      References: tech-ref
`;

/**
 * File B that declares the Reference-shape entry cited by A.
 * Reference-shape entries have a URI Id (scheme-qualified).
 */
const FILE_B_MD = `- [tech-ref] A referenced document

  Abstract.

      Id: https://example.com/tech-ref
`;

/** File B with the Reference entry removed — breaks A's References: citation. */
const FILE_B_EMPTY_MD = `# References

No entries here.
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LspDiagnostic {
  code?: string;
  message: string;
  severity?: number;
}

interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: LspDiagnostic[];
}

/**
 * Wait until a publishDiagnostics notification arrives for `uri` with
 * at least one diagnostic. Drains notifications until the timeout, so
 * intermediate "empty" publishes are skipped in favour of the actual
 * error notification.
 */
async function waitForNonEmptyDiagnosticsFor(
  client: LspTestClient,
  uri: string,
  timeoutMs = 8000,
): Promise<LspDiagnostic[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) break;
    let notification: { params?: unknown } | null = null;
    try {
      notification = await client.waitForNotification(
        "textDocument/publishDiagnostics",
        Math.min(remaining, 1500),
      );
    } catch {
      continue; // slice timed out — keep draining until outer timeoutMs
    }
    if (!notification?.params) continue;
    const params = notification.params as PublishDiagnosticsParams;
    if (params.uri === uri && params.diagnostics.length > 0) {
      return params.diagnostics;
    }
  }
  return [];
}

/**
 * Wait until a publishDiagnostics notification arrives for `uri` with
 * zero diagnostics (the "cleared" state). Drains non-matching notifications.
 */
async function waitForEmptyDiagnosticsFor(
  client: LspTestClient,
  uri: string,
  timeoutMs = 8000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) break;
    let notification: { params?: unknown } | null = null;
    try {
      notification = await client.waitForNotification(
        "textDocument/publishDiagnostics",
        Math.min(remaining, 1500),
      );
    } catch {
      continue; // slice timed out — keep draining until outer timeoutMs
    }
    if (!notification?.params) continue;
    const params = notification.params as PublishDiagnosticsParams;
    if (params.uri === uri && params.diagnostics.length === 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Test 1: Document open with missing Id → diagnostic published
// ---------------------------------------------------------------------------

Deno.test(
  "lsp: textDocument/didOpen with missing Id → publishDiagnostics",
  async () => {
    const client = await LspTestClient.create({
      "project.yaml": "name: test-project\n",
      "reqs.md": MISSING_ID_MD,
    });
    try {
      await client.initialize();

      const fileUri = toFileUrl(join(client.workDir, "reqs.md")).href;
      await client.notify("textDocument/didOpen", {
        textDocument: {
          uri: fileUri,
          languageId: "markdown",
          version: 1,
          text: MISSING_ID_MD,
        },
      });

      // Drain notifications until we see the error diagnostic.
      const diags = await waitForNonEmptyDiagnosticsFor(
        client,
        fileUri,
        8000,
      );

      // At least one diagnostic must be present for the missing Id
      assertEquals(
        diags.length > 0,
        true,
        `Expected missing-Id diagnostic, got: ${JSON.stringify(diags)}`,
      );
    } finally {
      await client.shutdown();
    }
  },
);

// ---------------------------------------------------------------------------
// Test 2: Document change fixes missing Id → diagnostics cleared
// ---------------------------------------------------------------------------

Deno.test(
  "lsp: textDocument/didChange fixes missing Id → diagnostics empty",
  async () => {
    const client = await LspTestClient.create({
      "project.yaml": "name: test-project\n",
      "reqs.md": MISSING_ID_MD,
    });
    try {
      await client.initialize();

      const fileUri = toFileUrl(join(client.workDir, "reqs.md")).href;

      // Open the file with the missing Id attribute
      await client.notify("textDocument/didOpen", {
        textDocument: {
          uri: fileUri,
          languageId: "markdown",
          version: 1,
          text: MISSING_ID_MD,
        },
      });

      // Drain notifications until we see the error diagnostic
      const initialDiags = await waitForNonEmptyDiagnosticsFor(
        client,
        fileUri,
        8000,
      );
      assertEquals(
        initialDiags.length > 0,
        true,
        "Expected initial missing-Id diagnostic",
      );

      // Fix the document by adding a valid Id attribute
      await client.notify("textDocument/didChange", {
        textDocument: { uri: fileUri, version: 2 },
        contentChanges: [{ text: FIXED_MD }],
      });

      // Wait for updated diagnostics (debounce: 50ms parse + 1000ms cross-file)
      const cleared = await waitForEmptyDiagnosticsFor(client, fileUri, 5000);
      assertEquals(
        cleared,
        true,
        "Expected empty diagnostics for reqs.md after fix",
      );
    } finally {
      await client.shutdown();
    }
  },
);

// ---------------------------------------------------------------------------
// Test 3: Cross-file — removing a Reference entry in B breaks citation in A
// ---------------------------------------------------------------------------

Deno.test(
  "lsp: cross-file — removing Reference entry in B produces unresolved-citation diagnostic in A",
  async () => {
    const client = await LspTestClient.create({
      "project.yaml": "name: test-project\n",
      "a.md": FILE_A_MD,
      "b.md": FILE_B_MD,
    });
    try {
      await client.initialize();
      // Give the initial indexing time to settle (includes cross-file validation)
      await new Promise((r) => setTimeout(r, 1500));

      const aUri = toFileUrl(join(client.workDir, "a.md")).href;
      const bUri = toFileUrl(join(client.workDir, "b.md")).href;

      // Open both files so the LSP tracks them
      await client.notify("textDocument/didOpen", {
        textDocument: {
          uri: aUri,
          languageId: "markdown",
          version: 1,
          text: FILE_A_MD,
        },
      });
      await client.notify("textDocument/didOpen", {
        textDocument: {
          uri: bUri,
          languageId: "markdown",
          version: 1,
          text: FILE_B_MD,
        },
      });

      // Wait for initial diagnostics to settle (should be clean)
      await new Promise((r) => setTimeout(r, 1500));

      // Now remove tech-ref from file B
      await client.notify("textDocument/didChange", {
        textDocument: { uri: bUri, version: 2 },
        contentChanges: [{ text: FILE_B_EMPTY_MD }],
      });

      // Wait for cross-file validation to re-run (debounce: 50ms + 1000ms) and
      // produce an unresolved-citation diagnostic for a.md.
      const diags = await waitForNonEmptyDiagnosticsFor(client, aUri, 6000);

      assertEquals(
        diags.length > 0,
        true,
        `Expected unresolved-citation diagnostic for a.md after removing tech-ref from b.md, got: ${
          JSON.stringify(diags)
        }`,
      );
    } finally {
      await client.shutdown();
    }
  },
);

// ---------------------------------------------------------------------------
// Test 4: Document close → diagnostics cleared for that file
// ---------------------------------------------------------------------------

Deno.test(
  "lsp: textDocument/didClose → diagnostics cleared (empty array published)",
  async () => {
    const client = await LspTestClient.create({
      "project.yaml": "name: test-project\n",
      "reqs.md": MISSING_ID_MD,
    });
    try {
      await client.initialize();

      const fileUri = toFileUrl(join(client.workDir, "reqs.md")).href;

      // Open file with missing Id → wait for the error diagnostic
      await client.notify("textDocument/didOpen", {
        textDocument: {
          uri: fileUri,
          languageId: "markdown",
          version: 1,
          text: MISSING_ID_MD,
        },
      });

      const diags = await waitForNonEmptyDiagnosticsFor(client, fileUri, 8000);
      assertEquals(
        diags.length > 0,
        true,
        "Expected initial missing-Id diagnostic before close",
      );

      // Close the document — the server should immediately publish empty diags
      await client.notify("textDocument/didClose", {
        textDocument: { uri: fileUri },
      });

      // Await the empty-diagnostics notification for the closed file
      const cleared = await waitForEmptyDiagnosticsFor(client, fileUri, 5000);
      assertEquals(
        cleared,
        true,
        "Expected empty diagnostics notification for reqs.md after close",
      );
    } finally {
      await client.shutdown();
    }
  },
);
