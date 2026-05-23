/**
 * @module tests/e2e/lsp_entry_ranges_test
 *
 * E2E: spawn the LSP server, open a Markdown file, send the
 * markspec/entryRanges custom request, and assert the response
 * structure.
 */

import { assertEquals } from "@std/assert";
import { LspTestClient } from "./lsp_helpers.ts";

interface EntryRangesResponse {
  entries: Array<{
    titleRange: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    trailerDimRanges: Array<{
      start: { line: number; character: number };
      end: { line: number; character: number };
    }>;
    labelRanges: Array<{
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
      valid: boolean;
      diagnostic?: string;
    }>;
  }>;
}

Deno.test("LSP: markspec/entryRanges returns per-entry layout info", async () => {
  const fixture = [
    "# Doc",
    "",
    "- [REQ-001] Brake response time",
    "",
    "  Body.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "      Satisfies: STK-001",
    "      Labels: ASIL-B",
    "",
  ].join("\n");

  const client = await LspTestClient.create({ "doc.md": fixture });
  try {
    await client.initialize();
    await client.notify("textDocument/didOpen", {
      textDocument: {
        uri: `file://${client.workDir}/doc.md`,
        languageId: "markdown",
        version: 1,
        text: fixture,
      },
    });
    await new Promise((r) => setTimeout(r, 300));

    const result = await client.request("markspec/entryRanges", {
      uri: `file://${client.workDir}/doc.md`,
    }) as EntryRangesResponse;

    assertEquals(result.entries.length, 1);
    const e = result.entries[0];
    assertEquals(e.titleRange.start.line, 2); // 0-based
    // At least three dim ranges (one per trailer line, possibly more if
    // split around the Satisfies display ID).
    assertEquals(e.trailerDimRanges.length >= 3, true);
    assertEquals(e.labelRanges.length, 1);
    assertEquals(e.labelRanges[0].range.start.line, 8); // Labels line (0-based)
  } finally {
    await client.shutdown();
  }
});
