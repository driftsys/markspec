/**
 * @module parser/markdown_test
 *
 * Unit tests for the Markdown entry parser. Exercises display-ID
 * extraction, attribute-block parsing, and shape discrimination by `Id:`
 * value format per the language spec Part 2.4.
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { parseMarkdown } from "./markdown.ts";
import { buildBlockLineMap, type LineMap } from "./line_map.ts";
import { wrapAsListItem } from "./source.ts";
import { loadGherkin } from "../gherkin/load.ts";

// Gherkin tokens come from the AST, which exists once the parser is loaded.
await loadGherkin();

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

Deno.test("parseMarkdown: bodyToken positions are file-accurate", () => {
  // Regression test for #514: body token locations must match the actual
  // file content — line and column point to the token text in the source.
  const md = [
    "- [REQ-1] Title",
    "",
    "  The driver shall debounce $Sensor inputs.",
    "",
    `      Id: ${ULID}`,
  ].join("\n") + "\n";
  const lines = md.split("\n");
  const { entries } = parseMarkdown(md, { file: "test.md" });
  const tokens = entries[0].bodyTokens;

  // Every token's location must slice back to its text in the source.
  for (const t of tokens) {
    const fileLine = lines[t.location.line - 1];
    const actual = fileLine.slice(
      t.location.column - 1,
      t.location.column - 1 + t.text.length,
    );
    assertEquals(
      actual,
      t.text,
      `Token "${t.text}" at L${t.location.line}:${t.location.column} ` +
        `does not match file content "${actual}"`,
    );
  }

  // Spot-check specific positions:
  const modal = tokens.find((t) => t.kind === "modal")!;
  // "shall" is on line 3 (body paragraph), column 14 ("  The driver " = 13 chars)
  assertEquals(modal.location.line, 3);
  assertEquals(modal.location.column, 14);

  const entityRef = tokens.find((t) => t.kind === "entity-ref")!;
  // "$Sensor" starts at column 29 on line 3 ("  The driver shall debounce " = 29 chars)
  assertEquals(entityRef.location.line, 3);
  assertEquals(entityRef.location.column, 29);
});

Deno.test("parseMarkdown: gherkin bodyToken positions are file-accurate", () => {
  // Regression test for #514: gherkin tokens inside ```gherkin fences must
  // have file-accurate positions accounting for list-item indent.
  const md = [
    "- [REQ-1] Filter acceptance",
    "",
    "  The filter shall pass:",
    "",
    "  ```gherkin",
    "  Scenario: Spike rejection",
    "    Given a stable reading of 500",
    "    When a spike occurs",
    "    Then the output shall remain 500",
    "  ```",
    "",
    `      Id: ${ULID}`,
  ].join("\n") + "\n";
  const lines = md.split("\n");
  const { entries } = parseMarkdown(md, { file: "test.md" });
  const gherkinTokens = entries[0].bodyTokens.filter(
    (t) => t.kind === "gherkin-section" || t.kind === "gherkin-step",
  );

  // Every gherkin token must align with file content.
  for (const t of gherkinTokens) {
    const fileLine = lines[t.location.line - 1];
    const actual = fileLine.slice(
      t.location.column - 1,
      t.location.column - 1 + t.text.length,
    );
    assertEquals(
      actual,
      t.text,
      `Gherkin token "${t.text}" at L${t.location.line}:${t.location.column} ` +
        `does not match file content "${actual}"`,
    );
  }

  // At least one section and one step token should exist.
  assertEquals(gherkinTokens.some((t) => t.kind === "gherkin-section"), true);
  assertEquals(gherkinTokens.some((t) => t.kind === "gherkin-step"), true);
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

// ---------------------------------------------------------------------------
// typl fence extraction (ADR-019)
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: entry with typl fence populates entry.types", () => {
  const md = [
    "- [REQ_0001] Brake on close approach",
    "",
    "  When TTC drops below threshold the system shall brake.",
    "",
    "  ```typl",
    "  $Speed : signal float[0..300]",
    "  $Brake : command BrakeReq",
    "  type BrakeReq = { force_N: float[0..12000] }",
    "  ```",
    "",
    "      Id: 01HZZZ0000000000000000000A",
  ].join("\n");

  const { entries } = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 1);
  const entry = entries[0];

  assertExists(entry.types);
  assertEquals(entry.types?.bindings.length, 2);
  assertEquals(entry.types?.bindings[0].name, "$Speed");
  assertEquals(entry.types?.bindings[0].kind, "signal");
  assertEquals(entry.types?.bindings[1].name, "$Brake");
  assertEquals(entry.types?.bindings[1].kind, "command");
  assertEquals(entry.types?.typedefs.length, 1);
  assertEquals(entry.types?.typedefs[0].name, "BrakeReq");
});

Deno.test("parseMarkdown: entry without typl fence leaves entry.types undefined", () => {
  const md = [
    "- [REQ_0002] Simple requirement",
    "",
    "  Body text here.",
    "",
    "      Id: 01HZZZ0000000000000000000B",
  ].join("\n");
  const { entries } = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries[0].types, undefined);
});

Deno.test("parseMarkdown: typl parse error is bridged to file-relative diagnostic", () => {
  const md = [
    "- [REQ_0003] Bad typl",
    "",
    "  Body.",
    "",
    "  ```typl",
    "  $X : blah int[0..]",
    "  ```",
    "",
    "      Id: 01HZZZ0000000000000000000C",
  ].join("\n");
  const { diagnostics } = parseMarkdown(md, { file: "test.md" });
  const typlDiag = diagnostics.find((d) => d.code === "TYPL-007");
  assertExists(typlDiag);
  assertEquals(typlDiag.location?.file, "test.md");
  // Don't assert the exact line — the test would couple to indentation
  // details. The bridge correctness is unit-tested in bridge_test.ts; here
  // we just assert that a file is attached and the line is >= 1.
  assertEquals((typlDiag.location?.line ?? 0) >= 1, true);
});

Deno.test("parseMarkdown: multiple typl fences in one entry aggregate", () => {
  const md = [
    "- [REQ_0004] Two fences",
    "",
    "  Some prose.",
    "",
    "  ```typl",
    "  $A : signal",
    "  ```",
    "",
    "  More prose.",
    "",
    "  ```typl",
    "  $B : event",
    "  type T = int",
    "  ```",
    "",
    "      Id: 01HZZZ0000000000000000000D",
  ].join("\n");
  const { entries } = parseMarkdown(md, { file: "test.md" });
  const entry = entries[0];
  assertExists(entry.types);
  assertEquals(entry.types?.bindings.map((b) => b.name), ["$A", "$B"]);
  assertEquals(entry.types?.typedefs.length, 1);
  assertEquals(entry.types?.typedefs[0].name, "T");
});

// ---------------------------------------------------------------------------
// typl bullet-glossary extraction (ADR-019, PR 4)
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: entry with bullet-glossary typl populates entry.types", () => {
  const md = [
    "- [REQ_0010] Bullet glossary entry",
    "",
    "  Prose describing the requirement.",
    "",
    "  - $Speed     : signal float[0..300]",
    "  - $Brake     : command BrakeReq",
    "  - $Threshold : const 1.4",
    "  - type BrakeReq = { force_N: float[0..12000] }",
    "",
    "      Id: 01HZZZ0000000000000000000E",
  ].join("\n");

  const { entries } = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 1);
  const entry = entries[0];

  assertExists(entry.types);
  assertEquals(entry.types?.bindings.length, 3);
  assertEquals(entry.types?.bindings.map((b) => b.name), [
    "$Speed",
    "$Brake",
    "$Threshold",
  ]);
  assertEquals(entry.types?.typedefs.length, 1);
  assertEquals(entry.types?.typedefs[0].name, "BrakeReq");
});

Deno.test("parseMarkdown: bullet list with mixed typl and prose only extracts typl items", () => {
  const md = [
    "- [REQ_0011] Mixed list entry",
    "",
    "  The system has these signals:",
    "",
    "  - This is a regular bullet describing context.",
    "  - $Vehicle  : signal",
    "  - Another regular bullet.",
    "  - $Driver   : signal",
    "",
    "      Id: 01HZZZ0000000000000000000F",
  ].join("\n");

  const { entries } = parseMarkdown(md, { file: "test.md" });
  const entry = entries[0];

  assertExists(entry.types);
  assertEquals(entry.types?.bindings.length, 2);
  assertEquals(entry.types?.bindings.map((b) => b.name), [
    "$Vehicle",
    "$Driver",
  ]);
});

Deno.test("parseMarkdown: entry combining fence AND bullet typl aggregates both", () => {
  const md = [
    "- [REQ_0012] Combined surfaces",
    "",
    "  ```typl",
    "  $InFence : signal",
    "  ```",
    "",
    "  Some prose.",
    "",
    "  - $InBullet : event",
    "",
    "      Id: 01HZZZ0000000000000000000G",
  ].join("\n");

  const { entries } = parseMarkdown(md, { file: "test.md" });
  const entry = entries[0];

  assertExists(entry.types);
  assertEquals(entry.types?.bindings.length, 2);
  assertEquals(entry.types?.bindings.map((b) => b.name), [
    "$InFence",
    "$InBullet",
  ]);
});

Deno.test("parseMarkdown: bullet typl parse error is bridged to file-relative diagnostic", () => {
  const md = [
    "- [REQ_0013] Bad bullet typl",
    "",
    "  - $X : blah int[0..]",
    "",
    "      Id: 01HZZZ0000000000000000000H",
  ].join("\n");
  const { diagnostics } = parseMarkdown(md, { file: "test.md" });
  const typlDiag = diagnostics.find((d) => d.code === "TYPL-007");
  assertExists(typlDiag);
  assertEquals(typlDiag.location?.file, "test.md");
  assertEquals((typlDiag.location?.line ?? 0) >= 1, true);
});

// ---------------------------------------------------------------------------
// typl inline backtick extraction (ADR-019, PR 5)
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: entry with inline typl spans populates entry.types", () => {
  const md = [
    "- [REQ_0020] Inline typl entry",
    "",
    "  The `$Speed : signal float[0..300]` shall update at 50 Hz, and",
    "  the controller publishes `$Brake : command BrakeReq` on overrun.",
    "",
    "  Type definition: `type BrakeReq = { force_N: float[0..12000] }`.",
    "",
    "      Id: 01HZZZ0000000000000000000I",
  ].join("\n");

  const { entries } = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 1);
  const entry = entries[0];

  assertExists(entry.types);
  assertEquals(entry.types?.bindings.length, 2);
  assertEquals(entry.types?.bindings.map((b) => b.name).sort(), [
    "$Brake",
    "$Speed",
  ]);
  assertEquals(entry.types?.typedefs.length, 1);
  assertEquals(entry.types?.typedefs[0].name, "BrakeReq");
});

Deno.test("parseMarkdown: code-span that is NOT typl syntax is ignored", () => {
  const md = [
    "- [REQ_0021] Mixed prose",
    "",
    "  The function `compute(x, y)` returns a value, and the constant",
    "  `MAX_SPEED` is defined elsewhere. No typl bindings here.",
    "",
    "      Id: 01HZZZ0000000000000000000J",
  ].join("\n");
  const { entries } = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries[0].types, undefined);
});

Deno.test("parseMarkdown: entry combining fence, bullet AND inline typl aggregates all", () => {
  const md = [
    "- [REQ_0022] All three surfaces",
    "",
    "  ```typl",
    "  $InFence : signal",
    "  ```",
    "",
    "  - $InBullet : event",
    "",
    "  And the inline form: `$InInline : command`.",
    "",
    "      Id: 01HZZZ0000000000000000000K",
  ].join("\n");

  const { entries } = parseMarkdown(md, { file: "test.md" });
  const entry = entries[0];

  assertExists(entry.types);
  assertEquals(entry.types?.bindings.length, 3);
  assertEquals(entry.types?.bindings.map((b) => b.name).sort(), [
    "$InBullet",
    "$InFence",
    "$InInline",
  ]);
});

Deno.test("parseMarkdown: inline typl parse error is bridged to file-relative diagnostic", () => {
  const md = [
    "- [REQ_0023] Bad inline typl",
    "",
    "  The `$X : blah int[0..]` is not a valid typl declaration.",
    "",
    "      Id: 01HZZZ0000000000000000000L",
  ].join("\n");
  const { diagnostics } = parseMarkdown(md, { file: "test.md" });
  const typlDiag = diagnostics.find((d) => d.code === "TYPL-007");
  assertExists(typlDiag);
  assertEquals(typlDiag.location?.file, "test.md");
  assertEquals((typlDiag.location?.line ?? 0) >= 1, true);
});

// ---------------------------------------------------------------------------
// Soft-wrapped title lines (#686)
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: detects entry whose title soft-wraps onto a second line", () => {
  // A soft-wrapped title is one Markdown paragraph, so remark hands the
  // parser a single text node containing an embedded newline. The entry
  // must still be detected (previously silently skipped — #686), with the
  // wrapped title collapsed to a single logical line.
  const md = [
    "- [FREQ_0001] The system shall compute a very long descriptive title that",
    "  wraps onto a second physical line for readability",
    "",
    "  The system shall compute the value within 200 ms.",
    "",
    `      Id: ${ULID}`,
  ].join("\n");
  const { entries } = parseMarkdown(md, { file: "test.md" });
  assertEquals(entries.length, 1);
  const [entry] = entries;
  assertEquals(entry.displayId, "FREQ_0001");
  assertEquals(
    entry.title,
    "The system shall compute a very long descriptive title that wraps " +
      "onto a second physical line for readability",
  );
  // The wrapped continuation belongs to the title, not the body.
  assertEquals(entry.body, "The system shall compute the value within 200 ms.");
});

// ---------------------------------------------------------------------------
// Directive-comment-aware trailer scan (#687)
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: directive comment as last body element — no MSL-P022 (#687)", () => {
  // No-space form, body indent (2 spaces), trailer-adjacent.
  const bodyIndent = `- [STK_0001] Title

  Body prose within 200 ms.

  <!--markspec:pending Q-001-->

      Id: ${ULID}
`;
  // No-space form, trailer indent (6 spaces), directly above Id:.
  const trailerIndent = `- [STK_0002] Title

  Body prose within 200 ms.

      <!--markspec:pending Q-001-->
      Id: ${ULID}
`;
  for (const md of [bodyIndent, trailerIndent]) {
    const { diagnostics } = parseMarkdown(md);
    const p02x = diagnostics.filter((d) =>
      d.code === "MSL-P022" || d.code === "MSL-P021" || d.code === "MSL-P020"
    );
    assertEquals(p02x, []);
  }
});

Deno.test("parseMarkdown: directive comment mid-body — still clean (#687)", () => {
  const md = `- [STK_0003] Title

  Body prose within 200 ms.

  <!--markspec:pending Q-001-->

  Trailing prose so the comment is not the last body element.

      Id: ${ULID}
`;
  const { diagnostics } = parseMarkdown(md);
  assertEquals(diagnostics.filter((d) => d.code.startsWith("MSL-P02")), []);
});

Deno.test("parseMarkdown: real spaced-key trailer typo still MSL-P022 (#697 regression guard)", () => {
  const md = `- [STK_0004] Title

  Body prose within 200 ms.

      Verified by: tests/foo.rs
      Id: ${ULID}
`;
  const { diagnostics } = parseMarkdown(md);
  const p022 = diagnostics.filter((d) => d.code === "MSL-P022");
  assertEquals(p022.length, 1);
});

Deno.test("parseMarkdown: Markdown punctuation before a colon on the last body line is prose, not a trailer", () => {
  // Emphasis (`**Rationale:**`, `**Rationale**:`), a link (`[x](http://…)`),
  // inline code, and an autolink put Markdown punctuation in the text
  // before the colon. That text is never a trailer key, so no MSL-P022.
  const lastLines = [
    "**Rationale:** drivers behind need early warning.",
    "**Rationale**: drivers behind need early warning.",
    "See [the guide](http://example.com/guide) for details.",
    "Set `mode:fast` in the config.",
    "Contact <mailto:team@example.com> for help.",
  ];
  for (const last of lastLines) {
    const md = `- [STK_0010] Title

  The lamp shall light within 100 ms.

  ${last}

      Id: ${ULID}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code.startsWith("MSL-P02")),
      [],
      last,
    );
  }
});

Deno.test("parseMarkdown: a time, abbreviation or version before a colon on the last body line is prose, not a trailer", () => {
  // The formatter's 80-column wrap can put such a token at the start of
  // the last body line. A trailer key starts with a letter and never holds
  // `.`, `/`, `,`, `'` or `"`, so these lines raise no MSL-P022.
  const lastLines = [
    "10:30 UTC every day.",
    "e.g.: the rear lamp.",
    "v2.0: the second release.",
    "and/or: either case.",
    "Drivers' view: the lamp.",
  ];
  for (const last of lastLines) {
    const md = `- [STK_0011] Title

  The lamp shall light within 100 ms at
  ${last}

      Id: ${ULID}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code.startsWith("MSL-P02")),
      [],
      last,
    );
  }
});

Deno.test("parseMarkdown: a lowercase or underscored key on the last body line still raises MSL-P022", () => {
  for (const last of ["verified_by: tests/foo.rs", "Bad_Key: value"]) {
    const md = `- [STK_0012] Title

  Body prose within 200 ms.

      ${last}
      Id: ${ULID}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code === "MSL-P022").length,
      1,
      last,
    );
  }
});

// ---------------------------------------------------------------------------
// A trailer-like line directly under body prose is body text (#1034)
// ---------------------------------------------------------------------------

/** Malformed trailer-like lines that `markspec fmt` can wrap onto the last
 * body line, with the diagnostic each raises inside a trailer block. */
