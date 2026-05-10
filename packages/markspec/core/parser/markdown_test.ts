/**
 * @module parser/markdown_test
 *
 * Unit tests for the Markdown entry parser. Exercises display-ID
 * extraction, attribute-block parsing, and shape discrimination by `Id:`
 * value format per the language spec Part 2.4.
 */

import { assertEquals, assertExists } from "@std/assert";
import { parseMarkdown } from "./markdown.ts";

const ULID = "01HGW2Q8MNP3RSTVWXYZABCDEF";

// ---------------------------------------------------------------------------
// Display ID and title
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: extracts display ID and title", () => {
  const md = `- [REQ-001] Sensor debouncing

  Body paragraph.

  Id: ${ULID}
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertExists(entry);
  assertEquals(entry.displayId, "REQ-001");
  assertEquals(entry.title, "Sensor debouncing");
});

Deno.test("parseMarkdown: strips leading @ from display ID (Pandoc compat)", () => {
  const md = `- [@ISO-26262-6] ISO 26262 Part 6

  Body.

  Id: urn:iso:std:iso:26262:-6:ed-2
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertExists(entry);
  assertEquals(entry.displayId, "ISO-26262-6");
  assertEquals(entry.shape, "referenced");
});

Deno.test("parseMarkdown: free-form symbolic display ID accepted", () => {
  const md = `- [braking_core::controller::debounce_input] Debounce

  Body.

  Id: ${ULID}
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertExists(entry);
  assertEquals(entry.displayId, "braking_core::controller::debounce_input");
  assertEquals(entry.shape, "identified");
});

// ---------------------------------------------------------------------------
// Shape discrimination by Id value format
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: ULID Id → shape=identified", () => {
  const md = `- [REQ-001] Title

  Body.

  Id: ${ULID}
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertEquals(entry.shape, "identified");
  assertEquals(entry.id, ULID);
});

Deno.test("parseMarkdown: URN URI → shape=referenced", () => {
  const md = `- [ISO-26262-6] Standard

  Body.

  Id: urn:iso:std:iso:26262:-6:ed-2
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertEquals(entry.shape, "referenced");
  assertEquals(entry.id, "urn:iso:std:iso:26262:-6:ed-2");
});

Deno.test("parseMarkdown: DOI URI → shape=referenced", () => {
  const md = `- [RFC-2119] Keywords

  Body.

  Id: doi:10.17487/RFC2119
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertEquals(entry.shape, "referenced");
});

Deno.test("parseMarkdown: purl URI → shape=referenced", () => {
  const md = `- [serde] Rust serialization

  Body.

  Id: pkg:cargo/serde@1.0.0
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertEquals(entry.shape, "referenced");
  assertEquals(entry.id, "pkg:cargo/serde@1.0.0");
});

Deno.test("parseMarkdown: HTTPS URL → shape=referenced", () => {
  const md = `- [RFC-2119] Keywords

  Body.

  Id: https://www.rfc-editor.org/rfc/rfc2119
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertEquals(entry.shape, "referenced");
});

