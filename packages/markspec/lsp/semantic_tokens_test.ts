/**
 * @module lsp/semantic_tokens_test
 *
 * Unit tests for {@linkcode buildSemanticTokens} — produces LSP
 * semantic tokens for an entry's title, display IDs, attribute
 * keys, attribute values, and labels (with validity modifier).
 */

import { assertEquals } from "@std/assert";
import type { EffectiveProfile, Entry } from "../core/model/mod.ts";
import { makeDisplayId } from "../core/model/mod.ts";
import {
  buildSemanticTokens,
  SEMANTIC_TOKEN_LEGEND,
} from "./semantic_tokens.ts";

function makeEntry(): Entry {
  return {
    displayId: makeDisplayId("REQ-001"),
    title: "Brake response time",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Satisfies", value: "STK-001" },
      { key: "Labels", value: "ASIL-B, custom-label" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Satisfies", ["STK-001"]],
      ["Labels", ["ASIL-B", "custom-label"]],
    ]),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: "markdown",
  };
}

function makeProfile(allowedLabels: string[]): EffectiveProfile {
  // Minimal stub — only `labels` is consulted by the builder.
  return {
    chain: [],
    labels: new Map(
      allowedLabels.map((name) => [
        name,
        {
          value: { name, kind: "enum" as const, values: [] },
          origin: "test",
        },
      ]),
    ),
  } as unknown as EffectiveProfile;
}

Deno.test("buildSemanticTokens: legend lists expected types and modifiers", () => {
  assertEquals(SEMANTIC_TOKEN_LEGEND.tokenTypes, [
    "class",
    "enum",
    "enumMember",
    "keyword",
    "property",
    "string",
  ]);
  assertEquals(SEMANTIC_TOKEN_LEGEND.tokenModifiers, [
    "declaration",
    "static",
    "modification",
  ]);
});

Deno.test("buildSemanticTokens: title line emits class + enum tokens", () => {
  const text = ["- [REQ-001] Brake response time"].join("\n");
  const tokens = buildSemanticTokens(
    [makeEntry()],
    makeProfile([]),
    text.split("\n"),
  );
  // Title line carries: `[REQ-001]` (enum, declaration) and the title
  // text (class, declaration). Both use the *.declaration token shape so
  // themes paint them with the same colour family; the extension layers
  // a bold decoration on top of the title range for visual weight.
  const titleTokens = tokens.filter((t) => t.line === 0);
  assertEquals(titleTokens.length, 2);
  assertEquals(titleTokens[0].tokenType, "enum");
  assertEquals(titleTokens[0].tokenModifiers, ["declaration"]);
  assertEquals(titleTokens[0].startChar, 3); // after `- [`
  assertEquals(titleTokens[0].length, 7); // `REQ-001`
  assertEquals(titleTokens[1].tokenType, "class");
  assertEquals(titleTokens[1].tokenModifiers, ["declaration"]);
  assertEquals(titleTokens[1].startChar, 12); // after `- [REQ-001] `
  assertEquals(titleTokens[1].length, "Brake response time".length);
});

Deno.test("buildSemanticTokens: trailer Id emits property + enumMember (uniform with trace attrs)", () => {
  const text = [
    "- [REQ-001] Brake response time",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
  ].join("\n");
  const tokens = buildSemanticTokens(
    [makeEntry()],
    makeProfile([]),
    text.split("\n"),
  );
  const idLineTokens = tokens.filter((t) => t.line === 2);
  assertEquals(idLineTokens.length, 2);
  assertEquals(idLineTokens[0].tokenType, "property");
  assertEquals(idLineTokens[0].tokenModifiers, ["static"]);
  // ULID matches the display-ID grammar — no special case, gets the
  // same enumMember token as cross-references in trace attributes.
  assertEquals(idLineTokens[1].tokenType, "enumMember");
});

