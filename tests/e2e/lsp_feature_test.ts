/**
 * @module tests/e2e/lsp_feature_test
 *
 * E2E tests: `.feature` buffers (ADR-038 Case B) publish diagnostics through
 * the LSP server like any other MarkSpec file.
 */

import { assertEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { LspTestClient } from "./lsp_helpers.ts";

type Diag = {
  code?: string;
  message: string;
  range?: { start: { line: number } };
};

/** Open `text` as `name` in a fresh project and return the diagnostics of
 * the latest publish for that file. Waits for the parse-stage publish and
 * then for the debounced cross-file publish (1 s debounce), so the result
 * is the settled state. */
async function openFeature(name: string, text: string): Promise<Diag[]> {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
  });
  try {
    await client.initialize();
    const uri = toFileUrl(join(client.workDir, name)).href;
    await client.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "feature", version: 1, text },
    });
    await client.waitUntil(
      () => client.latestDiagnosticsFor(uri) !== undefined,
      `diagnostics for ${name}`,
      10000,
    );
    const afterParse = client.publishCountFor(uri);
    await client.waitUntil(
      () => client.publishCountFor(uri) > afterParse,
      `cross-file publish for ${name}`,
      10000,
    );
    return client.latestDiagnosticsFor(uri) as Diag[];
  } finally {
    await client.shutdown();
  }
}

const HEADER = "# [TST_0001] Login";
// `Feature` without a colon does not parse. (`Feature:\n  Given\n  Scenario`
// does parse: the parser reads those lines as a description.)
const UNPARSABLE = "Feature F\n  Scenario: S\n    Given a\n";

Deno.test("lsp feature: header above a Background publishes MSL-B069", async () => {
  const text =
    `Feature: F\n  ${HEADER}\n  Background:\n    Given a\n  Scenario: S\n    Given b\n`;
  const diags = await openFeature("a.feature", text);
  assertEquals(diags.filter((d) => d.code === "MSL-B069").length, 1);
});

Deno.test("lsp feature: headed file that does not parse publishes MSL-B062", async () => {
  const text = `${HEADER}\n${UNPARSABLE}`;
  const diags = await openFeature("b.feature", text);
  assertEquals(diags.map((d) => d.code), ["MSL-B062"]);
});

Deno.test("lsp feature: headerless file that parses publishes no diagnostics", async () => {
  const text = `Feature: F\n  Scenario: S\n    Given a\n`;
  assertEquals(await openFeature("c.feature", text), []);
});

Deno.test("lsp feature: headerless file that does not parse publishes no diagnostics", async () => {
  const text = UNPARSABLE;
  assertEquals(await openFeature("d.feature", text), []);
});

const MD_REQ = [
  "- [REQ_0001] Login",
  "",
  "  The system shall log in a user.",
  "",
  "      Verified-by: TST_0001",
  "",
].join("\n");
const FEATURE_NAV = [
  "# [TST_0001] Valid login",
  "#",
  "# The login shall succeed.",
  "#",
  "# Satisfies: REQ_0001",
  "Feature: Login",
  "",
  "  # [TST_0002] Inner",
  "  Scenario: Valid",
  "    Given a user REQ_0001",
  "    Then ok",
  "",
].join("\n");

/** Open both files in a project and wait for the index to cover them. */
async function withNavProject(
  run: (
    client: LspTestClient,
    mdUri: string,
    featureUri: string,
  ) => Promise<void>,
): Promise<void> {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    "req.md": MD_REQ,
    "login.feature": FEATURE_NAV,
  });
  try {
    await client.initialize();
    // Wait for the startup index, which covers req.md and login.feature.
    await client.waitForNotification("markspec/indexed", 15000);
    const mdUri = toFileUrl(join(client.workDir, "req.md")).href;
    const featureUri = toFileUrl(join(client.workDir, "login.feature")).href;
    for (
      const [uri, text, languageId] of [
        [mdUri, MD_REQ, "markdown"],
        [featureUri, FEATURE_NAV, "feature"],
      ]
    ) {
      await client.notify("textDocument/didOpen", {
        textDocument: { uri, languageId, version: 1, text },
      });
    }
    await client.waitUntil(
      () => client.latestDiagnosticsFor(featureUri) !== undefined,
      "feature diagnostics",
      10000,
    );
    await run(client, mdUri, featureUri);
  } finally {
    await client.shutdown();
  }
}

type Loc = {
  uri: string;
  range: { start: { line: number; character: number } };
};

Deno.test("lsp feature: document symbols list the Feature and nested Scenario headers", async () => {
  await withNavProject(async (client, _md, featureUri) => {
    const symbols = await client.request("textDocument/documentSymbol", {
      textDocument: { uri: featureUri },
    }) as Array<{ name: string }>;
    assertEquals(symbols.map((s) => s.name), ["TST_0001", "TST_0002"]);
  });
});

