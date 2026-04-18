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

Deno.test("format: missing identity on spec entry gets Spec-id with bare ULID", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B
`;
  const result = format(md, { generateUlid: mockUlid });
  assertEquals(result.changed, true);
  assertStringIncludes(result.output, `Spec-id: ${MOCK_ULID}`);
  // Identity should come before family-specific relations
  const idIdx = result.output.indexOf("Spec-id:");
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

Deno.test("format: diagnostic emitted on identity assignment", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Labels: ASIL-B
`;
  const result = format(md, { generateUlid: mockUlid });
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].severity, "info");
  assertStringIncludes(result.diagnostics[0].message, "SRS_BRK_0001");
  assertStringIncludes(result.diagnostics[0].message, `Spec-id: ${MOCK_ULID}`);
});

Deno.test("format: entry with no attributes gets new block with Spec-id", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body text only, no attributes.
`;
  const result = format(md, { generateUlid: mockUlid });
  assertEquals(result.changed, true);
  assertStringIncludes(result.output, `Spec-id: ${MOCK_ULID}`);
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
  // Both should get the same mock ULID (in real usage they'd differ).
  const idMatches = [...result.output.matchAll(/Spec-id: 01HGW2Q8MNTEST/g)];
  assertEquals(idMatches.length, 2);
});

// ---------------------------------------------------------------------------
// Phase 4a — new-family identity assignment and canonical orders
// ---------------------------------------------------------------------------

// Test / element auto-assignment requires the parser to first classify
// the entry as test / element. Without an identity attribute already
// present, the parser falls back to display-ID-shape + filename (which
// only covers references today). Profile-driven classification for
// test and element entries is future Phase 6 work; auto-assignment of
// Test-id / Element-id to anonymous entries is deferred until then.

Deno.test("format: reference entry without Reference-id is not auto-assigned", () => {
  // Reference-id is a URI, authored by the human, never generated.
  const md = `# References

- [ISO-26262-6] ISO 26262 Part 6

  Functional safety.

  URI: urn:iso:std:iso:26262:-6:ed-2
`;
  const result = format(md, { generateUlid: mockUlid });
  assertEquals(result.output.includes(MOCK_ULID), false);
  assertEquals(
    result.diagnostics.filter((d) => d.code === "MSL-F001").length,
    0,
  );
});

Deno.test("format: new Spec-id in source is not touched", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Labels: ASIL-B
`;
  const result = format(md, { generateUlid: mockUlid });
  // Don't add another identity; don't replace the existing one.
  assertStringIncludes(result.output, "Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF");
  assertEquals(result.output.includes(MOCK_ULID), false);
});

Deno.test("format: canonical order for test family", () => {
  const md = `# Test

- [SWT_BRK_0001] Title

  Body.

  Labels: ASIL-B\\
  Test-id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Verifies: SRS_BRK_0001\\
  Test-level: unit
`;
  const result = format(md, { generateUlid: mockUlid });
  const lines = result.output.split("\n");
  const testIdLine = lines.findIndex((l) => l.trim().startsWith("Test-id:"));
  const levelLine = lines.findIndex((l) => l.trim().startsWith("Test-level:"));
  const verifiesLine = lines.findIndex((l) => l.trim().startsWith("Verifies:"));
  const labelsLine = lines.findIndex((l) => l.trim().startsWith("Labels:"));
  assertEquals(
    testIdLine < levelLine && levelLine < verifiesLine &&
      verifiesLine < labelsLine,
    true,
  );
});

Deno.test("format: canonical order for element family", () => {
  const md = `# Elements

- [braking::foo] Foo

  Body.

  Labels: rust\\
  Part-of: braking\\
  Element-id: 01HGW3D6QRST7JKMNPQRSTVWXY\\
  Element-kind: unit\\
  Realizes: SRS_BRK_0001
`;
  const result = format(md, { generateUlid: mockUlid });
  const lines = result.output.split("\n");
  const elIdLine = lines.findIndex((l) => l.trim().startsWith("Element-id:"));
  const kindLine = lines.findIndex((l) => l.trim().startsWith("Element-kind:"));
  const partLine = lines.findIndex((l) => l.trim().startsWith("Part-of:"));
  const realizesLine = lines.findIndex((l) => l.trim().startsWith("Realizes:"));
  const labelsLine = lines.findIndex((l) => l.trim().startsWith("Labels:"));
  assertEquals(
    elIdLine < kindLine && kindLine < partLine &&
      partLine < realizesLine && realizesLine < labelsLine,
    true,
  );
});

// ---------------------------------------------------------------------------
// Phase 4b — CSV → multi-line canonicalization for repeatable types
// ---------------------------------------------------------------------------

