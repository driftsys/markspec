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
 * the first publish for that file. */
async function openFeature(
  name: string,
  text: string,
  extra: Record<string, string> = {},
): Promise<Diag[]> {
  const client = await LspTestClient.create({
    "project.yaml": "name: test-project\n",
    ...extra,
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
