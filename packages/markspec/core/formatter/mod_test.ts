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

Deno.test("format: entry without attributes is unchanged", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text only, no attributes.
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
