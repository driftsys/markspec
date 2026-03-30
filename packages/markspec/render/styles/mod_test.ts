/**
 * @module render/styles_test
 *
 * Unit tests for requirement block styling.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { styleRequirementBlocks } from "./mod.ts";
import type { CompileResult } from "../../core/mod.ts";
import type { Entry } from "../../core/mod.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal CompileResult from a list of entry stubs. */
function buildCompiled(
  entries: Array<{
    displayId: string;
    title: string;
    body?: string;
    attributes?: Array<{ key: string; value: string }>;
    entryType?: string;
    id?: string;
  }>,
): CompileResult {
  const map = new Map<string, Entry>();
  for (const e of entries) {
    const entry: Entry = {
      displayId: e.displayId,
      title: e.title,
      body: e.body ?? "",
      attributes: e.attributes ?? [],
      id: e.id,
      entryType: e.entryType,
      location: { file: "test.md", line: 1, column: 1 },
      source: "markdown",
    };
    map.set(e.displayId, entry);
  }
  return {
    entries: map,
    links: [],
    forward: new Map(),
    reverse: new Map(),
    diagnostics: [],
  };
}

// ---------------------------------------------------------------------------
// Basic transformation
// ---------------------------------------------------------------------------

Deno.test("styleRequirementBlocks: entry block is transformed with ID in monospace and title bold", () => {
  const md = `- [SRS_BRK_0001] Sensor debouncing

  The sensor driver shall debounce raw inputs.

  Id: SRS_01HGW2Q8MNP3
`;
  const compiled = buildCompiled([{
    displayId: "SRS_BRK_0001",
    title: "Sensor debouncing",
    entryType: "SRS",
    id: "SRS_01HGW2Q8MNP3",
    attributes: [{ key: "Id", value: "SRS_01HGW2Q8MNP3" }],
  }]);

  const result = styleRequirementBlocks(md, compiled);

  assertStringIncludes(result.output, "`SRS_BRK_0001`");
  assertStringIncludes(result.output, "**Sensor debouncing**");
  assertStringIncludes(result.output, "---");
});

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

Deno.test("styleRequirementBlocks: attributes rendered as compact table", () => {
  const md = `- [SRS_BRK_0001] Sensor debouncing

  Body text.

  Id: SRS_01HGW2Q8MNP3 \\
  Satisfies: SYS_BRK_0042 \\
  Labels: ASIL-B
`;
  const compiled = buildCompiled([{
    displayId: "SRS_BRK_0001",
    title: "Sensor debouncing",
    entryType: "SRS",
    id: "SRS_01HGW2Q8MNP3",
    attributes: [
      { key: "Id", value: "SRS_01HGW2Q8MNP3" },
      { key: "Satisfies", value: "SYS_BRK_0042" },
      { key: "Labels", value: "ASIL-B" },
    ],
  }]);

  const result = styleRequirementBlocks(md, compiled);

  assertStringIncludes(result.output, "| **Id** | `SRS_01HGW2Q8MNP3` |");
  assertStringIncludes(
    result.output,
    "| **Satisfies** | `SYS_BRK_0042` |",
  );
  assertStringIncludes(result.output, "| **Labels** | ASIL-B |");
  assertStringIncludes(result.output, "|---|---|");
});

// ---------------------------------------------------------------------------
// Body preservation
// ---------------------------------------------------------------------------

Deno.test("styleRequirementBlocks: body text preserved between title and attributes", () => {
  const md = `- [SRS_BRK_0001] Sensor debouncing

  The sensor driver shall debounce raw inputs.

  Second paragraph with details.

  Id: SRS_01HGW2Q8MNP3
`;
  const compiled = buildCompiled([{
    displayId: "SRS_BRK_0001",
    title: "Sensor debouncing",
    entryType: "SRS",
    id: "SRS_01HGW2Q8MNP3",
    attributes: [{ key: "Id", value: "SRS_01HGW2Q8MNP3" }],
  }]);

  const result = styleRequirementBlocks(md, compiled);

  assertStringIncludes(
    result.output,
    "The sensor driver shall debounce raw inputs.",
  );
  assertStringIncludes(result.output, "Second paragraph with details.");
});

// ---------------------------------------------------------------------------
// Multiple entries
// ---------------------------------------------------------------------------

Deno.test("styleRequirementBlocks: multiple entries in one document all transform", () => {
  const md = `# Braking

- [SRS_BRK_0001] Sensor debouncing

  Body one.

  Id: SRS_01HGW2Q8MNP3

- [SRS_BRK_0002] Threshold check

  Body two.

  Id: SRS_01HGW2R9QLP4
`;
  const compiled = buildCompiled([
    {
      displayId: "SRS_BRK_0001",
      title: "Sensor debouncing",
      entryType: "SRS",
      id: "SRS_01HGW2Q8MNP3",
      attributes: [{ key: "Id", value: "SRS_01HGW2Q8MNP3" }],
    },
    {
      displayId: "SRS_BRK_0002",
      title: "Threshold check",
      entryType: "SRS",
      id: "SRS_01HGW2R9QLP4",
      attributes: [{ key: "Id", value: "SRS_01HGW2R9QLP4" }],
    },
  ]);

  const result = styleRequirementBlocks(md, compiled);

  assertStringIncludes(result.output, "`SRS_BRK_0001` **Sensor debouncing**");
  assertStringIncludes(result.output, "`SRS_BRK_0002` **Threshold check**");
  assertStringIncludes(result.output, "Body one.");
  assertStringIncludes(result.output, "Body two.");
});