const MALFORMED_LAST_LINES: ReadonlyArray<[string, string]> = [
  ["below:", "MSL-P021"],
  ["architecture :", "MSL-P021"],
  ["some_signal_name: the speed.", "MSL-P022"],
];

Deno.test("parseMarkdown: a malformed trailer-like line directly under prose is body text, with no MSL-P021 or MSL-P022 (#1034)", () => {
  for (const [last] of MALFORMED_LAST_LINES) {
    const md = `- [STK_0030] Title

  The lamp shall follow the layout
  ${last}

      Id: ${ULID}
`;
    const { entries, diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code.startsWith("MSL-P02")),
      [],
      last,
    );
    assertEquals(entries[0].body, `The lamp shall follow the layout\n${last}`);
    assertEquals(
      entries[0].rawAttributes.map((a) => a.key),
      ["Id"],
      last,
    );
  }
});

Deno.test("parseMarkdown: a malformed trailer-like line under prose and a valid Key: value line is body text (#1034)", () => {
  for (const [last] of MALFORMED_LAST_LINES) {
    const md = `- [STK_0031] Title

  The lamp shall follow the layout
  Note: see annex A.
  ${last}

      Id: ${ULID}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code.startsWith("MSL-P02")),
      [],
      last,
    );
  }
});

Deno.test("parseMarkdown: a malformed line in an indented trailer block still raises MSL-P021 or MSL-P022 (#1034)", () => {
  for (const [last, code] of MALFORMED_LAST_LINES) {
    const md = `- [STK_0032] Title

  The lamp shall follow the layout.

      Id: ${ULID}
      ${last}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code === code).length,
      1,
      last,
    );
  }
});

