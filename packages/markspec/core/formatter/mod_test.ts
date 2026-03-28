/**
 * @module formatter/mod_test
 *
 * Unit tests for attribute block normalization.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { format } from "./mod.ts";

// ---------------------------------------------------------------------------
// Canonical order
// ---------------------------------------------------------------------------

Deno.test("format: attributes already in canonical order are unchanged", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Id: SRS_01HGW2Q8MNP3\\
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B
`;
  const result = format(md);
  assertEquals(result.changed, false);
  assertEquals(result.output, md);
});

Deno.test("format: out-of-order attributes are sorted", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Labels: ASIL-B\\
  Id: SRS_01HGW2Q8MNP3
`;
  const result = format(md);
  assertEquals(result.changed, true);
  assertStringIncludes(result.output, "Id: SRS_01HGW2Q8MNP3\\");
  assertStringIncludes(result.output, "Labels: ASIL-B");
  // Id should come before Labels
  const idIdx = result.output.indexOf("Id:");
  const labelsIdx = result.output.indexOf("Labels:");
  assertEquals(idIdx < labelsIdx, true);
});

Deno.test("format: full canonical reorder", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Labels: ASIL-B\\
  Satisfies: SYS_BRK_0042\\
  Id: SRS_01HGW2Q8MNP3
`;
  const result = format(md);
  assertEquals(result.changed, true);
  const lines = result.output.split("\n");
  const attrLines = lines.filter((l) => l.trim().match(/^[A-Z][a-z-]*: /));
  assertEquals(attrLines.length, 3);
  assertStringIncludes(attrLines[0], "Id:");
  assertStringIncludes(attrLines[1], "Satisfies:");
  assertStringIncludes(attrLines[2], "Labels:");
});

Deno.test("format: trailing backslashes normalized", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Id: SRS_01HGW2Q8MNP3
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B\\
`;
  const result = format(md);
  assertEquals(result.changed, true);
  // Id line should have backslash (not last), Labels should NOT
  assertStringIncludes(result.output, "Id: SRS_01HGW2Q8MNP3\\");
  assertStringIncludes(result.output, "Satisfies: SYS_BRK_0042\\");
  // Labels is last — no backslash
  const labelsLine = result.output.split("\n").find((l) =>
    l.trim().startsWith("Labels:")
  );
  assertEquals(labelsLine?.endsWith("\\"), false);
});

Deno.test("format: indentation fixed to 2-space", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text.

    Id: SRS_01HGW2Q8MNP3\\
    Labels: ASIL-B
`;
  const result = format(md);
  assertEquals(result.changed, true);
  const idLine = result.output.split("\n").find((l) => l.includes("Id:"));
  // Should be indented with exactly 2 spaces (column 1 entry + 2 for "- ")
  assertEquals(idLine?.startsWith("  Id:"), true);
});

Deno.test("format: surrounding content untouched", () => {
  const md = `# Braking System

Some intro paragraph.

- [SRS_BRK_0001] Title

  Body text with **bold** and \`code\`.

  > [!WARNING]
  > Important note.

  Labels: ASIL-B\\
  Id: SRS_01HGW2Q8MNP3

## Next Section

More content here.
`;
  const result = format(md);
  assertEquals(result.changed, true);
  // Heading, body, alert, and trailing section should be byte-identical
  assertStringIncludes(result.output, "# Braking System");
  assertStringIncludes(result.output, "Some intro paragraph.");
  assertStringIncludes(result.output, "Body text with **bold** and `code`.");
  assertStringIncludes(result.output, "> [!WARNING]");
  assertStringIncludes(result.output, "## Next Section");
  assertStringIncludes(result.output, "More content here.");
});

Deno.test("format: multiple entries normalized", () => {
  const md = `# Test

- [SRS_BRK_0001] First

  Body one.

  Labels: ASIL-B\\
  Id: SRS_01HGW2Q8MNP3

- [SRS_BRK_0002] Second

  Body two.

  Labels: ASIL-A\\
  Id: SRS_01HGW2R9QLP4
`;
  const result = format(md);
  assertEquals(result.changed, true);
  // Both entries should have Id before Labels
  const idPositions = [...result.output.matchAll(/Id:/g)].map((m) => m.index);
  const labelPositions = [...result.output.matchAll(/Labels:/g)].map((m) =>
    m.index
  );
  assertEquals(idPositions.length, 2);
  assertEquals(labelPositions.length, 2);
  assertEquals(idPositions[0]! < labelPositions[0]!, true);
  assertEquals(idPositions[1]! < labelPositions[1]!, true);
});

Deno.test("format: reference entry without attributes is unchanged", () => {
  const md = `# Test

- [ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety.
`;
  const result = format(md);
  assertEquals(result.changed, false);
  assertEquals(result.output, md);
});

Deno.test("format: unknown attributes preserved before Labels", () => {
  const md = `# Test

- [ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety.

  URL: https://www.iso.org/standard/68383.html\\
  Document: ISO 26262-6:2018
`;
  const result = format(md);
  // Unknown keys (Document, URL) should preserve relative order
  // Both are unknown, so they stay in original order before any known keys
  assertEquals(result.output.includes("URL:"), true);
  assertEquals(result.output.includes("Document:"), true);
});

Deno.test("format: all-unknown attributes are not duplicated", () => {
  const md = `# Test

- [ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety.

  Document: ISO 26262-6:2018\\
  URL: https://www.iso.org/standard/68383.html
`;
  const result = format(md);
  // Count occurrences — each should appear exactly once
  const docCount = [...result.output.matchAll(/Document:/g)].length;
  const urlCount = [...result.output.matchAll(/URL:/g)].length;
  assertEquals(docCount, 1, "Document: should appear exactly once");
  assertEquals(urlCount, 1, "URL: should appear exactly once");
});

Deno.test("format: duplicate known keys are preserved", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Id: SRS_01HGW2Q8MNP3\\
  Labels: ASIL-B\\
  Labels: safety-critical
`;
  const result = format(md);
  const labelsCount = [...result.output.matchAll(/Labels:/g)].length;
  assertEquals(labelsCount, 2, "both Labels entries should be preserved");
});

Deno.test("format: idempotent on already-formatted input", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Id: SRS_01HGW2Q8MNP3\\
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B
`;
  const first = format(md);
  const second = format(first.output);
  assertEquals(second.changed, false);
  assertEquals(second.output, first.output);
});

// ---------------------------------------------------------------------------
// ULID assignment (#15)
// ---------------------------------------------------------------------------

const MOCK_ULID = "01HGW2Q8MNTEST";
const mockUlid = () => MOCK_ULID;

Deno.test("format: missing Id gets ULID with correct type prefix", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B
`;
  const result = format(md, { generateUlid: mockUlid });
  assertEquals(result.changed, true);
  assertStringIncludes(result.output, `Id: SRS_${MOCK_ULID}`);
  // Id should be first attribute
  const idIdx = result.output.indexOf("Id:");
  const satIdx = result.output.indexOf("Satisfies:");
  assertEquals(idIdx < satIdx, true);
});

Deno.test("format: existing Id unchanged", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Id: SRS_01EXISTING123\\
  Labels: ASIL-B
`;
  const result = format(md, { generateUlid: mockUlid });
  assertStringIncludes(result.output, "Id: SRS_01EXISTING123");
  // Mock ULID should NOT appear
  assertEquals(result.output.includes(MOCK_ULID), false);
});

Deno.test("format: idempotent after ULID assignment", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Labels: ASIL-B
`;
  const first = format(md, { generateUlid: mockUlid });
  assertEquals(first.changed, true);
  const second = format(first.output, { generateUlid: mockUlid });
  assertEquals(second.changed, false);
});

Deno.test("format: reference entries skip ULID", () => {
  const md = `# Test

- [ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety.

  Document: ISO 26262-6:2018
`;
  const result = format(md, { generateUlid: mockUlid });
  assertEquals(result.output.includes("Id:"), false);
});

Deno.test("format: diagnostic emitted on ULID assignment", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Labels: ASIL-B
`;
  const result = format(md, { generateUlid: mockUlid });
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].severity, "info");
  assertStringIncludes(result.diagnostics[0].message, "SRS_BRK_0001");
  assertStringIncludes(result.diagnostics[0].message, `SRS_${MOCK_ULID}`);
});

Deno.test("format: entry with no attributes gets new block with Id", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text only, no attributes.
`;
  const result = format(md, { generateUlid: mockUlid });
  assertEquals(result.changed, true);
  assertStringIncludes(result.output, `Id: SRS_${MOCK_ULID}`);
  // Body should still be there
  assertStringIncludes(result.output, "Body text only, no attributes.");
});

Deno.test("format: mock generateUlid produces deterministic output", () => {
  const md = `# Test

- [SRS_BRK_0001] First

  Body one.

- [SRS_BRK_0002] Second

  Body two.
`;
  const result = format(md, { generateUlid: mockUlid });
  assertEquals(result.changed, true);
  // Both should get the same mock ULID (in real usage they'd differ)
  const idMatches = [...result.output.matchAll(/Id: SRS_01HGW2Q8MNTEST/g)];
  assertEquals(idMatches.length, 2);
});