// ---------------------------------------------------------------------------
// Non-entry preservation
// ---------------------------------------------------------------------------

Deno.test("styleRequirementBlocks: non-entry list items are NOT transformed", () => {
  const md = `# Notes

- Regular list item
- Another item
- [SRS_BRK_0001] Sensor debouncing

  Body text.

  Id: SRS_01HGW2Q8MNP3
`;
  const compiled = buildCompiled([{
    displayId: "SRS_BRK_0001",
    title: "Sensor debouncing",
    entryType: "SRS",
    id: "SRS_01HGW2Q8MNP3",
    attributes: [{ key: "Id", value: "SRS_01HGW2Q8MNP3" }],
  }]);

  const result = styleRequirementBlocks(md, compiled);

  // Regular items kept as-is.
  assertStringIncludes(result.output, "- Regular list item");
  assertStringIncludes(result.output, "- Another item");
  // Entry is transformed.
  assertStringIncludes(result.output, "`SRS_BRK_0001`");
});

// ---------------------------------------------------------------------------
// No entries
// ---------------------------------------------------------------------------

Deno.test("styleRequirementBlocks: document without entries returns input unchanged", () => {
  const md = `# Introduction

This is a regular document with no entries.

- Regular list
- Another item
`;
  const compiled = buildCompiled([]);

  const result = styleRequirementBlocks(md, compiled);

  assertEquals(result.output, md);
});

// ---------------------------------------------------------------------------
// Alerts / admonitions
// ---------------------------------------------------------------------------

Deno.test("styleRequirementBlocks: entry with alert/admonition preserves it", () => {
  const md = `- [SRS_BRK_0001] Sensor debouncing

  The sensor driver shall debounce raw inputs.

  > [!WARNING]
  > Failure may cause brake delay.

  Id: SRS_01HGW2Q8MNP3
`;
  const compiled = buildCompiled([{
    displayId: "SRS_BRK_0001",
    title: "Sensor debouncing",
    entryType: "SRS",
    id: "SRS_01HGW2Q8MNP3",
    attributes: [{ key: "Id", value: "SRS_01HGW2Q8MNP3" }],
  }]);

  const result = styleRequirementBlocks(md, compiled);

  assertStringIncludes(result.output, "`SRS_BRK_0001`");
  assertStringIncludes(result.output, "> [!WARNING]");
  assertStringIncludes(result.output, "> Failure may cause brake delay.");
});

// ---------------------------------------------------------------------------
// Attribute formatting
// ---------------------------------------------------------------------------

Deno.test("styleRequirementBlocks: Id attribute value rendered in monospace", () => {
  const md = `- [SRS_BRK_0001] Title

  Body.

  Id: SRS_01HGW2Q8MNP3
`;
  const compiled = buildCompiled([{
    displayId: "SRS_BRK_0001",
    title: "Title",
    entryType: "SRS",
    id: "SRS_01HGW2Q8MNP3",
    attributes: [{ key: "Id", value: "SRS_01HGW2Q8MNP3" }],
  }]);

  const result = styleRequirementBlocks(md, compiled);

  assertStringIncludes(result.output, "| **Id** | `SRS_01HGW2Q8MNP3` |");
});

Deno.test("styleRequirementBlocks: Satisfies values rendered in monospace", () => {
  const md = `- [SRS_BRK_0001] Title

  Body.

  Satisfies: SYS_BRK_0042, SYS_BRK_0043
`;
  const compiled = buildCompiled([{
    displayId: "SRS_BRK_0001",
    title: "Title",
    entryType: "SRS",
    attributes: [{ key: "Satisfies", value: "SYS_BRK_0042, SYS_BRK_0043" }],
  }]);

  const result = styleRequirementBlocks(md, compiled);

  assertStringIncludes(
    result.output,
    "| **Satisfies** | `SYS_BRK_0042`, `SYS_BRK_0043` |",
  );
});

// ---------------------------------------------------------------------------
// Unknown display ID not transformed
// ---------------------------------------------------------------------------

Deno.test("styleRequirementBlocks: list item with unknown display ID is not transformed", () => {
  const md = `- [SRS_BRK_9999] Unknown entry

  Body text.

  Id: SRS_01UNKNOWN
`;
  const compiled = buildCompiled([{
    displayId: "SRS_BRK_0001",
    title: "Other entry",
    entryType: "SRS",
  }]);

  const result = styleRequirementBlocks(md, compiled);

  // Should remain as a list item, not styled.
  assertStringIncludes(result.output, "- [SRS_BRK_9999] Unknown entry");
});

// ---------------------------------------------------------------------------
// Heading preservation
// ---------------------------------------------------------------------------

Deno.test("styleRequirementBlocks: headings and prose around entries preserved", () => {
  const md = `# Chapter 1

Introduction paragraph.

- [SRS_BRK_0001] Sensor debouncing

  Body text.

  Id: SRS_01HGW2Q8MNP3

## Section 1.1

More prose here.
`;
  const compiled = buildCompiled([{
    displayId: "SRS_BRK_0001",
    title: "Sensor debouncing",
    entryType: "SRS",
    id: "SRS_01HGW2Q8MNP3",
    attributes: [{ key: "Id", value: "SRS_01HGW2Q8MNP3" }],
  }]);

  const result = styleRequirementBlocks(md, compiled);

  assertStringIncludes(result.output, "# Chapter 1");
  assertStringIncludes(result.output, "Introduction paragraph.");
  assertStringIncludes(result.output, "## Section 1.1");
  assertStringIncludes(result.output, "More prose here.");
  assertStringIncludes(result.output, "`SRS_BRK_0001`");
});