Deno.test("parseMarkdown: a malformed line in an unindented trailer after a blank line still raises MSL-P021 or MSL-P022 (#1034)", () => {
  for (const [last, code] of MALFORMED_LAST_LINES) {
    const md = `- [STK_0033] Title

  The lamp shall follow the layout.

  Id: ${ULID}
  ${last}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code === code).length,
      1,
      last,
    );
  }
});

Deno.test("parseMarkdown: a malformed line in an Id run directly under prose still raises MSL-P021 or MSL-P022 (#1034)", () => {
  // The `Id:` line shows that the author meant a trailer, as in the
  // parser's trailer rule for an Id run under prose.
  for (const [last, code] of MALFORMED_LAST_LINES) {
    const md = `- [STK_0034] Title

  The lamp shall follow the layout.
  Id: ${ULID}
  ${last}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code === code).length,
      1,
      last,
    );
  }
});

Deno.test("parseMarkdown: a malformed line alone in the final paragraph still raises MSL-P021 or MSL-P022 (#1034)", () => {
  // A final paragraph after a blank line is a trailer paragraph when its
  // keys are recognized (`findTrailerStart`); it holds no other keys here.
  for (const [last, code] of MALFORMED_LAST_LINES) {
    const md = `- [STK_0035] Title

  The lamp shall follow the layout.

  ${last}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code === code).length,
      1,
      last,
    );
  }
});

Deno.test("parseMarkdown: a malformed line alone in a body paragraph above the trailer is body text (#1034)", () => {
  // The paragraph is not the final block, so the parser never reads it as
  // the trailer.
  for (const [last] of MALFORMED_LAST_LINES) {
    const md = `- [STK_0036] Title

  The lamp shall follow the layout.

  ${last}

      Id: ${ULID}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code.startsWith("MSL-P02")),
      [],
      last,
    );
  }
});

