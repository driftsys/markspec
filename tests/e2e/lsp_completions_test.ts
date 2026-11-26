/**
 * @module tests/e2e/lsp_completions_test
 *
 * E2E test: trigger completion at `- [` and `Satisfies:` positions.
 */

import { assert, assertEquals, assertExists } from "@std/assert";
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

Deno.test("lsp completions: ID reference on 'Verifies:'", async () => {
  const md = `- [STK_AEB_0001] First requirement

  Body text.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [SAD_AEB_0001] Architecture item

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Verifies:
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

    // Request completion after "Verifies:" (line 11, char 15).
    // Trace-attribute completion returns a CompletionList so the
    // server can set isIncomplete when a partial prefix narrows
    // the suggestion set (server-side prefix filter).
    const result = await client.request("textDocument/completion", {
      textDocument: { uri: fileUri },
      position: { line: 11, character: 15 },
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

Deno.test("lsp completions: mid-typed prefix '- [STK_' scaffolds with textEdit", async () => {
  // Profile declaring a stakeholder-requirement type with the
  // STK_AEB_{n:04d} display-ID pattern → prefix "STK_AEB_".
  const profileYaml = `id: "@acme/midtyped"
version: 0.1.0
profile:
  types:
    stakeholder-requirement:
      extends: Requirement
      display-id-pattern: "STK_AEB_{n:04d}"
`;
  const md = `# Requirements

- [STK_
`;
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\nversion: 0.1.0\n",
    ".markspec.yaml": "profiles:\n  - ./profiles/midtyped\n",
    "profiles/midtyped/markspec.yaml": profileYaml,
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

    // Give the server time to load the profile and parse.
    await new Promise((r) => setTimeout(r, 500));

    // Cursor at the end of "- [STK_" on line 2 (0-based): char 7.
    // "- [STK_" → `-`=0 ` `=1 `[`=2 `STK_`=3..6, cursor at 7.
    const result = await client.request("textDocument/completion", {
      textDocument: { uri: fileUri },
      position: { line: 2, character: 7 },
    }) as Array<{
      label: string;
      textEdit?: {
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
        newText: string;
      };
    }>;

    assertExists(result);
    const item = result.find((i) =>
      i.label === "New stakeholder-requirement (STK_AEB_0001)"
    );
    assertExists(
      item,
      `Expected mid-typed scaffold for STK_AEB_0001, got: ${
        JSON.stringify(result.map((i) => i.label))
      }`,
    );
    // The textEdit replaces exactly the typed partial "STK_" (chars 3..7)
    // with the full display ID + entry skeleton.
    assertExists(item.textEdit, "Expected a textEdit on the scaffold item");
    assertEquals(item.textEdit.range.start, { line: 2, character: 3 });
    assertEquals(item.textEdit.range.end, { line: 2, character: 7 });
    assert(
      item.textEdit.newText.startsWith("STK_AEB_0001]"),
      `Expected newText to start with the full display ID, got: ${item.textEdit.newText}`,
    );
  } finally {
    await client.shutdown();
  }
});

// ---------------------------------------------------------------------------
// {scope} placeholder (#1038)
// ---------------------------------------------------------------------------

const SCOPED_PROFILE_YAML = `id: "@acme/scoped"
version: 0.1.0
profile:
  types:
    software-requirement:
      extends: Requirement
      display-id-pattern: "SRS_{scope}_{n:04d}"
`;

const SCOPED_ENTRIES_MD = `# Requirements

- [SRS_BRK_0001] Brake request

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [SRS_ENG_0001] Engine request

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;

interface ScopedItem {
  label: string;
  insertText?: string;
  textEdit?: {
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    newText: string;
  };
  data?: unknown;
}

/** Start a client over the scoped profile, open `new.md` with `text`, and
 * return the completion items at `character` on the last line. */
async function scopedCompletion(
  text: string,
  character: number,
  profileYaml = SCOPED_PROFILE_YAML,
  entriesMd = SCOPED_ENTRIES_MD,
): Promise<{ client: LspTestClient; uri: string; items: ScopedItem[] }> {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\nversion: 0.1.0\n",
    ".markspec.yaml": "profiles:\n  - ./profiles/scoped\n",
    "profiles/scoped/markspec.yaml": profileYaml,
    "reqs.md": entriesMd,
    "new.md": text,
  });
  await client.initialize();
  const uri = toFileUrl(join(client.workDir, "new.md")).href;
  await client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "markdown", version: 1, text },
  });
  await new Promise((r) => setTimeout(r, 500));
  const items = await client.request("textDocument/completion", {
    textDocument: { uri },
    position: { line: text.split("\n").length - 1, character },
  }) as ScopedItem[];
  return { client, uri, items };
}