Deno.test("format: Derived-from CSV splits into multi-line", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Derived-from: SYS_BRK_0042, SYS_BRK_0043
`;
  const result = format(md);
  assertEquals(result.changed, true);
  const derivedLines = result.output.split("\n").filter((l) =>
    l.trim().startsWith("Derived-from:")
  );
  assertEquals(derivedLines.length, 2);
  assertStringIncludes(derivedLines[0], "SYS_BRK_0042");
  assertStringIncludes(derivedLines[1], "SYS_BRK_0043");
});

Deno.test("format: Labels CSV splits into multi-line", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Labels: ASIL-B, safety, automotive
`;
  const result = format(md);
  assertEquals(result.changed, true);
  const labelLines = result.output.split("\n").filter((l) =>
    l.trim().startsWith("Labels:")
  );
  assertEquals(labelLines.length, 3);
});

Deno.test("format: References (citation) does NOT CSV-split", () => {
  // References is a citation type — locators may contain commas, so the
  // formatter must keep the value intact.
  const md = `# Test

- [SRS_BRK_0001] Title

  Body.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  References: ISO-26262-6 §9.4, Table 7
`;
  const result = format(md);
  const refLines = result.output.split("\n").filter((l) =>
    l.trim().startsWith("References:")
  );
  assertEquals(refLines.length, 1);
  assertStringIncludes(refLines[0], "§9.4, Table 7");
});

Deno.test("format: multi-line repeatable attributes are preserved", () => {
  // Input is already multi-line; formatter keeps it that way (idempotent).
  const md = `# Test

- [SRS_BRK_0001] Title

  Body.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Derived-from: SYS_BRK_0042\\
  Derived-from: SYS_BRK_0043
`;
  const result = format(md);
  assertEquals(result.changed, false);
  assertEquals(result.output, md);
});

Deno.test("format: CSV + multi-line mixed input canonicalizes to all multi-line", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Labels: ASIL-B, safety\\
  Labels: automotive
`;
  const result = format(md);
  assertEquals(result.changed, true);
  const labelLines = result.output.split("\n").filter((l) =>
    l.trim().startsWith("Labels:")
  );
  assertEquals(labelLines.length, 3);
});

Deno.test("format: CSV expansion is idempotent (double-format = single)", () => {
  const md = `# Test

- [SRS_BRK_0001] Title

  Body.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF\\
  Derived-from: SYS_BRK_0042, SYS_BRK_0043\\
  Labels: ASIL-B, safety
`;
  const first = format(md);
  const second = format(first.output);
  assertEquals(second.changed, false);
  assertEquals(second.output, first.output);
});

// ---------------------------------------------------------------------------
// Phase 4c — front-matter canonical form
// ---------------------------------------------------------------------------

Deno.test("format: front matter with core keys is canonicalized", () => {
  const md = `---
status: approved
document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR
document-type: requirements
---

# Title

- [SRS_BRK_0001] Entry

  Body.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const result = format(md);
  assertEquals(result.changed, true);
  // document-id should come before document-type, then status.
  const docIdIdx = result.output.indexOf("document-id:");
  const docTypeIdx = result.output.indexOf("document-type:");
  const statusIdx = result.output.indexOf("status:");
  assertEquals(docIdIdx < docTypeIdx, true);
  assertEquals(docTypeIdx < statusIdx, true);
});

Deno.test("format: front matter forbidden key removed with diagnostic", () => {
  const md = `---
document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR
title: Should be stripped
---

# Title

- [SRS_BRK_0001] Entry

  Body.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const result = format(md);
  assertEquals(result.output.includes("title:"), false);
  const d001 = result.diagnostics.find((d) => d.code === "MSL-D001");
  assertEquals(d001 != null, true);
});

Deno.test("format: front matter metadata map is preserved verbatim", () => {
  const md = `---
document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR
metadata:
  owner: safety-team
  jira-epic: PROJ-123
---

# Title

- [SRS_BRK_0001] Entry

  Body.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const result = format(md);
  assertStringIncludes(result.output, "owner: safety-team");
  assertStringIncludes(result.output, "jira-epic: PROJ-123");
});

Deno.test("format: front matter without any body entries still canonicalizes", () => {
  const md = `---
status: draft
document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR
---

# Just a heading

Some prose.
`;
  const result = format(md);
  assertEquals(result.changed, true);
  const docIdIdx = result.output.indexOf("document-id:");
  const statusIdx = result.output.indexOf("status:");
  assertEquals(docIdIdx < statusIdx, true);
});

Deno.test("format: no front matter leaves input untouched", () => {
  const md = `# Just a heading

Some prose.
`;
  const result = format(md);
  assertEquals(result.changed, false);
  assertEquals(result.output, md);
});

Deno.test("format: front matter idempotent on already-canonical input", () => {
  const md = `---
document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR
document-type: requirements
status: approved
---

# Title

- [SRS_BRK_0001] Entry

  Body.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const first = format(md);
  const second = format(first.output);
  assertEquals(second.changed, false);
  assertEquals(second.output, first.output);
});