Deno.test("parseMarkdown: a wrapped Note: or Rationale: paragraph that ends in a trailer-like line is body text (#1034)", () => {
  for (const lead of ["Note", "Rationale"]) {
    for (const [last] of MALFORMED_LAST_LINES) {
      for (
        const body of [
          `The lamp shall follow the layout.\n\n  ${lead}: each section is\n  ${last}`,
          `${lead}: each section is\n  ${last}`,
        ]
      ) {
        const md = `- [STK_0037] Title\n\n  ${body}\n\n      Id: ${ULID}\n`;
        const { entries, diagnostics } = parseMarkdown(md);
        assertEquals(
          diagnostics.filter((d) => d.code.startsWith("MSL-P02")),
          [],
          md,
        );
        assertEquals(entries[0].id, ULID);
      }
    }
  }
});

Deno.test("parseMarkdown: a malformed Id or trace-relation key line directly under prose still raises MSL-P021 or MSL-P022 (#1034)", () => {
  for (
    const [last, code] of [
      ["Verified by: TST_1", "MSL-P022"],
      ["Derived from: STK_0001", "MSL-P022"],
      ["Satisfies:", "MSL-P021"],
      ["Satisfies :", "MSL-P021"],
      ["Id :", "MSL-P021"],
    ]
  ) {
    const md = `- [STK_0038] Title

  The lamp shall follow the layout
  ${last}

      Id: ${ULID}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code === code).length,
      1,
      last,
    );
  }
});

Deno.test("parseMarkdown: a lowercase trace key or another key directly under prose is body text (#1034)", () => {
  // The Id and trace-relation keys are compared case-sensitively.
  for (
    const last of ["satisfies:", "below:", "Example:", "Note:", "snake_key:"]
  ) {
    const md = `- [STK_0039] Title

  The lamp shall follow the layout
  ${last}

      Id: ${ULID}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code.startsWith("MSL-P02")),
      [],
      last,
    );
  }
});

Deno.test("parseMarkdown: a malformed line below an Id-like line under prose still raises MSL-P021 (#1034)", () => {
  for (const idLike of [`id: ${ULID}`, `Id : ${ULID}`]) {
    const md = `- [STK_0040] Title

  The lamp is on.
  ${idLike}
  below:
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code === "MSL-P021").length,
      1,
      idLike,
    );
  }
});

Deno.test("parseMarkdown: an indented malformed line directly under prose still raises MSL-P021 (#1034)", () => {
  const md = `- [STK_0041] Title

  The lamp shall follow the layout
      below:
`;
  const { diagnostics } = parseMarkdown(md);
  assertEquals(diagnostics.filter((d) => d.code === "MSL-P021").length, 1);
});

// ---------------------------------------------------------------------------
// P021 / P022 locate the offending trailer line, not the title line
// ---------------------------------------------------------------------------

Deno.test("parseMarkdown: MSL-P022 location is the offending trailer line", () => {
  const md = `# Doc

- [STK_0005] Title

  Body prose within 200 ms.

      Verified by: tests/foo.rs
      Id: ${ULID}
`;
  const { diagnostics } = parseMarkdown(md, { file: "a.md" });
  const p022 = diagnostics.filter((d) => d.code === "MSL-P022");
  assertEquals(p022.length, 1);
  assertEquals(p022[0].location, { file: "a.md", line: 7, column: 7 });
});

Deno.test("parseMarkdown: MSL-P021 empty `Key:` location is the offending trailer line", () => {
  const md = `- [STK_0006] Title

  Body prose within 200 ms.

      Satisfies:
`;
  const { diagnostics } = parseMarkdown(md, { file: "a.md" });
  const p021 = diagnostics.filter((d) => d.code === "MSL-P021");
  assertEquals(p021.length, 1);
  assertEquals(p021[0].location, { file: "a.md", line: 5, column: 7 });
});

Deno.test("parseMarkdown: MSL-P021 location after a multi-paragraph body", () => {
  const md = `- [STK_0007] Title

  Body prose within 200 ms.

  More prose.

      Satisfies:
`;
  const { diagnostics } = parseMarkdown(md, { file: "a.md" });
  const p021 = diagnostics.filter((d) => d.code === "MSL-P021");
  assertEquals(p021.length, 1);
  assertEquals(p021[0].location, { file: "a.md", line: 7, column: 7 });
});

Deno.test("parseMarkdown: MSL-P021 location translates through a doc-comment LineMap", () => {
  // Rust `///` block starting at file line 10, column 1 — each cleaned
  // line had `/// ` (4 chars) stripped.
  const cleaned = [
    "[SWE_0001] Title",
    "",
    "Body prose within 200 ms.",
    "",
    "    Satisfies:",
  ];
  const lineMap = buildBlockLineMap({
    startLine: 10,
    startColumn: 1,
    prefixWidths: cleaned.map(() => 4),
  });
  const { diagnostics } = parseMarkdown(wrapAsListItem(cleaned), {
    file: "lib.rs",
    lineMap,
  });
  const p021 = diagnostics.filter((d) => d.code === "MSL-P021");
  assertEquals(p021.length, 1);
  // `///     Satisfies:` — the key starts at file column 9 on line 14.
  assertEquals(p021[0].location, { file: "lib.rs", line: 14, column: 9 });
});

Deno.test("parseMarkdown: a trailer key typo with punctuation still raises MSL-P022", () => {
  // `.`, `/`, `,`, `'` or `"` in a key usually mean prose (`e.g.:`), but a
  // known trailer key with such a typo is a malformed trailer the author
  // meant to write. It must fail, as at #697, so the trace link is not
  // silently lost.
  for (
    const last of [
      "Satisfies.: STK_0002",
      "Verified.by: TST_1",
      "Verified/by: TST_1",
      ".Satisfies: STK_0002",
    ]
  ) {
    const md = `- [STK_0013] Title

  Body prose within 200 ms.

      ${last}
      Id: ${ULID}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code === "MSL-P022").length,
      1,
      last,
    );
  }
});

Deno.test("parseMarkdown: Markdown punctuation inside a key-like word on the last body line is prose", () => {
  // No whitespace and a leading letter, so only the Markdown punctuation
  // check stops the scan at these lines.
  for (const last of ["f(x): y", "Note*: x", "Note`: y", "a<b>: c"]) {
    const md = `- [STK_0014] Title

  The lamp shall light within 100 ms.

  ${last}

      Id: ${ULID}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code.startsWith("MSL-P02")),
      [],
      last,
    );
  }
});

Deno.test("parseMarkdown: a comma or quote inside a key-like word on the last body line is prose", () => {
  for (const last of ["rate,max: 5", '"mode": fast', "driver's: view"]) {
    const md = `- [STK_0015] Title

  The lamp shall light within 100 ms.

  ${last}

      Id: ${ULID}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code.startsWith("MSL-P02")),
      [],
      last,
    );
  }
});