Deno.test("parseMarkdown: malformed Id still parses (validator surfaces error)", () => {
  const md = `- [REQ-001] Title

  Body.

  Id: not-a-ulid-or-uri
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertExists(entry);
  // Parser accepts; shape falls back to identified so validator flags MSL-R004.
  assertEquals(entry.shape, "identified");
  assertEquals(entry.id, "not-a-ulid-or-uri");
});

// ---------------------------------------------------------------------------
// References document context
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: slug-shaped display ID in references.md → shape=referenced (no Id)", () => {
  const md = `- [ISO-26262-6] Standard

  Body.
`;
  const { entries: [entry] } = parseMarkdown(md, { file: "references.md" });
  assertExists(entry);
  assertEquals(entry.shape, "referenced");
  assertEquals(entry.id, undefined);
});

Deno.test("parseMarkdown: non-references doc without Id falls back to identified", () => {
  const md = `- [REQ-001] Title

  Body paragraph.
`;
  const { entries: [entry] } = parseMarkdown(md, { file: "requirements.md" });
  assertExists(entry);
  assertEquals(entry.shape, "identified");
  assertEquals(entry.id, undefined);
});

Deno.test("parseMarkdown: isReferencesDoc option overrides file-path detection", () => {
  const md = `- [serde] Rust crate

  Body.
`;
  const { entries: [entry] } = parseMarkdown(md, {
    file: "deps.md",
    isReferencesDoc: true,
  });
  assertExists(entry);
  assertEquals(entry.shape, "referenced");
});

// ---------------------------------------------------------------------------
// Attribute parsing
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: trailing attribute block is parsed", () => {
  const md = `- [REQ-001] Title

  Body.

  Id: ${ULID}\\
  Labels: one, two\\
  Supersedes: OLD-001
`;
  const { entries: [entry] } = parseMarkdown(md);
  const attrs = Object.fromEntries(
    entry.rawAttributes.map((a) => [a.key, a.value]),
  );
  assertEquals(attrs["Id"], ULID);
  assertEquals(attrs["Labels"], "one, two");
  assertEquals(attrs["Supersedes"], "OLD-001");
});

Deno.test("parseMarkdown: referenced entry body is optional", () => {
  const md = `- [ISO-26262-6] Standard

  Id: urn:iso:std:iso:26262:-6:ed-2
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertExists(entry);
  assertEquals(entry.shape, "referenced");
});

// ---------------------------------------------------------------------------
// Not-an-entry rejections
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: ordered list items are never entries", () => {
  const md = `1. [REQ-001] Not an entry

  Body.

  Id: ${ULID}
`;
  const { entries } = parseMarkdown(md);
  assertEquals(entries, []);
});

Deno.test("parseMarkdown: task list item is not an entry", () => {
  const md = `- [ ] Todo item
- [x] Done item
`;
  const { entries } = parseMarkdown(md);
  assertEquals(entries, []);
});

Deno.test("parseMarkdown: inline-link list item is not an entry", () => {
  const md = `- [MarkSpec](https://example.com) a tool
`;
  const { entries } = parseMarkdown(md);
  assertEquals(entries, []);
});

Deno.test("parseMarkdown: shortcut-ref with matching definition is not an entry", () => {
  const md = `- [CommonMark] is the baseline grammar.

[CommonMark]: https://commonmark.org
`;
  const { entries } = parseMarkdown(md);
  assertEquals(entries, []);
});

Deno.test("parseMarkdown: identified list item with only title (no body) is skipped", () => {
  const md = `- [REQ-001] Title only
`;
  const { entries } = parseMarkdown(md);
  assertEquals(entries, []);
});

// ---------------------------------------------------------------------------
// Multiple entries + source location
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: extracts multiple entries in order", () => {
  const md = `# Doc

- [REQ-001] First

  Body.

  Id: ${ULID}

- [REQ-002] Second

  Body.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;
  const { entries } = parseMarkdown(md);
  assertEquals(entries.length, 2);
  assertEquals(entries[0].displayId, "REQ-001");
  assertEquals(entries[1].displayId, "REQ-002");
});

Deno.test("parseMarkdown: source location carries file path", () => {
  const md = `- [REQ-001] Title

  Body.

  Id: ${ULID}
`;
  const { entries: [entry] } = parseMarkdown(md, { file: "src/req.md" });
  assertEquals(entry.location.file, "src/req.md");
  assertEquals(entry.location.line, 1);
  assertEquals(entry.source, "markdown");
  assertEquals(entry.properties?.file?.path, "src/req.md");
});

// ---------------------------------------------------------------------------
// typedAttributes collation
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: typedAttributes collates repeatable values", () => {
  const md = `- [REQ-001] Title

  Body.

  Id: ${ULID}\\
  Labels: one\\
  Labels: two
`;
  const { entries: [entry] } = parseMarkdown(md);
  const labels = entry.typedAttributes?.get("Labels");
  assertEquals(labels, ["one", "two"]);
});
