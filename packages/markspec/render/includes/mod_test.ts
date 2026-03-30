import { assertEquals } from "@std/assert";
import { processIncludes } from "./mod.ts";
import type { IncludeOptions } from "./mod.ts";
import type { CompileResult, Entry } from "../../core/mod.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Entry for testing. */
function testEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    displayId: "SRS_BRK_0001",
    title: "Sensor debouncing",
    body: "The sensor driver shall debounce raw inputs.",
    attributes: [
      { key: "Id", value: "SRS_01HGW2Q8MNP3" },
      { key: "Satisfies", value: "SYS_BRK_0001" },
      { key: "Labels", value: "ASIL-B" },
    ],
    id: "SRS_01HGW2Q8MNP3",
    entryType: "SRS",
    location: { file: "test.md", line: 1, column: 1 },
    source: "markdown",
    ...overrides,
  };
}

/** Build a CompileResult with the given entries. */
function compiled(...entries: Entry[]): CompileResult {
  const map = new Map(entries.map((e) => [e.displayId, e]));
  return {
    entries: map,
    links: [],
    forward: new Map(),
    reverse: new Map(),
    diagnostics: [],
  };
}

/** Build IncludeOptions with an in-memory file system. */
function options(
  entries: Entry[] = [],
  files: Record<string, string> = {},
): IncludeOptions {
  return {
    readFile: (path: string) => {
      if (path in files) return Promise.resolve(files[path]);
      return Promise.reject(new Error(`file not found: ${path}`));
    },
    basePath: "/project",
    compiled: compiled(...entries),
  };
}

// ---------------------------------------------------------------------------
// Full entry inlining
// ---------------------------------------------------------------------------

Deno.test("processIncludes: display ID resolves to full entry", async () => {
  const entry = testEntry();
  const input = "Before\n\n<!-- include: SRS_BRK_0001 -->\n\nAfter";

  const result = await processIncludes(input, options([entry]));

  assertEquals(result.diagnostics.length, 0);
  assertEquals(
    result.output,
    [
      "Before",
      "",
      "- [SRS_BRK_0001] Sensor debouncing",
      "",
      "  The sensor driver shall debounce raw inputs.",
      "",
      "  Id: SRS_01HGW2Q8MNP3 \\",
      "  Satisfies: SYS_BRK_0001 \\",
      "  Labels: ASIL-B",
      "",
      "After",
    ].join("\n"),
  );
});

// ---------------------------------------------------------------------------
// title-only filter
// ---------------------------------------------------------------------------

Deno.test("processIncludes: title-only filter inlines bold title", async () => {
  const entry = testEntry();
  const input = "See <!-- include: SRS_BRK_0001 | title-only --> for details.";

  const result = await processIncludes(input, options([entry]));

  assertEquals(result.diagnostics.length, 0);
  assertEquals(
    result.output,
    "See **[SRS_BRK_0001] Sensor debouncing** for details.",
  );
});

// ---------------------------------------------------------------------------
// body-only filter
// ---------------------------------------------------------------------------

Deno.test("processIncludes: body-only filter inlines body text", async () => {
  const entry = testEntry();
  const input = "<!-- include: SRS_BRK_0001 | body-only -->";

  const result = await processIncludes(input, options([entry]));

  assertEquals(result.diagnostics.length, 0);
  assertEquals(
    result.output,
    "The sensor driver shall debounce raw inputs.",
  );
});

// ---------------------------------------------------------------------------
// Unresolved reference
// ---------------------------------------------------------------------------

Deno.test("processIncludes: unresolved ref produces diagnostic", async () => {
  const input = "<!-- include: NONEXISTENT -->";

  const result = await processIncludes(input, options());

  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "INC-E001");
  assertEquals(result.diagnostics[0].severity, "error");
  assertEquals(
    result.diagnostics[0].message,
    "unresolved include reference: NONEXISTENT",
  );
  // Directive is left unchanged when ref cannot be resolved.
  assertEquals(result.output, "<!-- include: NONEXISTENT -->");
});

// ---------------------------------------------------------------------------
// Multiple includes
// ---------------------------------------------------------------------------

