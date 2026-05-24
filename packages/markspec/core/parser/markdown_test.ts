/**
 * @module parser/markdown_test
 *
 * Unit tests for the Markdown entry parser. Exercises display-ID
 * extraction, attribute-block parsing, and shape discrimination by `Id:`
 * value format per the language spec Part 2.4.
 */

import { assertEquals, assertExists } from "@std/assert";
import { parseMarkdown } from "./markdown.ts";
import type { LineMap } from "./line_map.ts";

const ULID = "01HGW2Q8MNP3RSTVWXYZABCDEF";

// ---------------------------------------------------------------------------
// Inline entity references ($Identifier — spec §2.5.2)
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: extracts $Identifier entity refs with conventions", () => {
  const md = `- [REQ-001] Sensor debouncing

  The $sensorDriver shall debounce $rawPressure within $DEBOUNCE_WINDOW
  for type $BrakeController to avoid spurious activation.

  Id: ${ULID}
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertExists(entry);
  // Since ADR-016, entity refs are surfaced via bodyTokens (entity-ref kind).
  const refs = entry.bodyTokens.filter((t) => t.kind === "entity-ref") as Array<
    { kind: "entity-ref"; text: string; convention: string }
  >;
  const byIdent = new Map(refs.map((r) => [r.text, r.convention]));
  assertEquals(byIdent.get("$sensorDriver"), "instance");
  assertEquals(byIdent.get("$rawPressure"), "instance");
  assertEquals(byIdent.get("$DEBOUNCE_WINDOW"), "constant");
  assertEquals(byIdent.get("$BrakeController"), "type");
  assertEquals(refs.length, 4);
});

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
  assertEquals(entry.shape, "Reference");
});

Deno.test("parseMarkdown: free-form symbolic display ID accepted", () => {
  const md = `- [braking_core::controller::debounce_input] Debounce

  Body.

  Id: ${ULID}
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertExists(entry);
  assertEquals(entry.displayId, "braking_core::controller::debounce_input");
  assertEquals(entry.shape, "Authored");
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
  assertEquals(entry.shape, "Authored");
  assertEquals(entry.id, ULID);
});

Deno.test("parseMarkdown: URN URI → shape=referenced", () => {
  const md = `- [ISO-26262-6] Standard

  Body.

  Id: urn:iso:std:iso:26262:-6:ed-2
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertEquals(entry.shape, "Reference");
  assertEquals(entry.id, "urn:iso:std:iso:26262:-6:ed-2");
});

Deno.test("parseMarkdown: DOI URI → shape=referenced", () => {
  const md = `- [RFC-2119] Keywords

  Body.

  Id: doi:10.17487/RFC2119
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertEquals(entry.shape, "Reference");
});

Deno.test("parseMarkdown: purl URI → shape=referenced", () => {
  const md = `- [serde] Rust serialization

  Body.

  Id: pkg:cargo/serde@1.0.0
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertEquals(entry.shape, "Reference");
  assertEquals(entry.id, "pkg:cargo/serde@1.0.0");
});

Deno.test("parseMarkdown: HTTPS URL → shape=referenced", () => {
  const md = `- [RFC-2119] Keywords

  Body.

  Id: https://www.rfc-editor.org/rfc/rfc2119
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertEquals(entry.shape, "Reference");
});

Deno.test("parseMarkdown: malformed Id still parses (validator surfaces error)", () => {
  const md = `- [REQ-001] Title

  Body.

  Id: not-a-ulid-or-uri
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertExists(entry);
  // Parser accepts; shape falls back to identified so validator flags MSL-R004.
  assertEquals(entry.shape, "Authored");
  assertEquals(entry.id, "not-a-ulid-or-uri");
});

// ---------------------------------------------------------------------------
// References document context
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: slug-shaped display ID in references.md → shape=referenced (no Id)", () => {
  const md = `- [ISO-26262-6] Standard

  Body.
`;
  const { entries: [entry] } = parseMarkdown(md, {
    file: "references.md",
    isReferencesDoc: true,
  });
  assertExists(entry);
  assertEquals(entry.shape, "Reference");
  assertEquals(entry.id, undefined);
});

Deno.test("parseMarkdown: non-references doc without Id falls back to identified", () => {
  const md = `- [REQ-001] Title

  Body paragraph.
`;
  const { entries: [entry] } = parseMarkdown(md, { file: "requirements.md" });
  assertExists(entry);
  assertEquals(entry.shape, "Authored");
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
  assertEquals(entry.shape, "Reference");
});

// ---------------------------------------------------------------------------
// Attribute parsing
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: trailing attribute block is parsed", () => {
  const md = `- [REQ-001] Title

  Body.

      Id: ${ULID}
      Labels: one, two
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
  assertEquals(entry.shape, "Reference");
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
  assertEquals(entry.source, { kind: "markdown" });
  assertEquals(entry.properties?.file?.path, "src/req.md");
});

// ---------------------------------------------------------------------------
// typedAttributes collation
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: typedAttributes collates repeatable values", () => {
  const md = `- [REQ-001] Title

  Body.

      Id: ${ULID}
      Labels: one
      Labels: two
`;
  const { entries: [entry] } = parseMarkdown(md);
  const labels = entry.typedAttributes?.get("Labels");
  assertEquals(labels, ["one", "two"]);
});

// ---------------------------------------------------------------------------
// Body tokens (ADR-016)
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: populates Entry.bodyTokens", () => {
  const md = `- [REQ-1] Title

  The driver shall debounce $Sensor inputs.

      Id: ${ULID}
`;
  const { entries } = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 1);
  const tokens = entries[0].bodyTokens;
  const kinds = tokens.map((t) => t.kind);
  // Body contains: shall (modal), $Sensor (entity-ref)
  assertEquals(kinds.includes("modal"), true);
  assertEquals(kinds.includes("entity-ref"), true);
});

// ---------------------------------------------------------------------------
// LineMap option (ADR-016 Decision 6)
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: applies lineMap to entry.location and bodyTokens", () => {
  const md = `- [STK_0001] Title

  The system shall do something.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  // Identity LineMap shifted by (+10, +0)
  const lineMap: LineMap = {
    translate: (l, c) => ({ line: l + 10, column: c }),
  };
  const { entries } = parseMarkdown(md, { file: "t.md", lineMap });
  assertEquals(entries.length, 1);
  // Entry was on buffer line 1 → file line 11
  assertEquals(entries[0].location.line, 11);
  // Body paragraph is at buffer line 3 (blank line separates title and body
  // in a CommonMark loose list) → file line 13.
  const modals = entries[0].bodyTokens.filter((t) => t.kind === "modal");
  assertEquals(modals.length, 1);
  assertEquals(modals[0].location.line, 13);
});

Deno.test("parseMarkdown: without lineMap, locations stay buffer-relative", () => {
  const md = `- [STK_0001] Title

  The system shall do something.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const { entries } = parseMarkdown(md, { file: "t.md" });
  assertEquals(entries[0].location.line, 1);
});