Deno.test("parseMarkdown: the body of an item with three spaces after the marker is dedented to the item content", () => {
  const md = `-   [STK_0016] Title

    The lamp shall light within 100 ms
    at night.

        Id: ${ULID}
`;
  const { entries, diagnostics } = parseMarkdown(md);
  assertEquals(entries.length, 1);
  assertEquals(
    entries[0].body,
    "The lamp shall light within 100 ms\nat night.",
  );
  assertEquals(entries[0].id, ULID);
  assertEquals(diagnostics.filter((d) => d.severity === "error"), []);
});

Deno.test("parseMarkdown: body token columns follow the item content of a `-   [ID]` item", () => {
  // The body is indented by four spaces, so "shall" in "    The lamp shall"
  // starts at column 14 (1-based). A marker-plus-two indent would give 12.
  const md = `-   [STK_0017] Title

    The lamp shall light within 100 ms.

        Id: ${ULID}
`;
  const { entries } = parseMarkdown(md);
  const modal = entries[0].bodyTokens.find((t) => t.kind === "modal")!;
  assertEquals(modal.text, "shall");
  assertEquals(modal.location.line, 3);
  assertEquals(modal.location.column, 14);
});

Deno.test("parseMarkdown: a comma or quote typo of a known trailer key still raises MSL-P022", () => {
  for (
    const last of [
      "Verified,by: TST_1",
      "Verified'by: TST_1",
      'Satisfies": STK_0002',
    ]
  ) {
    const md = `- [STK_0018] Title

  Body prose within 200 ms.

      ${last}
      Id: ${ULID}
`;
    const { diagnostics } = parseMarkdown(md);
    assertEquals(
      diagnostics.filter((d) => d.code === "MSL-P022").length,
      1,
      last,
    );
  }
});

for (const newline of ["\n", "\r\n"]) {
  Deno.test(`parseMarkdown: nested fence cannot report misplaced trailers (#705, ${JSON.stringify(newline)})`, () => {
    const text = [
      "- [REQ_0705] Example",
      "",
      "  Prose before the example.",
      "",
      "  ````markdown",
      "  ```text",
      "      Satisfies: SYS_0001",
      "  ```",
      "  ````",
      "",
      "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
      "",
    ].join(newline);
    const result = parseMarkdown(text, { file: "example.md" });
    assertEquals(result.diagnostics.filter((d) => d.code === "MSL-P020"), []);
    assertEquals(result.entries.length, 1);
  });
  Deno.test(`parseMarkdown: live misplaced trailer after long list fence is diagnosed (#705, ${JSON.stringify(newline)})`, () => {
    const text = [
      "- [REQ_0705] Example",
      "",
      "  - ````markdown",
      "    ```",
      "    example",
      "",
      "  - Other",
      "",
      "  Satisfies: SYS_0001",
      "",
      "  Following prose.",
      "",
      "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
      "",
    ].join(newline);
    const result = parseMarkdown(text, { file: "example.md" });
    assertEquals(
      result.diagnostics.filter((d) => d.code === "MSL-P020").length,
      1,
    );
  });
}

// ---------------------------------------------------------------------------
// Git-style trailer block (#914, MSL-P023)
// ---------------------------------------------------------------------------

const INDENTED_ENTRY = `- [REQ-001] Title

  Body text.

      Id: ${ULID}
      Satisfies: REQ-002
`;

const GIT_STYLE_ENTRY = `- [REQ-001] Title

  Body text.

  Id: ${ULID}
  Satisfies: REQ-002
`;

Deno.test("parseMarkdown: git-style trailer yields the same entry as the indented form", () => {
  const a = parseMarkdown(INDENTED_ENTRY).entries[0];
  const b = parseMarkdown(GIT_STYLE_ENTRY).entries[0];
  assertEquals(b.rawAttributes, a.rawAttributes);
  assertEquals(b.body, a.body);
  assertEquals(b.id, a.id);
});

Deno.test("parseMarkdown: git-style trailer warns MSL-P023 at its first line", () => {
  const { diagnostics } = parseMarkdown(GIT_STYLE_ENTRY, { file: "a.md" });
  const found = diagnostics.filter((d) => d.code === "MSL-P023");
  assertEquals(found.length, 1);
  assertEquals(found[0].severity, "warning");
  assertEquals(found[0].location?.line, 5);
  assertEquals(found[0].location?.column, 3);
});

/** MSL-P023 diagnostics of `md`, as `[line, column]` pairs. */
function p023At(md: string): Array<[number?, number?]> {
  return parseMarkdown(md, { file: "a.md" }).diagnostics
    .filter((d) => d.code === "MSL-P023")
    .map((d) => [d.location?.line, d.location?.column]);
}

Deno.test("parseMarkdown: a tab-led git-style trailer warns MSL-P023", () => {
  const md =
    `- [REQ-001] Title\n\n  Body text.\n\n\tId: ${ULID}\n\tSatisfies: REQ-002\n`;
  const entry = parseMarkdown(md).entries[0];
  assertEquals(entry.id, ULID);
  assertEquals(p023At(md), [[5, 2]]);
});

Deno.test("parseMarkdown: canonical tab-indented trailers raise no MSL-P023", () => {
  for (const lead of ["\t  ", "\t\t"]) {
    const md =
      `- [REQ-001] Title\n\n  Body text.\n\n${lead}Id: ${ULID}\n${lead}Satisfies: REQ-002\n`;
    assertEquals(parseMarkdown(md).entries[0].id, ULID, JSON.stringify(lead));
    assertEquals(p023At(md), [], JSON.stringify(lead));
  }
});

Deno.test("parseMarkdown: MSL-P023 measures from a wide list marker's content", () => {
  const md = `-   [REQ-001] Title

    Body text.

    Id: ${ULID}
    Satisfies: REQ-002
`;
  assertEquals(p023At(md), [[5, 5]]);
  const indented = md.replace(/\n {4}(Id|Satisfies)/g, "\n        $1");
  assertEquals(p023At(indented), []);
});

Deno.test("parseMarkdown: a trailer with a later unindented line warns MSL-P023", () => {
  const md = `- [REQ-001] Title

  Body text.

      Id: ${ULID}
  Satisfies: REQ-002
`;
  assertEquals(parseMarkdown(md).entries[0].id, ULID);
  assertEquals(p023At(md), [[5, 7]]);
});

Deno.test("parseMarkdown: indented trailer raises no MSL-P023", () => {
  const { diagnostics } = parseMarkdown(INDENTED_ENTRY);
  assertEquals(diagnostics.filter((d) => d.code === "MSL-P023").length, 0);
});

Deno.test("parseMarkdown: trailer as the only content raises no MSL-P023 when indented", () => {
  const md = `- [REQ-001] Title

      Id: ${ULID}
      Satisfies: REQ-002
`;
  const { diagnostics } = parseMarkdown(md);
  assertEquals(diagnostics.filter((d) => d.code === "MSL-P023").length, 0);
});