Deno.test("processIncludes: multiple includes all resolve", async () => {
  const entry1 = testEntry();
  const entry2 = testEntry({
    displayId: "SRS_BRK_0002",
    title: "Brake pressure",
    body: "Brake pressure shall be monitored.",
    attributes: [{ key: "Id", value: "SRS_01HGW2Q8MNP4" }],
    id: "SRS_01HGW2Q8MNP4",
  });

  const input = [
    "<!-- include: SRS_BRK_0001 | title-only -->",
    "",
    "<!-- include: SRS_BRK_0002 | title-only -->",
  ].join("\n");

  const result = await processIncludes(input, options([entry1, entry2]));

  assertEquals(result.diagnostics.length, 0);
  assertEquals(
    result.output,
    [
      "**[SRS_BRK_0001] Sensor debouncing**",
      "",
      "**[SRS_BRK_0002] Brake pressure**",
    ].join("\n"),
  );
});

// ---------------------------------------------------------------------------
// Code block protection
// ---------------------------------------------------------------------------

Deno.test("processIncludes: directives inside code blocks are not processed", async () => {
  const entry = testEntry();
  const input = [
    "```markdown",
    "<!-- include: SRS_BRK_0001 -->",
    "```",
  ].join("\n");

  const result = await processIncludes(input, options([entry]));

  assertEquals(result.diagnostics.length, 0);
  // The directive should remain untouched inside the code block.
  assertEquals(result.output, input);
});

// ---------------------------------------------------------------------------
// File path with anchor
// ---------------------------------------------------------------------------

Deno.test("processIncludes: file path with anchor resolves section", async () => {
  const fileContent = [
    "# Introduction",
    "",
    "Some intro text.",
    "",
    "## Requirements",
    "",
    "Requirements go here.",
    "",
    "## Design",
    "",
    "Design details.",
  ].join("\n");

  const input = "<!-- include: docs/spec.md#requirements -->";

  const result = await processIncludes(
    input,
    options([], { "/project/docs/spec.md": fileContent }),
  );

  assertEquals(result.diagnostics.length, 0);
  assertEquals(
    result.output,
    [
      "## Requirements",
      "",
      "Requirements go here.",
    ].join("\n"),
  );
});

// ---------------------------------------------------------------------------
// File path without anchor
// ---------------------------------------------------------------------------

Deno.test("processIncludes: file path without anchor includes full content", async () => {
  const fileContent = "# Full Document\n\nAll content here.";

  const input = "<!-- include: docs/readme.md -->";

  const result = await processIncludes(
    input,
    options([], { "/project/docs/readme.md": fileContent }),
  );

  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.output, fileContent);
});

// ---------------------------------------------------------------------------
// File not found
// ---------------------------------------------------------------------------

Deno.test("processIncludes: missing file produces diagnostic", async () => {
  const input = "<!-- include: docs/missing.md -->";

  const result = await processIncludes(input, options());

  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "INC-E002");
  assertEquals(result.output, input);
});

// ---------------------------------------------------------------------------
// Missing anchor in file
// ---------------------------------------------------------------------------

Deno.test("processIncludes: missing anchor produces diagnostic", async () => {
  const fileContent = "# Introduction\n\nSome text.";
  const input = "<!-- include: docs/spec.md#nonexistent -->";

  const result = await processIncludes(
    input,
    options([], { "/project/docs/spec.md": fileContent }),
  );

  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "INC-E003");
  assertEquals(result.output, input);
});

// ---------------------------------------------------------------------------
// Entry with no body
// ---------------------------------------------------------------------------

Deno.test("processIncludes: entry with empty body renders correctly", async () => {
  const entry = testEntry({ body: "", attributes: [], id: undefined });
  const input = "<!-- include: SRS_BRK_0001 -->";

  const result = await processIncludes(input, options([entry]));

  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.output, "- [SRS_BRK_0001] Sensor debouncing");
});

// ---------------------------------------------------------------------------
// No directives in input
// ---------------------------------------------------------------------------

Deno.test("processIncludes: no directives returns input unchanged", async () => {
  const input = "# Hello\n\nJust regular markdown.";

  const result = await processIncludes(input, options());

  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.output, input);
});
