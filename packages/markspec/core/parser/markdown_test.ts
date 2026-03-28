/**
 * @module parser/markdown_test
 *
 * Unit tests for Markdown entry extraction.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { parseMarkdown } from "./markdown.ts";

// ---------------------------------------------------------------------------
// Typed entry extraction
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: extracts typed entry with display ID and title", () => {
  const md = `# Test

- [SRS_BRK_0001] Sensor input debouncing

  Body text.

  Id: SRS_01HGW2Q8MNP3
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  assertEquals(entries[0].title, "Sensor input debouncing");
  assertEquals(entries[0].entryType, "SRS");
  assertEquals(entries[0].id, "SRS_01HGW2Q8MNP3");
  assertEquals(entries[0].source, "markdown");
});

Deno.test("parseMarkdown: extracts body between title and attributes", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  First paragraph of the body.

  Second paragraph of the body.

  Id: SRS_01HGW2Q8MNP3
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertStringIncludes(entries[0].body, "First paragraph of the body.");
  assertStringIncludes(entries[0].body, "Second paragraph of the body.");
});

Deno.test("parseMarkdown: extracts body with alerts", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text.

  > [!WARNING]
  > Failure may occur.

  Id: SRS_01HGW2Q8MNP3
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertStringIncludes(entries[0].body, "Body text.");
  assertStringIncludes(entries[0].body, "[!WARNING]");
});

Deno.test("parseMarkdown: extracts multiple entries", () => {
  const md = `# Test

- [SRS_BRK_0001] First entry

  Body one.

  Id: SRS_01HGW2Q8MNP3

- [SRS_BRK_0002] Second entry

  Body two.

  Id: SRS_01HGW2R9QLP4
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 2);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  assertEquals(entries[1].displayId, "SRS_BRK_0002");
});

// ---------------------------------------------------------------------------
// Reference entry extraction
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: extracts reference entry", () => {
  const md = `# References

- [ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety.

  Document: ISO 26262-6:2018\\
  URL: https://www.iso.org/standard/68383.html
`;
  const entries = parseMarkdown(md, { file: "refs.md" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "ISO-26262-6");
  assertEquals(entries[0].title, "ISO 26262 Part 6");
  assertEquals(entries[0].entryType, undefined);
  assertEquals(entries[0].id, undefined);
  assertStringIncludes(entries[0].body, "Road vehicles");
});

// ---------------------------------------------------------------------------
// Attribute parsing (stories #8 + #9 integration)
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: parses backslash-separated attributes", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body.

  Id: SRS_01HGW2Q8MNP3\\
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries[0].attributes.length, 3);
  assertEquals(entries[0].attributes[0].key, "Id");
  assertEquals(entries[0].attributes[0].value, "SRS_01HGW2Q8MNP3");
  assertEquals(entries[0].attributes[1].key, "Satisfies");
  assertEquals(entries[0].attributes[2].key, "Labels");
});

Deno.test("parseMarkdown: Key: Value in body middle is NOT an attribute", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  The system uses Key: Value pairs in config files.
  Another line of body text.

  Id: SRS_01HGW2Q8MNP3
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries[0].attributes.length, 1);
  assertEquals(entries[0].attributes[0].key, "Id");
  assertStringIncludes(entries[0].body, "Key: Value pairs");
});

// ---------------------------------------------------------------------------
// Source location
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: preserves source location", () => {
  const md = `# Test

- [SRS_BRK_0001] First

  Body.

  Id: SRS_01HGW2Q8MNP3

- [SRS_BRK_0002] Second

  Body.

  Id: SRS_01HGW2R9QLP4
`;
  const entries = parseMarkdown(md, { file: "reqs.md" });
  assertEquals(entries[0].location.file, "reqs.md");
  assertEquals(entries[0].location.line, 3);
  assertEquals(entries[0].location.column, 1);

  assertEquals(entries[1].location.file, "reqs.md");
  // Line 10 in the template string is line 9 (the `- [SRS_BRK_0002]` line)
  // because template literals start content at the character after the backtick
  assertEquals(entries[1].location.line, 9);
});

// ---------------------------------------------------------------------------
// Task list exclusion (#93)
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: checked task list item is not an entry", () => {
  const md = `# Test

- [x] Completed task

  This has indented body content.

  Id: SRS_01HGW2Q8MNP3
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 0);
});

Deno.test("parseMarkdown: unchecked task list item is not an entry", () => {
  const md = `# Test

- [ ] Pending task

  This has indented body content too.
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 0);
});

// ---------------------------------------------------------------------------
// Display ID regex: 3-digit numbers and long domains
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: 3-digit display ID is valid", () => {
  const md = `# Test

- [SRS_BRK_001] Three-digit entry

  Body text.

  Id: SRS_01HGW2Q8MNP3
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_001");
});

Deno.test("parseMarkdown: long domain abbreviation is valid", () => {
  const md = `# Test

- [SRS_LONGDOMAIN_0001] Long domain entry

  Body text.

  Id: SRS_01HGW2Q8MNP3
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_LONGDOMAIN_0001");
});

Deno.test("parseMarkdown: long type prefix is valid", () => {
  const md = `# Test

- [MULTI_BRK_0001] Long type prefix

  Body text.

  Id: MULTI_01HGW2Q8MNP3
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "MULTI_BRK_0001");
  assertEquals(entries[0].entryType, "MULTI");
});

// ---------------------------------------------------------------------------
// Entry exclusion checks (AST spec §1)
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: ordered list items are not entries", () => {
  const md = `# Test

1. [SRS_BRK_0001] Ordered list item

   Body text.

   Id: SRS_01HGW2Q8MNP3
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 0);
});

Deno.test("parseMarkdown: nested list items are not entries", () => {
  const md = `# Test

- Parent item
  - [SRS_BRK_0001] Nested entry

    Body text.

    Id: SRS_01HGW2Q8MNP3
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 0);
});

Deno.test("parseMarkdown: inline link is not an entry", () => {
  const md = `# Test

- [See documentation](https://example.com) for details

  This has indented body content.
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 0);
});

Deno.test("parseMarkdown: full linkReference is not an entry", () => {
  const md = `# Test

- [See docs][ref-id] for details

  This has indented body content.

[ref-id]: https://example.com
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 0);
});

Deno.test("parseMarkdown: collapsed linkReference is not an entry", () => {
  const md = `# Test

- [CommonMark][] is the baseline

  This has indented body content.

[CommonMark]: https://commonmark.org
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 0);
});

Deno.test("parseMarkdown: shortcut ref with definition is not an entry", () => {
  const md = `# Test

- [CommonMark] is the baseline grammar

  This has indented body content.

[CommonMark]: https://commonmark.org
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 0);
});

Deno.test("parseMarkdown: shortcut ref without definition is still an entry", () => {
  const md = `# Test

- [ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety.

  Document: ISO 26262-6:2018
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "ISO-26262-6");
});

// ---------------------------------------------------------------------------
// Body indent stripping (#94)
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: body has no leading whitespace artifacts", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  First line of body.

  Second line of body.

  Id: SRS_01HGW2Q8MNP3
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  // Body lines should not have leading spaces from list indentation
  const bodyLines = entries[0].body.split("\n");
  for (const line of bodyLines) {
    if (line.trim() !== "") {
      assertEquals(
        line,
        line.trimStart(),
        `unexpected leading whitespace: "${line}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Non-entry list items ignored
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: list item without body is not an entry", () => {
  const md = `# Test

- [SRS_BRK_0001] Title without indented body
- Just a normal list item
- [See documentation] for details
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 0);
});

Deno.test("parseMarkdown: normal list items are ignored", () => {
  const md = `# Test

- Pressure sensor
- Speed sensor

- [SRS_BRK_0001] Real entry

  Body text.

  Id: SRS_01HGW2Q8MNP3
`;
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
});

// ---------------------------------------------------------------------------
// Default file path
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: uses '<unknown>' when no file specified", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body.

  Id: SRS_01HGW2Q8MNP3
`;
  const entries = parseMarkdown(md);
  assertEquals(entries[0].location.file, "<unknown>");
});

// ---------------------------------------------------------------------------
// Entry without Id attribute
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: entry without Id attribute has undefined id", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text only, no attributes.
`;
  // Entry with body but no attributes — still a valid entry block
  const entries = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].id, undefined);
  assertEquals(entries[0].attributes.length, 0);
});

// ---------------------------------------------------------------------------
// Fixture: braking requirements (from ADR-001 example)
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: fixture — braking requirements", () => {
  const md = `# Braking System — Software Requirements

## Sensor Processing

- [SRS_BRK_0001] Sensor input debouncing

  The sensor driver shall debounce raw inputs to eliminate electrical noise
  before processing.

  The debounce window shall be configurable per sensor type.

  > [!WARNING]
  > Failure to debounce may lead to spurious brake activation.

  Id: SRS_01HGW2Q8MNP3\\
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B

- [SRS_BRK_0002] Sensor plausibility check

  The sensor driver shall reject readings outside the physically plausible range
  for each sensor type.

  Id: SRS_01HGW2R9QLP4\\
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B
`;
  const entries = parseMarkdown(md, { file: "braking.md" });
  assertEquals(entries.length, 2);

  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  assertEquals(entries[0].title, "Sensor input debouncing");
  assertEquals(entries[0].id, "SRS_01HGW2Q8MNP3");
  assertEquals(entries[0].entryType, "SRS");
  assertStringIncludes(entries[0].body, "debounce raw inputs");
  assertStringIncludes(entries[0].body, "[!WARNING]");
  assertEquals(entries[0].attributes.length, 3);

  assertEquals(entries[1].displayId, "SRS_BRK_0002");
  assertEquals(entries[1].title, "Sensor plausibility check");
  assertEquals(entries[1].id, "SRS_01HGW2R9QLP4");
  assertEquals(entries[1].attributes.length, 3);
});