Deno.test("parseMarkdown: non-core keys without Id stay body, no MSL-P023", () => {
  const md = `- [REQ-001] Title

  Body text.

  Note: keep this
  Status: draft
`;
  const { entries: [entry], diagnostics } = parseMarkdown(md);
  assertEquals(entry.rawAttributes.length, 0);
  assertEquals(entry.body, "Body text.\n\nNote: keep this\nStatus: draft");
  assertEquals(diagnostics.filter((d) => d.code === "MSL-P023").length, 0);
});

Deno.test("parseMarkdown: a line with a non Key: value line in the final paragraph stays body", () => {
  const md = `- [REQ-001] Title

  Body text.

  Satisfies: REQ-002
  some prose line
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertEquals(entry.rawAttributes.length, 0);
});

Deno.test("parseMarkdown: Key: value directly after prose stays body (#916)", () => {
  const md = `- [REQ-001] Title

  Body text.
  Satisfies: REQ-002
`;
  const { entries: [entry] } = parseMarkdown(md);
  assertEquals(entry.rawAttributes.length, 0);
  assertEquals(entry.body, "Body text.\nSatisfies: REQ-002");
});

Deno.test("parseMarkdown: legacy trailing-backslash trailer warns only as deprecated", () => {
  const md = `- [REQ-001] Title

  Body text.

  Id: ${ULID}\\
  Satisfies: REQ-002
`;
  const { diagnostics } = parseMarkdown(md);
  assertEquals(diagnostics.filter((d) => d.code === "MSL-P023").length, 0);
  assertEquals(
    diagnostics.filter((d) => d.code === "MSL-DEPRECATED-ATTR-001").length,
    1,
  );
});

Deno.test("parseMarkdown: MSL-P020 and MSL-P023 never fire for the same block", () => {
  const cases: Array<[string, string, string[]]> = [
    [
      "Id run directly under prose",
      `- [REQ-001] Title

  Body text.
  Id: ${ULID}
  Satisfies: REQ-002
`,
      ["MSL-P020"],
    ],
    ["separate unindented final paragraph", GIT_STYLE_ENTRY, ["MSL-P023"]],
    ["indented trailer", INDENTED_ENTRY, []],
  ];
  for (const [name, md, expected] of cases) {
    const codes = parseMarkdown(md).diagnostics
      .map((d) => d.code)
      .filter((c) => c === "MSL-P020" || c === "MSL-P023");
    assertEquals(codes, expected, name);
  }
});

Deno.test("parseMarkdown: MSL-P023 hint depends on a continuation line", () => {
  const plain =
    `- [REQ-001] Title\n\n  Body text.\n\n  Id: ${ULID}\n  Satisfies: REQ-002\n`;
  const cont =
    `- [REQ-001] Title\n\n  Body text.\n\n  Id: ${ULID}\n  Satisfies: REQ-002,\n    REQ-003\n`;
  const message = (md: string) =>
    parseMarkdown(md).diagnostics.find((d) => d.code === "MSL-P023")?.message;
  assertStringIncludes(message(plain) ?? "", "run `markspec fmt`");
  assertStringIncludes(message(cont) ?? "", "MSL-P021");
});

Deno.test("parseMarkdown: attributeLines gives the file line of each trailer value", () => {
  const md = [
    "- [REQ_1] Title",
    "",
    "  Body.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "      Labels: a",
  ].join("\n");
  const [entry] = parseMarkdown(md, { file: "f.md" }).entries;
  assertEquals(entry.attributeLines, [5, 6]);
});

Deno.test("parseMarkdown: a title-only item is dropped by default", () => {
  const { entries } = parseMarkdown("- [SRS_A_0001] Title\n", {
    file: "a.md",
  });
  assertEquals(entries, []);
});

// ---------------------------------------------------------------------------
// Nested entry-shaped item (#928, MSL-P024)
// ---------------------------------------------------------------------------

const NESTED_ENTRY = `- [REQ-001] Parent

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

  - [REQ-003] Child

    Child body.

        Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;

Deno.test("parseMarkdown: a nested entry does not give its Id to the parent (#928)", () => {
  const { entries } = parseMarkdown(NESTED_ENTRY, { file: "n.md" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].id, "01HGW2Q8MNP3RSTVWXYZABCDEF");
  assertEquals(entries[0].body, "Body.");
});

Deno.test("parseMarkdown: a nested entry directly under the trailer keeps the parent Id (#928)", () => {
  const text = NESTED_ENTRY.replace(
    "ABCDEF\n\n  - [REQ-003]",
    "ABCDEF\n  - [REQ-003]",
  );
  const { entries } = parseMarkdown(text, { file: "n.md" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].id, "01HGW2Q8MNP3RSTVWXYZABCDEF");
});

Deno.test("parseMarkdown: a nested entry raises one MSL-P024 warning at its line (#928)", () => {
  const { diagnostics } = parseMarkdown(NESTED_ENTRY, { file: "n.md" });
  const found = diagnostics.filter((d) => d.code === "MSL-P024");
  assertEquals(found.length, 1);
  assertEquals(found[0].severity, "warning");
  assertEquals(found[0].location?.line, 7);
  assertStringIncludes(found[0].message, "nested entry is not supported");
  assertEquals(diagnostics.some((d) => d.code === "MSL-P020"), false);
});

Deno.test("parseMarkdown: every nested entry is excluded, one MSL-P024 each (#928)", () => {
  const text = `- [REQ-001] Parent

  Body.

  - [REQ-003] A

    A body.

        Id: 01HGW2Q8MNP3RSTVWXYZABCDEG

  - [REQ-004] B

    B body.

    Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
`;
  const { entries, diagnostics } = parseMarkdown(text, { file: "n.md" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].id, undefined);
  assertEquals(entries[0].rawAttributes, []);
  // The ranges merge with the list that holds both items.
  assertEquals(entries[0].nestedEntryLines, [{ start: 5, end: 15 }]);
  assertEquals(
    diagnostics.filter((d) => d.code === "MSL-P024").map((d) =>
      d.location?.line
    ),
    [5, 11],
  );
  assertEquals(diagnostics.some((d) => d.code === "MSL-P020"), false);
});

Deno.test("parseMarkdown: the parent trailer below a nested entry stays the parent's (#928)", () => {
  const text = `${NESTED_ENTRY}
      Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
`.replace(
    "\n      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n\n  - [REQ-003]",
    "\n  - [REQ-003]",
  );
  const { entries } = parseMarkdown(text, { file: "n.md" });
  assertEquals(entries[0].id, "01HGW2Q8MNP3RSTVWXYZABCDEH");
});

// ---------------------------------------------------------------------------
// Nested entry-shaped item: review follow-ups (#928)
// ---------------------------------------------------------------------------

const ID_PARENT = "01HGW2Q8MNP3RSTVWXYZABCDEF";
const ID_CHILD = "01HGW2Q8MNP3RSTVWXYZABCDEG";

Deno.test("parseMarkdown: body tokens after a nested entry keep their file line (#928)", () => {
  const text = `- [REQ-001] Parent

  Body.

  - [REQ-003] Child

    Child body.

        Id: ${ID_CHILD}

  The system SHALL react.
`;
  const { entries } = parseMarkdown(text, { file: "n.md" });
  const modal = entries[0].bodyTokens.find((t) => t.kind === "modal");
  assertEquals(modal?.location.line, 11);
});

Deno.test("parseMarkdown: attribute lines after a nested entry are file lines (#928)", () => {
  const text = `- [REQ-001] Parent

  Body.

  - [REQ-003] Child

    Child body.

        Id: ${ID_CHILD}

      Id: ${ID_PARENT}
`;
  const { entries } = parseMarkdown(text, { file: "n.md" });
  assertEquals(entries[0].id, ID_PARENT);
  assertEquals(entries[0].attributeLines, [11]);
});

Deno.test("parseMarkdown: MSL-P024 names the move and the marker column (#928)", () => {
  const text = `- [REQ-001] Parent

  Body.

    - [REQ-003] Child

      Child body.
`;
  const { diagnostics } = parseMarkdown(text, { file: "n.md" });
  const found = diagnostics.filter((d) => d.code === "MSL-P024");
  assertEquals(found.length, 1);
  assertStringIncludes(found[0].message, "move it to the top level");
  assertEquals(found[0].location?.column, 5);
});

Deno.test("parseMarkdown: a nested entry in an ordered list is excluded too (#928)", () => {
  const text = `- [REQ-001] Parent

  Body.

      Id: ${ID_PARENT}

  1. [REQ-003] Child

     Child body.

         Id: ${ID_CHILD}
`;
  const { entries, diagnostics } = parseMarkdown(text, { file: "n.md" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].id, ID_PARENT);
  assertEquals(diagnostics.filter((d) => d.code === "MSL-P024").length, 1);
});

Deno.test("parseMarkdown: a wrapper item keeps its prose in the parent body (#928)", () => {
  const text = `- [REQ-001] Parent

  Body.

  - note about it

    - [REQ-003] Child

      Child body.

          Id: ${ID_CHILD}

    More note.
`;
  const { entries, diagnostics } = parseMarkdown(text, { file: "n.md" });
  assertStringIncludes(entries[0].body, "note about it");
  assertStringIncludes(entries[0].body, "More note.");
  assertEquals(entries[0].body.includes("Child body."), false);
  assertEquals(diagnostics.filter((d) => d.code === "MSL-P024").length, 1);
});

Deno.test("parseMarkdown: a marker-only wrapper holding two nested entries gives both ranges (#928)", () => {
  const text = `- [REQ-001] Parent

  Body.

  -
    - [REQ-003] A

      A body.

    - [REQ-004] B

      B body.
`;
  const { entries, diagnostics } = parseMarkdown(text, { file: "n.md" });
  assertEquals(entries[0].nestedEntryLines, [{ start: 5, end: 12 }]);
  assertEquals(
    diagnostics.filter((d) => d.code === "MSL-P024").map((d) =>
      d.location?.line
    ),
    [6, 10],
  );
});

Deno.test("parseMarkdown: only the outermost nested entry is reported (#928)", () => {
  const text = `- [REQ-001] Parent

  Body.

  - [REQ-003] Child

    Child body.

    - [REQ-004] Grandchild

      Grandchild body.
`;
  const { diagnostics } = parseMarkdown(text, { file: "n.md" });
  assertEquals(
    diagnostics.filter((d) => d.code === "MSL-P024").map((d) =>
      d.location?.line
    ),
    [5],
  );
});

Deno.test("parseMarkdown: a title-only parent with only a nested entry reports P030 and P024 (#928)", () => {
  const text = `- [REQ-001] Parent

  - [REQ-003] Child

    Child body.

        Id: ${ID_CHILD}
`;
  const { entries, diagnostics } = parseMarkdown(text, { file: "n.md" });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].id, undefined);
  const codes = diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-P030"), true);
  assertEquals(codes.filter((c) => c === "MSL-P024").length, 1);
});