Deno.test("lsp feature: Verified-by in Markdown goes to the # of the feature header", async () => {
  await withNavProject(async (client, mdUri, featureUri) => {
    const loc = await client.request("textDocument/definition", {
      textDocument: { uri: mdUri },
      position: { line: 4, character: 22 },
    }) as Loc;
    assertEquals(loc.uri, featureUri);
    assertEquals(loc.range.start, { line: 0, character: 0 });
  });
});

Deno.test("lsp feature: references to a Markdown requirement include the .feature entry", async () => {
  await withNavProject(async (client, mdUri, featureUri) => {
    const locs = await client.request("textDocument/references", {
      textDocument: { uri: mdUri },
      position: { line: 0, character: 6 },
      context: { includeDeclaration: false },
    }) as Loc[];
    assertEquals(locs.map((l) => [l.uri, l.range.start.line]), [
      [featureUri, 0],
    ]);
  });
});

Deno.test("lsp feature: folding of the Feature entry spans its Scenario", async () => {
  await withNavProject(async (client, _md, featureUri) => {
    const ranges = await client.request("textDocument/foldingRange", {
      textDocument: { uri: featureUri },
    }) as Array<{ startLine: number; endLine: number }>;
    assertEquals(ranges.map((r) => [r.startLine, r.endLine]), [
      [0, 10],
      [7, 10],
    ]);
  });
});

Deno.test("lsp feature: highlights mark header IDs only, not step text", async () => {
  await withNavProject(async (client, _md, featureUri) => {
    const highlights = await client.request("textDocument/documentHighlight", {
      textDocument: { uri: featureUri },
      position: { line: 4, character: 14 },
    }) as Array<{ range: { start: { line: number } } }>;
    // `REQ_0001` occurs in the Satisfies comment (line 4) and in a step
    // (line 9); only the comment occurrence is a reference.
    assertEquals(highlights.map((h) => h.range.start.line), [4]);
  });
});

Deno.test("lsp feature: hover on a # [TST_0001] header shows the entry", async () => {
  await withNavProject(async (client, _md, featureUri) => {
    const hover = await client.request("textDocument/hover", {
      textDocument: { uri: featureUri },
      position: { line: 0, character: 5 },
    }) as { contents: { value: string } } | null;
    assertEquals(hover?.contents.value.includes("TST_0001"), true);
  });
});

Deno.test("lsp feature: renaming a requirement rewrites .feature comments, not steps", async () => {
  await withNavProject(async (client, mdUri, featureUri) => {
    const result = await client.request("textDocument/rename", {
      textDocument: { uri: mdUri },
      position: { line: 0, character: 6 },
      newName: "REQ_0009",
    }) as {
      changes: Record<
        string,
        Array<{ range: { start: { line: number } }; newText: string }>
      >;
    };
    assertEquals(
      result.changes[featureUri].map((e) => [e.range.start.line, e.newText]),
      [[4, "REQ_0009"]],
    );
  });
});

Deno.test("lsp feature: renaming a test ID rewrites the header and keeps a Verified-by locator", async () => {
  const md = MD_REQ.replace(
    "Verified-by: TST_0001",
    "Verified-by: TST_0001[Login]",
  );
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    "req.md": md,
    "login.feature": FEATURE_NAV,
  });
  try {
    await client.initialize();
    await client.waitForNotification("markspec/indexed", 15000);
    const mdUri = toFileUrl(join(client.workDir, "req.md")).href;
    const featureUri = toFileUrl(join(client.workDir, "login.feature")).href;
    for (
      const [uri, text, languageId] of [
        [mdUri, md, "markdown"],
        [featureUri, FEATURE_NAV, "feature"],
      ]
    ) {
      await client.notify("textDocument/didOpen", {
        textDocument: { uri, languageId, version: 1, text },
      });
    }
    const result = await client.request("textDocument/rename", {
      textDocument: { uri: featureUri },
      position: { line: 0, character: 6 },
      newName: "TST_0009",
    }) as {
      changes: Record<
        string,
        Array<
          {
            range: {
              start: { line: number; character: number };
              end: { character: number };
            };
            newText: string;
          }
        >
      >;
    };
    assertEquals(
      result.changes[featureUri].map((e) => [e.range.start.line, e.newText]),
      [[0, "TST_0009"]],
    );
    // Only the ID span is edited; `[Login]` is outside the range.
    const mdEdit = result.changes[mdUri][0];
    assertEquals(
      [mdEdit.range.start.character, mdEdit.range.end.character],
      [19, 27],
    );
  } finally {
    await client.shutdown();
  }
});
