/**
 * @module tests/e2e/lsp_completions_test
 *
 * E2E test: trigger completion at `- [` and `Satisfies:` positions.
 */

import { assert, assertExists } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

Deno.test("lsp completions: block scaffold on '- ['", async () => {
  const md = `# Requirements

- [
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

    // Request completion at the `[` position (line 2, char 3)
    const result = await client.request("textDocument/completion", {
      textDocument: { uri: fileUri },
      position: { line: 2, character: 3 },
    }) as Array<{ label: string }>;

    assertExists(result);
    assert(result.length > 0, "Expected at least one completion item");
    // Without a profile, should get generic "New entry"
    assert(
      result.some((item) => item.label === "New entry"),
      `Expected "New entry" item, got: ${
        JSON.stringify(result.map((i) => i.label))
      }`,
    );
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp completions: ID reference on 'Satisfies:'", async () => {
  const md = `- [STK_AEB_0001] First requirement

  Body text.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [SAD_AEB_0001] Architecture item

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Satisfies:
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

    // Give server time to parse and index
    await new Promise((r) => setTimeout(r, 500));

    // Request completion after "Satisfies:" (line 11, char 16).
    // Trace-attribute completion returns a CompletionList so the
    // server can set isIncomplete when a partial prefix narrows
    // the suggestion set (server-side prefix filter).
    const result = await client.request("textDocument/completion", {
      textDocument: { uri: fileUri },
      position: { line: 11, character: 16 },
    }) as { isIncomplete: boolean; items: Array<{ label: string }> };

    assertExists(result);
    assertExists(result.items);
    assert(result.items.length > 0, "Expected at least one completion item");
    assert(
      result.items.some((item) => item.label === "STK_AEB_0001"),
      `Expected STK_AEB_0001 in completions, got: ${
        JSON.stringify(result.items.map((i) => i.label))
      }`,
    );
    // No partial after the colon → list is not incomplete.
    assert(
      !result.isIncomplete,
      "Empty partial should produce a complete list",
    );
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp completions: server-side prefix filter on 'Satisfies: STK_'", async () => {
  const md = `- [STK_AEB_0001] Stakeholder requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [SAD_AEB_0001] Architecture item

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG

- [SAD_AEB_0002] Another architecture item

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
      Satisfies: STK_
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

    await new Promise((r) => setTimeout(r, 500));

    // Cursor sits at the end of `      Satisfies: STK_` on line 17
    // (0-based). character = 6 indent + "Satisfies: STK_".length = 21.
    const result = await client.request("textDocument/completion", {
      textDocument: { uri: fileUri },
      position: { line: 17, character: 21 },
    }) as { isIncomplete: boolean; items: Array<{ label: string }> };

    assertExists(result);
    assertExists(result.items);
    const labels = result.items.map((i) => i.label);
    // Only STK_-prefixed IDs survive the server-side filter.
    assert(
      labels.every((label) => label.startsWith("STK_")),
      `Expected only STK_-prefixed labels, got: ${JSON.stringify(labels)}`,
    );
    assert(
      labels.includes("STK_AEB_0001"),
      `Expected STK_AEB_0001 in results, got: ${JSON.stringify(labels)}`,
    );
    // SAD_ items are excluded.
    assert(
      !labels.includes("SAD_AEB_0001") && !labels.includes("SAD_AEB_0002"),
      `Expected SAD_AEB_* to be filtered out, got: ${JSON.stringify(labels)}`,
    );
    // Partial typed → list is marked incomplete so the client re-queries
    // as the prefix grows or shrinks.
    assert(
      result.isIncomplete,
      "Non-empty partial should produce an incomplete list",
    );
  } finally {
    await client.shutdown();
  }
});
