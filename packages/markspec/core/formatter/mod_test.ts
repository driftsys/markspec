/**
 * @module formatter/mod_test
 *
 * Unit tests for the formatter. Exercises `Id:` stamping, CSV
 * expansion on repeatable universal attributes, canonical ordering,
 * and idempotent output.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { format, renderAttributeBlock } from "./mod.ts";

const MOCK_ULID = "01HGW2Q8MNP3RSTVWXYZABCDEF";
const MOCK_ULID_2 = "01HGW2Q8MNP3RSTVWXYZABCDEG";

function mockUlid(): () => string {
  const stack = [MOCK_ULID_2, MOCK_ULID];
  return () => stack.pop() ?? MOCK_ULID;
}

// ---------------------------------------------------------------------------
// Id auto-assignment
// ---------------------------------------------------------------------------

Deno.test("format: assigns Id to identified entry with no identity", () => {
  const md = `- [REQ-001] Title

  Body.
`;
  const result = format(md, { generateUlid: mockUlid() });
  assertEquals(result.changed, true);
  assertStringIncludes(result.output, `Id: ${MOCK_ULID}`);
});

Deno.test("format: existing Id is preserved", () => {
  const md = `- [REQ-001] Title

  Body.

  Id: ${MOCK_ULID}
`;
  const result = format(md);
  assertStringIncludes(result.output, `Id: ${MOCK_ULID}`);
  // Only the one Id appears (no duplicate assignment).
  const matches = result.output.match(/Id: /g) ?? [];
  assertEquals(matches.length, 1);
});

Deno.test("format: referenced entry without Id is NOT auto-assigned", () => {
  const md = `- [ISO-26262-6] Standard
`;
  const result = format(md, {
    file: "references.md",
    generateUlid: mockUlid(),
  });
  // Referenced entries' Id is a URI that must be author-provided.
  assertEquals(result.output.includes(MOCK_ULID), false);
});

Deno.test("format: emits MSL-F001 info diagnostic on Id assignment", () => {
  const md = `- [REQ-001] Title

  Body.
`;
  const result = format(md, { generateUlid: mockUlid() });
  const assigned = result.diagnostics.find((d) => d.code === "MSL-F001");
  assertEquals(assigned?.severity, "info");
  assertStringIncludes(assigned?.message ?? "", MOCK_ULID);
});

// ---------------------------------------------------------------------------
// Canonical ordering
// ---------------------------------------------------------------------------

Deno.test("format: canonical order places Id first, universal attrs last", () => {
  const md = `- [REQ-001] Title

  Body.

  Labels: important\\
  Id: ${MOCK_ULID}\\
  Supersedes: OLD-001
`;
  const result = format(md);
  const output = result.output;
  // Id: appears before Labels: and Supersedes:.
  const idIdx = output.indexOf("Id:");
  const labelsIdx = output.indexOf("Labels:");
  const supersedesIdx = output.indexOf("Supersedes:");
  assertEquals(idIdx >= 0, true);
  assertEquals(labelsIdx > idIdx, true);
  assertEquals(supersedesIdx > idIdx, true);
});

Deno.test("format: unknown (profile-declared) attributes preserved", () => {
  const md = `- [REQ-001] Title

  Body.

  Id: ${MOCK_ULID}\\
  Derived-from: PARENT-001\\
  Labels: one
`;
  const result = format(md);
  // Unknown keys survive the formatter — profile-aware validation handles
  // them separately.
  assertStringIncludes(result.output, "Derived-from: PARENT-001");
  assertStringIncludes(result.output, "Labels: one");
});

// ---------------------------------------------------------------------------
// CSV expansion on repeatable universal attrs
// ---------------------------------------------------------------------------

Deno.test("format: Labels CSV expands to multi-line", () => {
  const md = `- [REQ-001] Title

  Body.

  Id: ${MOCK_ULID}\\
  Labels: one, two, three
`;
  const result = format(md);
  assertStringIncludes(result.output, "Labels: one");
  assertStringIncludes(result.output, "Labels: two");
  assertStringIncludes(result.output, "Labels: three");
  // CSV on one line should no longer appear as such.
  assertEquals(result.output.includes("one, two, three"), false);
});

Deno.test("format: multi-line Labels preserved", () => {
  const md = `- [REQ-001] Title

  Body.

  Id: ${MOCK_ULID}\\
  Labels: one\\
  Labels: two
`;
  const result = format(md);
  assertStringIncludes(result.output, "Labels: one");
  assertStringIncludes(result.output, "Labels: two");
});

// ---------------------------------------------------------------------------
// Idempotence
// ---------------------------------------------------------------------------

Deno.test("format: output is idempotent (format twice = format once)", () => {
  const md = `- [REQ-001] Title

  Body.

  Id: ${MOCK_ULID}\\
  Labels: important
`;
  const once = format(md);
  const twice = format(once.output);
  assertEquals(twice.output, once.output);
});

Deno.test("format: unchanged-input does not mutate source", () => {
  const md = `- [REQ-001] Title

  Body.

      Id: ${MOCK_ULID}
`;
  const result = format(md);
  // Already canonical form — changed should be false.
  assertEquals(result.changed, false);
});

// ---------------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------------

Deno.test("format: preserves YAML front matter", () => {
  const md = `---
document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR
document-type: requirements
---

- [REQ-001] Title

  Body.

  Id: ${MOCK_ULID}
`;
  const result = format(md);
  assertStringIncludes(
    result.output,
    "document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR",
  );
  assertStringIncludes(result.output, "document-type: requirements");
});

// ---------------------------------------------------------------------------
// Multiple entries
// ---------------------------------------------------------------------------

Deno.test("format: assigns distinct Ids to multiple identified entries", () => {
  const md = `- [REQ-001] First

  Body.

- [REQ-002] Second

  Body.
`;
  const result = format(md, { generateUlid: mockUlid() });
  assertStringIncludes(result.output, `Id: ${MOCK_ULID}`);
  assertStringIncludes(result.output, `Id: ${MOCK_ULID_2}`);
});

// ---------------------------------------------------------------------------
// Empty / no-entry input
// ---------------------------------------------------------------------------

Deno.test("format: empty input returns unchanged", () => {
  const result = format("");
  assertEquals(result.changed, false);
  assertEquals(result.output, "");
});

Deno.test("format: markdown with no entries returns unchanged", () => {
  const md = `# Heading

Just prose.
`;
  const result = format(md);
  assertEquals(result.changed, false);
  assertEquals(result.output, md);
});

// ---------------------------------------------------------------------------
// renderAttributeBlock — indented code block emission
// ---------------------------------------------------------------------------

Deno.test("renderAttributeBlock: emits indented code block (4-space prefix, no backslash)", () => {
  const block = renderAttributeBlock(
    [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDE" },
      { key: "Satisfies", value: "SYS_BRK_0042" },
      { key: "Labels", value: "ASIL-B" },
    ],
    2, // body indent of a list-item entry
  );

  const expected =
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDE\n" +
    "      Satisfies: SYS_BRK_0042\n" +
    "      Labels: ASIL-B";

  assertEquals(block, expected);
});

Deno.test("renderAttributeBlock: doc-comment indent (no list wrapper)", () => {
  const block = renderAttributeBlock(
    [{ key: "Id", value: "01HGW3C4DEF6ABCDEFGHJKMNPQ" }],
    0, // doc comment, no list nesting
  );
  assertEquals(block, "    Id: 01HGW3C4DEF6ABCDEFGHJKMNPQ");
});