Deno.test("buildSemanticTokens: Satisfies value tokenizes the display ID as enumMember", () => {
  const text = [
    "- [REQ-001] Brake response time",
    "",
    "      Satisfies: STK-001",
  ].join("\n");
  const tokens = buildSemanticTokens(
    [makeEntry()],
    makeProfile([]),
    text.split("\n"),
  );
  const satisfiesLine = tokens.filter((t) => t.line === 2);
  // property (key) + enumMember (the ID — no separate string token because the value IS the ID)
  const idToken = satisfiesLine.find((t) => t.tokenType === "enumMember");
  assertEquals(idToken !== undefined, true);
  assertEquals(idToken!.length, 7);
});

Deno.test("buildSemanticTokens: Labels value emits one enumMember per label", () => {
  const text = [
    "- [REQ-001] Brake response time",
    "",
    "      Labels: ASIL-B, custom-label",
  ].join("\n");
  const tokens = buildSemanticTokens(
    [makeEntry()],
    makeProfile(["ASIL-B"]),
    text.split("\n"),
  );
  const labelLine = tokens.filter((t) => t.line === 2);
  const labels = labelLine.filter((t) => t.tokenType === "enumMember");
  assertEquals(labels.length, 2);
  // ASIL-B is in the catalog — no modification modifier.
  assertEquals(labels[0].tokenModifiers, []);
  // custom-label is not in the catalog — modification modifier set.
  assertEquals(labels[1].tokenModifiers, ["modification"]);
});

Deno.test("buildSemanticTokens: empty profile catalog leaves all labels valid", () => {
  const text = [
    "- [REQ-001] Brake response time",
    "",
    "      Labels: ASIL-B, custom-label",
  ].join("\n");
  const tokens = buildSemanticTokens(
    [makeEntry()],
    makeProfile([]),
    text.split("\n"),
  );
  const labels = tokens.filter(
    (t) => t.line === 2 && t.tokenType === "enumMember",
  );
  assertEquals(labels.length, 2);
  assertEquals(labels[0].tokenModifiers, []);
  assertEquals(labels[1].tokenModifiers, []);
});