Deno.test("parseMarkdown: a paragraph at the nested item's own indent is not the parent trailer (#928)", () => {
  // The marker `-   ` puts the child's content at column 6, the parent's
  // canonical trailer column.
  const text = `- [REQ-001] Parent

  Body.

  -   [REQ-003] Child

      Child body.

      Satisfies: REQ-009
`;
  const { entries } = parseMarkdown(text, { file: "n.md" });
  assertEquals(entries[0].rawAttributes, []);
});

Deno.test("parseMarkdown: a body paragraph that is not Key: Value stays the child's (#928)", () => {
  const text = `- [REQ-001] Parent

  Body.

  - [REQ-003] Child

    Child body.

      Some text here.
`;
  const { entries } = parseMarkdown(text, { file: "n.md" });
  assertEquals(entries[0].rawAttributes, []);
  assertEquals(entries[0].body, "Body.");
});

Deno.test("parseMarkdown: plain items next to a nested entry stay in the body (#928)", () => {
  const text = `- [REQ-001] Parent

  Body.

  -
    - plain before

    - [REQ-003] A

      A body.

    - plain after
`;
  const { entries } = parseMarkdown(text, { file: "n.md" });
  assertEquals(entries[0].nestedEntryLines, [{ start: 5, end: 12 }]);
  assertStringIncludes(entries[0].body, "plain before");
  assertStringIncludes(entries[0].body, "plain after");
});

Deno.test("parseMarkdown: a marker-only ordered wrapper goes with its nested entry (#928)", () => {
  const text = `- [REQ-001] Parent

  Body.

  1.
     - [REQ-003] A

       A body.
`;
  const { entries } = parseMarkdown(text, { file: "n.md" });
  assertEquals(entries[0].nestedEntryLines, [{ start: 5, end: 8 }]);
});

Deno.test("parseMarkdown: a wrapper with a paragraph keeps its marker and text (#928)", () => {
  const text = `- [REQ-001] Parent

  Body.

  -
    wrapper text

    - [REQ-003] A

      A body.
`;
  const { entries } = parseMarkdown(text, { file: "n.md" });
  assertEquals(entries[0].nestedEntryLines, [{ start: 5, end: 10 }]);
  assertStringIncludes(entries[0].body, "wrapper text");
});

Deno.test("parseMarkdown: body tokens keep their line when the body starts with the nested entry (#928)", () => {
  const text = `- [REQ-001] Parent

  - [REQ-003] Child

    Child body.

        Id: ${ID_CHILD}

  The system SHALL react.
`;
  const { entries } = parseMarkdown(text, { file: "n.md" });
  const modal = entries[0].bodyTokens.find((t) => t.kind === "modal");
  assertEquals(modal?.location.line, 9);
});

Deno.test("parseMarkdown: typl diagnostics after a nested entry report file lines (#928)", () => {
  const typl = ["  ```typl", "  $X : blah int[0..]", "  ```", ""];
  const plain = [
    "- [REQ_0003] Bad typl",
    "",
    "  Body.",
    "",
    ...typl,
  ].join("\n");
  const nested = [
    "- [REQ_0003] Bad typl",
    "",
    "  Body.",
    "",
    "  - [REQ_0004] Child",
    "",
    "    Child body.",
    "",
    "        Id: 01HZZZ0000000000000000000D",
    "",
    ...typl,
  ].join("\n");
  const base = parseMarkdown(plain, { file: "t.md" }).diagnostics.find((d) =>
    d.code === "TYPL-007"
  );
  const moved = parseMarkdown(nested, { file: "t.md" }).diagnostics.find((d) =>
    d.code === "TYPL-007"
  );
  assertEquals(moved?.location?.line, (base?.location?.line ?? 0) + 6);
});