Deno.test("lsp completions: bare '- [' offers each scope in use and a SCOPE template, never {scope} (#1038)", async () => {
  const { client, items } = await scopedCompletion("- [", 3);
  try {
    assertEquals(items.map((i) => i.label), [
      "New software-requirement (SRS_BRK_0002)",
      "New software-requirement (SRS_ENG_0002)",
      "New software-requirement (SRS_SCOPE_NNNN)",
    ]);
    for (const item of items) {
      assert(!JSON.stringify(item).includes("{scope}"), JSON.stringify(item));
    }
    const template = items[2];
    assert(
      template.insertText?.startsWith("SRS_${1:SCOPE}_NNNN] "),
      template.insertText,
    );
    // The template mints and reserves nothing.
    assertEquals(template.data, undefined);

    // Reservations are keyed by the scoped prefix: two accepts in BRK take
    // 0002 and 0003, and an accept in ENG still gets 0002. A reservation
    // shared across scopes would give ENG 0004.
    const resolve = async (item: ScopedItem) =>
      (await client.request("completionItem/resolve", item) as ScopedItem)
        .label;
    assertEquals(
      await resolve(items[0]),
      "New software-requirement (SRS_BRK_0002)",
    );
    assertEquals(
      await resolve(items[0]),
      "New software-requirement (SRS_BRK_0003)",
    );
    assertEquals(
      await resolve(items[1]),
      "New software-requirement (SRS_ENG_0002)",
    );
    const resolvedTemplate = await client.request(
      "completionItem/resolve",
      template,
    ) as ScopedItem;
    assertEquals(resolvedTemplate.insertText, template.insertText);
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp completions: mid-typed '- [SRS_BRK_' offers the next number in scope BRK (#1038)", async () => {
  const { client, items } = await scopedCompletion("- [SRS_BRK_", 11);
  try {
    assertEquals(items.map((i) => i.label), [
      "New software-requirement (SRS_BRK_0002)",
    ]);
    const item = items[0];
    assertExists(item.textEdit);
    assertEquals(item.textEdit.range.start, { line: 0, character: 3 });
    assertEquals(item.textEdit.range.end, { line: 0, character: 11 });
    assert(
      item.textEdit.newText.startsWith("SRS_BRK_0002]"),
      item.textEdit.newText,
    );
    const resolved = await client.request(
      "completionItem/resolve",
      item,
    ) as ScopedItem;
    assertEquals(resolved.label, "New software-requirement (SRS_BRK_0002)");
    assert(
      resolved.textEdit?.newText.startsWith("SRS_BRK_0002]"),
      resolved.textEdit?.newText,
    );
  } finally {
    await client.shutdown();
  }
});

const SCOPE_AFTER_COUNTER_PROFILE_YAML = `id: "@acme/scope-after"
version: 0.1.0
profile:
  types:
    release-requirement:
      extends: Requirement
      display-id-pattern: "R-{n:03d}-{scope}"
`;

Deno.test("lsp completions: {scope} after the counter offers a SCOPE template with no scope in use (#1038)", async () => {
  const { client, items } = await scopedCompletion(
    "- [",
    3,
    SCOPE_AFTER_COUNTER_PROFILE_YAML,
    "# Empty\n",
  );
  try {
    assertEquals(items.map((i) => i.label), [
      "New release-requirement (R-NNN-SCOPE)",
    ]);
    assert(
      items[0].insertText?.startsWith("R-NNN-${1:SCOPE}] ${2:Title}"),
      items[0].insertText,
    );
    assertEquals(items[0].data, undefined);
  } finally {
    await client.shutdown();
  }
});

Deno.test("lsp completions: {scope} after the counter offers the template for a mid-typed partial (#1038)", async () => {
  const { client, items } = await scopedCompletion(
    "- [R-",
    5,
    SCOPE_AFTER_COUNTER_PROFILE_YAML,
    "# Empty\n",
  );
  try {
    assertEquals(items.map((i) => i.label), [
      "New release-requirement (R-NNN-SCOPE)",
    ]);
    assert(
      items[0].textEdit?.newText.startsWith("R-NNN-${1:SCOPE}] "),
      items[0].textEdit?.newText,
    );
  } finally {
    await client.shutdown();
  }
});
