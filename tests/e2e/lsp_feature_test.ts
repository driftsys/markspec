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

/** The server publishes the cross-file result after a 1000 ms debounce that
 * restarts on every parse, so it always arrives at least this long after the
 * last parse publish. */
const CROSS_FILE_MIN_GAP_MS = 1000;
/** Short quiet period after the cross-file publish. */
const SETTLE_MS = 200;

/** Open `text` as `name` in a fresh project and return the diagnostics of
 * the latest publish for that file. Waits for the parse-stage publishes, then
 * for a publish that arrives at least {@linkcode CROSS_FILE_MIN_GAP_MS} after
 * the publish before it (the debounced cross-file one), then a short settle,
 * so the result is the state after the cross-file publish (#939: that publish
 * used to drop parse diagnostics). */
async function openDocument(
  name: string,
  text: string,
  languageId = "feature",
): Promise<Diag[]> {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
  });
  try {
    await client.initialize();
    const uri = toFileUrl(join(client.workDir, name)).href;
    await client.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
    await client.waitUntil(
      () => client.latestDiagnosticsFor(uri) !== undefined,
      `parse diagnostics for ${name}`,
      10000,
    );
    await client.waitUntil(
      () => {
        const times = client.publishTimesFor(uri);
        return times.some((t, i) =>
          i > 0 && t - times[i - 1] >= CROSS_FILE_MIN_GAP_MS
        );
      },
      `cross-file diagnostics for ${name}`,
      10000,
    );
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    return client.latestDiagnosticsFor(uri) as Diag[];
  } finally {
    await client.shutdown();
  }
}

/** Open a `.feature` buffer; see {@linkcode openDocument}. */
function openFeature(name: string, text: string): Promise<Diag[]> {
  return openDocument(name, text, "feature");
}

Deno.test("lsp: Markdown parse diagnostics survive the cross-file publish (#939)", async () => {
  const diags = await openDocument("bad.md", "- [] Title\n", "markdown");
  assertEquals(diags.filter((d) => d.code === "MSL-P001").length, 1);
});

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

type FormatEdit = { newText: string };

/** Open `text` as `name` and return the edits of `textDocument/formatting`. */
async function formatFeature(
  name: string,
  text: string,
): Promise<FormatEdit[]> {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
  });
  try {
    await client.initialize();
    const uri = toFileUrl(join(client.workDir, name)).href;
    await client.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: "feature", version: 1, text },
    });
    return await client.request("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    }) as FormatEdit[];
  } finally {
    await client.shutdown();
  }
}

Deno.test("lsp feature: formatting stamps one Id line and nothing else", async () => {
  const text = `${HEADER}\nFeature: F\n  Scenario: S\n    Given a\n`;
  const edits = await formatFeature("f1.feature", text);
  assertEquals(edits.length, 1);
  const out = edits[0].newText;
  assertEquals(out.match(/^# Id: [0-9A-HJKMNP-TV-Z]{26}$/gm)?.length, 1);
  assertEquals(
    out.replace(/^#\n# Id: .*\n/m, "").replace(/^# Id: .*\n/m, ""),
    text,
  );
});

Deno.test("lsp feature: formatting a headerless file returns no edits", async () => {
  assertEquals(
    await formatFeature(
      "f2.feature",
      "Feature: F\n  Scenario: S\n    Given a\n",
    ),
    [],
  );
});

Deno.test("lsp feature: formatting a file that does not parse returns no edits", async () => {
  assertEquals(
    await formatFeature("f3.feature", `${HEADER}\n${UNPARSABLE}`),
    [],
  );
});

Deno.test("lsp feature: formatting a stamped file returns no edits", async () => {
  const text = `${HEADER}\nFeature: F\n  Scenario: S\n    Given a\n`;
  const first = await formatFeature("f4.feature", text);
  assertEquals(first.length, 1);
  assertEquals(await formatFeature("f5.feature", first[0].newText), []);
});

const PLAIN_CUCUMBER = [
  "Feature: Login REQ_0001",
  "",
  "  Background:",
  "    Given a registered user",
  "",
  "  Scenario: Valid",
  "    Given the user opens the page",
  "    When the user logs in",
  "    Then the dashboard shows",
  "",
].join("\n");

Deno.test("lsp feature: every handler is empty for a plain Cucumber file", async () => {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
  });
  try {
    await client.initialize();
    const uri = toFileUrl(join(client.workDir, "plain.feature")).href;
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: "feature",
        version: 1,
        text: PLAIN_CUCUMBER,
      },
    });
    await client.waitUntil(
      () => client.latestDiagnosticsFor(uri) !== undefined,
      "diagnostics",
      10000,
    );
    const textDocument = { uri };
    const onStep = { line: 6, character: 8 };
    const onId = { line: 0, character: 20 };
    const ask = (method: string, extra: Record<string, unknown> = {}) =>
      client.request(`textDocument/${method}`, { textDocument, ...extra });
    assertEquals(client.latestDiagnosticsFor(uri), []);
    assertEquals(await ask("documentSymbol"), []);
    assertEquals(await ask("foldingRange"), []);
    assertEquals(await ask("semanticTokens/full"), { data: [] });
    assertEquals(
      await ask("inlayHint", {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 10, character: 0 },
        },
      }),
      [],
    );
    assertEquals(await ask("codeLens"), []);
    assertEquals(
      await ask("formatting", {
        options: { tabSize: 2, insertSpaces: true },
      }),
      [],
    );
    assertEquals(await ask("hover", { position: onStep }), null);
    assertEquals(await ask("hover", { position: onId }), null);
    assertEquals(await ask("definition", { position: onId }), null);
    assertEquals(
      await ask("references", {
        position: onId,
        context: { includeDeclaration: true },
      }),
      [],
    );
    assertEquals(await ask("documentHighlight", { position: onId }), null);
    assertEquals(
      await ask("codeAction", {
        range: { start: onStep, end: onStep },
        context: { diagnostics: [] },
      }),
      [],
    );
  } finally {
    await client.shutdown();
  }
});