// ---------------------------------------------------------------------------
// Content after the trailer (#985, MSL-P025)
// ---------------------------------------------------------------------------

const AFTER_TRAILER = `- [REQ-001] Parent

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

  - sibling plain
`;

Deno.test("parseMarkdown: a plain list item after the trailer raises MSL-P025 at its line (#985)", () => {
  const { entries, diagnostics } = parseMarkdown(AFTER_TRAILER, {
    file: "a.md",
  });
  const found = diagnostics.filter((d) => d.code === "MSL-P025");
  assertEquals(found.length, 1);
  assertEquals(found[0].severity, "warning");
  assertEquals(found[0].location?.line, 7);
  assertEquals(found[0].location?.column, 3);
  assertStringIncludes(found[0].message, "content after the trailer");
  assertStringIncludes(found[0].message, "above the trailer");
  assertEquals(diagnostics.some((d) => d.code === "MSL-P020"), false);
  assertEquals(entries[0].contentAfterTrailerLine, 7);
});

Deno.test("parseMarkdown: a paragraph after the trailer raises MSL-P025 (#985)", () => {
  const text = AFTER_TRAILER.replace("  - sibling plain", "  More prose.");
  const { diagnostics } = parseMarkdown(text, { file: "a.md" });
  const found = diagnostics.filter((d) => d.code === "MSL-P025");
  assertEquals(found.map((d) => d.location?.line), [7]);
});

Deno.test("parseMarkdown: a canonical entry raises no MSL-P025 (#985)", () => {
  const text = AFTER_TRAILER.replace("\n  - sibling plain\n", "");
  const { entries, diagnostics } = parseMarkdown(text, { file: "a.md" });
  assertEquals(diagnostics.some((d) => d.code === "MSL-P025"), false);
  assertEquals(entries[0].contentAfterTrailerLine, undefined);
});

/** For `text`: its first entry, the lines of its MSL-P025 diagnostics, and
 * the codes of all its parse diagnostics. */
function p025(text: string) {
  const { entries, diagnostics } = parseMarkdown(text, { file: "a.md" });
  return {
    entry: entries[0],
    lines: diagnostics.filter((d) => d.code === "MSL-P025").map((d) =>
      d.location?.line
    ),
    codes: diagnostics.map((d) => d.code),
  };
}

Deno.test("parseMarkdown: a fenced Id: example followed by prose is not MSL-P025 (#985)", () => {
  const text =
    "- [REQ-001] Parent\n\n  Body.\n\n  ```\n  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n  ```\n\n  More prose.\n";
  const { lines, entry } = p025(text);
  assertEquals(lines, []);
  assertEquals(entry.contentAfterTrailerLine, undefined);
});

Deno.test("parseMarkdown: a Note:-only indented block followed by prose is not MSL-P025 (#985)", () => {
  const text = AFTER_TRAILER.replace(
    "Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "Note: some note text",
  ).replace("  - sibling plain", "  More prose.");
  assertEquals(p025(text).lines, []);
});

Deno.test("parseMarkdown: a trace-only Satisfies: block followed by prose keeps MSL-P020 (#985)", () => {
  const text = AFTER_TRAILER.replace(
    "Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "Satisfies: STK-001",
  ).replace("  - sibling plain", "  More prose.");
  const { lines, codes, entry } = p025(text);
  assertEquals(lines, []);
  assertEquals(codes.includes("MSL-P020"), true);
  assertEquals(entry.contentAfterTrailerLine, undefined);
});

Deno.test("parseMarkdown: an entry whose read trailer has an Id gets no MSL-P025 (#985)", () => {
  const text = `- [REQ-001] Parent

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

  More prose.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;
  const { lines, entry } = p025(text);
  assertEquals(entry.id, "01HGW2Q8MNP3RSTVWXYZABCDEG");
  assertEquals(lines, []);
});

Deno.test("parseMarkdown: an Id: block, content, then a trailer without Id is MSL-P025 (#985)", () => {
  const text = `- [REQ-001] Parent

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

  More prose.

      Labels: a
`;
  const { lines, entry, codes } = p025(text);
  assertEquals(entry.id, undefined);
  assertEquals(lines, [7]);
  assertEquals(codes.includes("MSL-P020"), false);
  assertEquals(entry.contentAfterTrailerLine, 7);
});

Deno.test("parseMarkdown: a block with a non-Key line is not MSL-P025 (#985)", () => {
  const text = AFTER_TRAILER.replace(
    "Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n      plain code line",
  );
  assertEquals(p025(text).lines, []);
});

Deno.test("parseMarkdown: content after the trailer plus a nested entry reports MSL-P024 only (#985)", () => {
  const text = AFTER_TRAILER.replace(
    "  - sibling plain\n",
    "  More prose.\n\n  - [REQ-003] Child\n\n    Child body.\n",
  );
  const { lines, codes } = p025(text);
  assertEquals(lines, []);
  assertEquals(codes.includes("MSL-P024"), true);
});

Deno.test("parseMarkdown: with two Id: blocks, MSL-P025 is at the content after the last one (#985)", () => {
  const text = `- [REQ-001] Parent

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

  Middle prose.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG

  Last prose.
`;
  assertEquals(p025(text).lines, [11]);
});

Deno.test("parseMarkdown: only an exact Id: key makes a block trailer-shaped for MSL-P025 (#985)", () => {
  for (const line of ["Ticket-Id: 42", "Note: see Id: x"]) {
    const text = AFTER_TRAILER.replace(
      "Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
      line,
    ).replace("  - sibling plain", "  More prose.");
    assertEquals(p025(text).lines, [], line);
  }
});

Deno.test("parseMarkdown: whitespace-only lines before the trailer are not body (#1022)", () => {
  const md = "- [REQ-0001] Title\n\n  Body line.\n   \n\t\n\n" +
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n";
  const { entries: [entry] } = parseMarkdown(md);
  assertEquals(entry.body, "Body line.");
});

Deno.test("parseMarkdown: CRLF whitespace-only lines before the trailer are not body (#1022)", () => {
  const md = "- [REQ-0001] Title\r\n\r\n  Body line.  \r\n   \r\n\t\r\n\r\n" +
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\r\n";
  const { entries: [entry] } = parseMarkdown(md);
  assertEquals(entry.body, "Body line.  ");
});

Deno.test("parseMarkdown: a closed fence before whitespace-only lines stays whole (#1022)", () => {
  const md =
    "- [REQ-0001] Title\n\n  Body line.\n\n  ```text\n  code\n  ```\n" +
    "   \n\t\n\n      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n";
  const { entries: [entry] } = parseMarkdown(md);
  assertEquals(entry.body, "Body line.\n\n```text\ncode\n```");
});