Deno.test("buildSemanticTokens: multi-entry file scopes trailer tokens to each entry", () => {
  // Two entries; the first's trailer must stop before the second's
  // title line, and the second must also receive its own title tokens.
  // Exercises the `endLineExclusive = sorted[i + 1].location.line - 1`
  // branch in the builder.
  const text = [
    "- [REQ-001] First", //                line 0 (entry 1 title)
    "  Body.", //                          line 1
    "", //                                  line 2
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF", // line 3
    "", //                                  line 4
    "- [REQ-002] Second", //                line 5 (entry 2 title)
    "  Body.", //                          line 6
    "", //                                  line 7
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG", // line 8
  ].join("\n");
  const entry1: Entry = {
    displayId: makeDisplayId("REQ-001"),
    title: "First",
    body: "",
    rawAttributes: [{ key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" }],
    typedAttributes: new Map([["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]]]),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: "markdown",
  };
  const entry2: Entry = {
    displayId: makeDisplayId("REQ-002"),
    title: "Second",
    body: "",
    rawAttributes: [{ key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEG" }],
    typedAttributes: new Map([["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEG"]]]),
    shape: "Authored",
    location: { file: "t.md", line: 6, column: 1 },
    source: "markdown",
  };
  const tokens = buildSemanticTokens(
    [entry1, entry2],
    makeProfile([]),
    text.split("\n"),
  );
  // Exactly two `class/declaration` title tokens — one per entry.
  const classTokens = tokens.filter(
    (t) => t.tokenType === "class" && t.tokenModifiers.includes("declaration"),
  );
  assertEquals(classTokens.length, 2);
  assertEquals(classTokens[0].line, 0);
  assertEquals(classTokens[1].line, 5);
  // Each title line also carries an enum/declaration token for the ID.
  const enumDeclTokens = tokens.filter(
    (t) => t.tokenType === "enum" && t.tokenModifiers.includes("declaration"),
  );
  assertEquals(enumDeclTokens.length, 2);
  assertEquals(enumDeclTokens[0].line, 0);
  assertEquals(enumDeclTokens[1].line, 5);
  // Trailer tokens for entry 1 live on line 3 and entry 2 on line 8.
  const propTokens = tokens.filter((t) => t.tokenType === "property");
  assertEquals(propTokens.length, 2);
  assertEquals(propTokens[0].line, 3);
  assertEquals(propTokens[1].line, 8);
});

Deno.test("buildSemanticTokens: plain-text attribute value gets a single string token", () => {
  // `ok` is 2 chars — fails the display-ID grammar's ≥3-char rule —
  // so the trailer scanner returns no idRanges and the builder falls
  // through to the plain-string branch.
  const text = [
    "- [REQ-001] Title",
    "",
    "      Note: ok",
  ].join("\n");
  const entry: Entry = {
    displayId: makeDisplayId("REQ-001"),
    title: "Title",
    body: "",
    rawAttributes: [{ key: "Note", value: "ok" }],
    typedAttributes: new Map([["Note", ["ok"]]]),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: "markdown",
  };
  const tokens = buildSemanticTokens(
    [entry],
    makeProfile([]),
    text.split("\n"),
  );
  const noteLine = tokens.filter((t) => t.line === 2);
  // Exactly: property (Note key) + string (ok value). No enumMember.
  assertEquals(noteLine.length, 2);
  assertEquals(noteLine[0].tokenType, "property");
  assertEquals(noteLine[0].tokenModifiers, ["static"]);
  assertEquals(noteLine[1].tokenType, "string");
  assertEquals(noteLine[1].length, 2); // "ok"
  const enumMembers = noteLine.filter((t) => t.tokenType === "enumMember");
  assertEquals(enumMembers.length, 0);
});

Deno.test("buildSemanticTokens: title with lowercase-hyphenated display ID still highlights", () => {
  // Regression guard: TITLE_LINE_RE must accept the same display-ID
  // grammar as the core parser (entry_trailer.ts, hover.ts, rename.ts).
  const text = ["- [my-entry] A title"].join("\n");
  const entry: Entry = {
    displayId: makeDisplayId("my-entry"),
    title: "A title",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: "markdown",
  };
  const tokens = buildSemanticTokens(
    [entry],
    makeProfile([]),
    text.split("\n"),
  );
  const titleTokens = tokens.filter((t) => t.line === 0);
  assertEquals(titleTokens.length, 2);
  assertEquals(titleTokens[0].tokenType, "enum");
  assertEquals(titleTokens[0].tokenModifiers, ["declaration"]);
  assertEquals(titleTokens[0].startChar, 3); // after `- [`
  assertEquals(titleTokens[0].length, "my-entry".length);
  assertEquals(titleTokens[1].tokenType, "class");
  assertEquals(titleTokens[1].tokenModifiers, ["declaration"]);
  assertEquals(titleTokens[1].length, "A title".length);
});

Deno.test("buildSemanticTokens: title with dotted display ID still highlights", () => {
  const text = ["- [my.entry] Dotted title"].join("\n");
  const entry: Entry = {
    displayId: makeDisplayId("my.entry"),
    title: "Dotted title",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: "markdown",
  };
  const tokens = buildSemanticTokens(
    [entry],
    makeProfile([]),
    text.split("\n"),
  );
  const titleTokens = tokens.filter((t) => t.line === 0);
  assertEquals(titleTokens.length, 2);
  assertEquals(titleTokens[0].tokenType, "enum");
  assertEquals(titleTokens[0].length, "my.entry".length);
  assertEquals(titleTokens[1].tokenType, "class");
});

Deno.test("buildSemanticTokens: title with slashed display ID still highlights", () => {
  const text = ["- [ns/entry] Slashed title"].join("\n");
  const entry: Entry = {
    displayId: makeDisplayId("ns/entry"),
    title: "Slashed title",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: "markdown",
  };
  const tokens = buildSemanticTokens(
    [entry],
    makeProfile([]),
    text.split("\n"),
  );
  const titleTokens = tokens.filter((t) => t.line === 0);
  assertEquals(titleTokens.length, 2);
  assertEquals(titleTokens[0].tokenType, "enum");
  assertEquals(titleTokens[0].length, "ns/entry".length);
  assertEquals(titleTokens[1].tokenType, "class");
});

Deno.test("buildSemanticTokens: body modal verbs emit keyword tokens", () => {
  const text = [
    "- [REQ-001] Title",
    "",
    "  The system shall respond when the brake pedal must trigger.",
  ].join("\n");
  const tokens = buildSemanticTokens(
    [makeEntry()],
    makeProfile([]),
    text.split("\n"),
  );
  const keywords = tokens.filter((t) => t.tokenType === "keyword");
  // Expected: "shall", "when", "must" — three keyword matches on line 2.
  assertEquals(keywords.length, 3);
  assertEquals(keywords.every((t) => t.line === 2), true);
  // First match is "shall" at the position of "shall " in the body line.
  const line = text.split("\n")[2];
  assertEquals(keywords[0].startChar, line.indexOf("shall"));
  assertEquals(keywords[0].length, "shall".length);
});

Deno.test("buildSemanticTokens: EARS triggers (When/While/If/Where) emit keyword tokens", () => {
  const text = [
    "- [REQ-001] Title",
    "",
    "  When the trigger fires, while the state holds,",
    "  if the guard passes, where the feature is on, then act.",
  ].join("\n");
  const tokens = buildSemanticTokens(
    [makeEntry()],
    makeProfile([]),
    text.split("\n"),
  );
  const keywords = tokens.filter((t) => t.tokenType === "keyword");
  // Expected matches: When, while, if, where, then — five EARS triggers
  // spread across two body lines.
  assertEquals(keywords.length, 5);
  const matched = keywords.map((t) =>
    text.split("\n")[t.line].slice(t.startChar, t.startChar + t.length)
      .toLowerCase()
  );
  assertEquals(matched, ["when", "while", "if", "where", "then"]);
});

Deno.test("buildSemanticTokens: trailer-line keywords are NOT tokenized as body keywords", () => {
  // A trailer value containing "shall" or "when" must not produce a
  // keyword token — trailer values already get their own treatment.
  const text = [
    "- [REQ-001] Title",
    "",
    "  Body has no keywords here.",
    "",
    "      Note: when in doubt, shall not exit.",
  ].join("\n");
  const entry: Entry = {
    displayId: makeDisplayId("REQ-001"),
    title: "Title",
    body: "",
    rawAttributes: [{ key: "Note", value: "when in doubt, shall not exit." }],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: "markdown",
  };
  const tokens = buildSemanticTokens(
    [entry],
    makeProfile([]),
    text.split("\n"),
  );
  // Only the body line (line index 2) had no modal/EARS words, so
  // zero keyword tokens.
  const keywords = tokens.filter((t) => t.tokenType === "keyword");
  assertEquals(keywords.length, 0);
});

Deno.test("buildSemanticTokens: $Identifier entity refs in body emit string tokens", () => {
  const text = [
    "- [REQ-001] Title",
    "",
    "  Uses $BrakeController to read $rawPressure.",
  ].join("\n");
  const tokens = buildSemanticTokens(
    [makeEntry()],
    makeProfile([]),
    text.split("\n"),
  );
  const stringTokens = tokens.filter(
    (t) => t.tokenType === "string" && t.line === 2,
  );
  assertEquals(stringTokens.length, 2);
  const line = text.split("\n")[2];
  assertEquals(stringTokens[0].startChar, line.indexOf("$BrakeController"));
  assertEquals(stringTokens[0].length, "$BrakeController".length);
  assertEquals(stringTokens[1].startChar, line.indexOf("$rawPressure"));
  assertEquals(stringTokens[1].length, "$rawPressure".length);
});

Deno.test("buildSemanticTokens: $$math$$ fence interior is not tokenized as entity refs", () => {
  const text = [
    "- [REQ-001] Title",
    "",
    "  See $$a + b$$ and $foo.",
  ].join("\n");
  const tokens = buildSemanticTokens(
    [makeEntry()],
    makeProfile([]),
    text.split("\n"),
  );
  // Only `$foo` should be tokenized; the `$a` and `$b` inside `$$..$$`
  // are math, not entity refs. The trailing-`$` guard discards `$b`,
  // but `$a` immediately after `$$` is also discarded by the same
  // guard (the preceding char is `$`).
  const stringTokens = tokens.filter(
    (t) => t.tokenType === "string" && t.line === 2,
  );
  assertEquals(stringTokens.length, 1);
  assertEquals(stringTokens[0].length, "$foo".length);
});

Deno.test("buildSemanticTokens: Gherkin sections emit class tokens, steps emit keyword tokens", () => {
  const text = [
    "- [REQ-001] Title",
    "",
    "  Scenario follows:",
    "",
    "  ```feature",
    "  Feature: Braking",
    "    Scenario: stops in time",
    "      Given the speed is 60",
    "      When the obstacle appears",
    "      Then the system shall brake",
    "  ```",
    "",
    "  After the block, shall is still highlighted.",
  ].join("\n");
  const tokens = buildSemanticTokens(
    [makeEntry()],
    makeProfile([]),
    text.split("\n"),
  );
  // Sections (Feature, Scenario) → class tokens — matches GitHub
  // Linguist / Rouge convention of section-heading scope.
  const blockSectionTokens = tokens.filter(
    (t) => t.tokenType === "class" && t.line >= 5 && t.line <= 9,
  );
  assertEquals(blockSectionTokens.length, 2);
  // Steps (Given, When, Then) → keyword tokens.
  const blockStepTokens = tokens.filter(
    (t) => t.tokenType === "keyword" && t.line >= 5 && t.line <= 9,
  );
  assertEquals(blockStepTokens.length, 3);
  // Body modal verb after the block: "shall" on line 12.
  const modalTokens = tokens.filter(
    (t) => t.tokenType === "keyword" && t.line === 12,
  );
  assertEquals(modalTokens.length, 1);
});

Deno.test("buildSemanticTokens: inter-entry prose after trailer is NOT scanned for keywords", () => {
  // After an entry's trailer block, lines belong to inter-entry prose
  // (section headers, intro text for the next section) — not to the
  // entry's body. Keywords there must not be tokenized.
  const text = [
    "- [REQ-001] First entry",
    "",
    "  The system shall do X.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "",
    "## Next section header",
    "",
    "Intro prose that mentions shall, should, when, while — these must",
    "not be tokenized because they live between entries.",
    "",
    "- [REQ-002] Second entry",
    "",
    "  Another body that may use should.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG",
  ].join("\n");
  const entry1: Entry = {
    displayId: makeDisplayId("REQ-001"),
    title: "First entry",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: "markdown",
  };
  const entry2: Entry = {
    ...entry1,
    displayId: makeDisplayId("REQ-002"),
    title: "Second entry",
    // 1-based line 12 maps to 0-based index 11 — the "- [REQ-002] ..." line.
    location: { file: "t.md", line: 12, column: 1 },
  };
  const tokens = buildSemanticTokens(
    [entry1, entry2],
    makeProfile([]),
    text.split("\n"),
  );
  const keywords = tokens.filter((t) => t.tokenType === "keyword");
  // Expected: "shall" on line 2 (entry 1 body) and "may"+"should" on
  // line 13 (entry 2 body). NOT the words on line 8 (inter-entry prose).
  const onLine2 = keywords.filter((t) => t.line === 2);
  const onLine8 = keywords.filter((t) => t.line === 8);
  const onLine13 = keywords.filter((t) => t.line === 13);
  assertEquals(onLine2.length, 1);
  assertEquals(onLine8.length, 0);
  assertEquals(onLine13.length, 2);
});

Deno.test("buildSemanticTokens: outside feature blocks, Gherkin-only words are NOT keyworded", () => {
  // "Given" and "And" are Gherkin step keywords but not modal/EARS.
  // In plain body prose (no fenced feature block) they should NOT
  // emit keyword tokens.
  const text = [
    "- [REQ-001] Title",
    "",
    "  Given the input, and the conditions, perform the action.",
  ].join("\n");
  const tokens = buildSemanticTokens(
    [makeEntry()],
    makeProfile([]),
    text.split("\n"),
  );
  const keywords = tokens.filter((t) => t.tokenType === "keyword");
  // No modal verbs / EARS triggers in this sentence — zero keywords.
  assertEquals(keywords.length, 0);
});
