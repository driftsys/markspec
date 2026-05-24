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
    source: { kind: "markdown" },
    bodyTokens: [],
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
    source: { kind: "markdown" },
    bodyTokens: [],
  };
  const entry2: Entry = {
    displayId: makeDisplayId("REQ-002"),
    title: "Second",
    body: "",
    rawAttributes: [{ key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEG" }],
    typedAttributes: new Map([["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEG"]]]),
    shape: "Authored",
    location: { file: "t.md", line: 6, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
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
    source: { kind: "markdown" },
    bodyTokens: [],
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
    source: { kind: "markdown" },
    bodyTokens: [],
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
    source: { kind: "markdown" },
    bodyTokens: [],
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
    source: { kind: "markdown" },
    bodyTokens: [],
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
  // bodyTokens are populated by the parser (body_tokens.ts). The LSP
  // builder consumes them and maps `modal` -> `keyword`.
  const text = [
    "- [REQ-001] Title",
    "",
    "  The system shall respond and must trigger.",
  ].join("\n");
  const entry = entryWithBodyTokens([
    {
      kind: "modal",
      text: "shall",
      case: "lower",
      location: { file: "t.md", line: 3, column: 14 },
    },
    {
      kind: "modal",
      text: "must",
      case: "lower",
      location: { file: "t.md", line: 3, column: 32 },
    },
  ]);
  const tokens = buildSemanticTokens(
    [entry],
    makeProfile([]),
    text.split("\n"),
  );
  const keywords = tokens.filter((t) => t.tokenType === "keyword");
  assertEquals(keywords.length, 2);
  assertEquals(keywords.every((t) => t.line === 2), true);
  const line = text.split("\n")[2];
  assertEquals(keywords[0].startChar, line.indexOf("shall"));
  assertEquals(keywords[0].length, "shall".length);
  assertEquals(keywords[1].startChar, line.indexOf("must"));
});

Deno.test("buildSemanticTokens: EARS triggers emit keyword tokens", () => {
  // bodyTokens populated by the parser; LSP maps `ears-trigger` -> `keyword`.
  const text = [
    "- [REQ-001] Title",
    "",
    "  When the trigger fires, the system acts.",
  ].join("\n");
  const entry = entryWithBodyTokens([
    {
      kind: "ears-trigger",
      text: "When",
      trigger: "When",
      location: { file: "t.md", line: 3, column: 3 },
    },
  ]);
  const tokens = buildSemanticTokens(
    [entry],
    makeProfile([]),
    text.split("\n"),
  );
  const keywords = tokens.filter((t) => t.tokenType === "keyword");
  assertEquals(keywords.length, 1);
  assertEquals(keywords[0].line, 2);
  assertEquals(keywords[0].startChar, 2);
  assertEquals(keywords[0].length, "When".length);
});

Deno.test("buildSemanticTokens: trailer-line keywords are NOT tokenized as body keywords", () => {
  // bodyTokens contain only body tokens — the parser does not emit
  // bodyTokens for words appearing inside trailer attribute values.
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
    source: { kind: "markdown" },
    bodyTokens: [],
  };
  const tokens = buildSemanticTokens(
    [entry],
    makeProfile([]),
    text.split("\n"),
  );
  const keywords = tokens.filter((t) => t.tokenType === "keyword");
  assertEquals(keywords.length, 0);
});

Deno.test("buildSemanticTokens: $Identifier entity refs in body emit string tokens", () => {
  // bodyTokens populated by the parser; LSP maps `entity-ref` -> `string`.
  const text = [
    "- [REQ-001] Title",
    "",
    "  Uses $BrakeController to read $rawPressure.",
  ].join("\n");
  const line = text.split("\n")[2];
  const entry = entryWithBodyTokens([
    {
      kind: "entity-ref",
      text: "$BrakeController",
      convention: "type",
      location: {
        file: "t.md",
        line: 3,
        column: line.indexOf("$BrakeController") + 1,
      },
    },
    {
      kind: "entity-ref",
      text: "$rawPressure",
      convention: "instance",
      location: {
        file: "t.md",
        line: 3,
        column: line.indexOf("$rawPressure") + 1,
      },
    },
  ]);
  const tokens = buildSemanticTokens(
    [entry],
    makeProfile([]),
    text.split("\n"),
  );
  const stringTokens = tokens.filter(
    (t) => t.tokenType === "string" && t.line === 2,
  );
  assertEquals(stringTokens.length, 2);
  assertEquals(stringTokens[0].startChar, line.indexOf("$BrakeController"));
  assertEquals(stringTokens[0].length, "$BrakeController".length);
  assertEquals(stringTokens[1].startChar, line.indexOf("$rawPressure"));
  assertEquals(stringTokens[1].length, "$rawPressure".length);
});

Deno.test("buildSemanticTokens: $$math$$ fence interior is not tokenized as entity refs", () => {
  // The parser excludes `$$..$$` math interior from entity-ref tokens;
  // only `$foo` outside math is emitted. The LSP just consumes the result.
  const text = [
    "- [REQ-001] Title",
    "",
    "  See $$a + b$$ and $foo.",
  ].join("\n");
  const line = text.split("\n")[2];
  const entry = entryWithBodyTokens([
    {
      kind: "entity-ref",
      text: "$foo",
      convention: "instance",
      location: { file: "t.md", line: 3, column: line.indexOf("$foo") + 1 },
    },
  ]);
  const tokens = buildSemanticTokens(
    [entry],
    makeProfile([]),
    text.split("\n"),
  );
  const stringTokens = tokens.filter(
    (t) => t.tokenType === "string" && t.line === 2,
  );
  assertEquals(stringTokens.length, 1);
  assertEquals(stringTokens[0].length, "$foo".length);
});

Deno.test("buildSemanticTokens: Gherkin sections emit class tokens, steps emit keyword tokens", () => {
  // The parser emits gherkin-section/gherkin-step inside ```feature
  // fences and `modal` outside; LSP maps these per ADR-016 Decision 8.
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
  const entry = entryWithBodyTokens([
    {
      kind: "gherkin-section",
      text: "Feature",
      location: { file: "t.md", line: 6, column: 3 },
    },
    {
      kind: "gherkin-section",
      text: "Scenario",
      location: { file: "t.md", line: 7, column: 5 },
    },
    {
      kind: "gherkin-step",
      text: "Given",
      location: { file: "t.md", line: 8, column: 7 },
    },
    {
      kind: "gherkin-step",
      text: "When",
      location: { file: "t.md", line: 9, column: 7 },
    },
    {
      kind: "gherkin-step",
      text: "Then",
      location: { file: "t.md", line: 10, column: 7 },
    },
    {
      kind: "modal",
      text: "shall",
      case: "lower",
      location: { file: "t.md", line: 13, column: 21 },
    },
  ]);
  const tokens = buildSemanticTokens(
    [entry],
    makeProfile([]),
    text.split("\n"),
  );
  const blockSectionTokens = tokens.filter(
    (t) => t.tokenType === "class" && t.line >= 5 && t.line <= 9,
  );
  assertEquals(blockSectionTokens.length, 2);
  const blockStepTokens = tokens.filter(
    (t) => t.tokenType === "keyword" && t.line >= 5 && t.line <= 9,
  );
  assertEquals(blockStepTokens.length, 3);
  const modalTokens = tokens.filter(
    (t) => t.tokenType === "keyword" && t.line === 12,
  );
  assertEquals(modalTokens.length, 1);
});

Deno.test("buildSemanticTokens: inter-entry prose after trailer is NOT scanned for keywords", () => {
  // Inter-entry prose lives between entries — the parser never emits
  // bodyTokens for it because it does not belong to any entry's body.
  // Each entry only carries bodyTokens for its own body content.
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
    source: { kind: "markdown" },
    bodyTokens: [
      {
        kind: "modal",
        text: "shall",
        case: "lower",
        location: { file: "t.md", line: 3, column: 14 },
      },
    ],
  };
  const entry2: Entry = {
    ...entry1,
    displayId: makeDisplayId("REQ-002"),
    title: "Second entry",
    location: { file: "t.md", line: 12, column: 1 },
    bodyTokens: [
      {
        kind: "modal",
        text: "may",
        case: "lower",
        location: { file: "t.md", line: 14, column: 22 },
      },
      {
        kind: "modal",
        text: "should",
        case: "lower",
        location: { file: "t.md", line: 14, column: 30 },
      },
    ],
  };
  const tokens = buildSemanticTokens(
    [entry1, entry2],
    makeProfile([]),
    text.split("\n"),
  );
  const keywords = tokens.filter((t) => t.tokenType === "keyword");
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

// ---------------------------------------------------------------------------
// ADR-016 Decision 8 — body tokens come from entry.bodyTokens, not from
// regex-scanning line text. The builder is a thin switch on BodyTokenKind.
// ---------------------------------------------------------------------------

function entryWithBodyTokens(
  bodyTokens: Entry["bodyTokens"],
): Entry {
  return {
    displayId: makeDisplayId("REQ-001"),
    title: "Title",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens,
  };
}

Deno.test("buildSemanticTokens: body keywords come from entry.bodyTokens, not regex scan", () => {
  // Body text has no modal/EARS words — a regex scanner would emit
  // nothing. The new implementation reads bodyTokens directly, so a
  // token placed by the parser still shows up.
  const text = [
    "- [REQ-001] Title",
    "",
    "  Plain prose without any keywords.",
  ].join("\n");
  const entry = entryWithBodyTokens([
    {
      kind: "modal",
      text: "shall",
      case: "lower",
      location: { file: "t.md", line: 3, column: 5 },
    },
  ]);
  const tokens = buildSemanticTokens(
    [entry],
    makeProfile([]),
    text.split("\n"),
  );
  const keywords = tokens.filter((t) => t.tokenType === "keyword");
  assertEquals(keywords.length, 1);
  assertEquals(keywords[0].line, 2);
  assertEquals(keywords[0].startChar, 4);
  assertEquals(keywords[0].length, "shall".length);
});

Deno.test("buildSemanticTokens: BodyTokenKind 'modal' maps to 'keyword'", () => {
  const entry = entryWithBodyTokens([
    {
      kind: "modal",
      text: "shall",
      case: "lower",
      location: { file: "t.md", line: 3, column: 3 },
    },
  ]);
  const tokens = buildSemanticTokens([entry], makeProfile([]), [
    "- [REQ-001] Title",
    "",
    "  shall be x.",
  ]);
  const body = tokens.filter((t) => t.line === 2);
  assertEquals(body.length, 1);
  assertEquals(body[0].tokenType, "keyword");
});

Deno.test("buildSemanticTokens: BodyTokenKind 'ears-trigger' maps to 'keyword'", () => {
  const entry = entryWithBodyTokens([
    {
      kind: "ears-trigger",
      text: "When",
      trigger: "When",
      location: { file: "t.md", line: 3, column: 3 },
    },
  ]);
  const tokens = buildSemanticTokens([entry], makeProfile([]), [
    "- [REQ-001] Title",
    "",
    "  When the trigger fires.",
  ]);
  const body = tokens.filter((t) => t.line === 2);
  assertEquals(body.length, 1);
  assertEquals(body[0].tokenType, "keyword");
});

Deno.test("buildSemanticTokens: BodyTokenKind 'gherkin-section' maps to 'class'", () => {
  // Wrap the Gherkin line in a feature fence so the trailer scanner
  // (which would otherwise treat "    Scenario: stops" as a trailer
  // attribute) skips it; the body token still emits a class token.
  const entry = entryWithBodyTokens([
    {
      kind: "gherkin-section",
      text: "Scenario",
      location: { file: "t.md", line: 4, column: 5 },
    },
  ]);
  const tokens = buildSemanticTokens([entry], makeProfile([]), [
    "- [REQ-001] Title",
    "",
    "  ```feature",
    "    Scenario: stops",
    "  ```",
  ]);
  const body = tokens.filter((t) => t.line === 3);
  assertEquals(body.length, 1);
  assertEquals(body[0].tokenType, "class");
  assertEquals(body[0].length, "Scenario".length);
});

Deno.test("buildSemanticTokens: BodyTokenKind 'gherkin-step' maps to 'keyword'", () => {
  const entry = entryWithBodyTokens([
    {
      kind: "gherkin-step",
      text: "Given",
      location: { file: "t.md", line: 3, column: 7 },
    },
  ]);
  const tokens = buildSemanticTokens([entry], makeProfile([]), [
    "- [REQ-001] Title",
    "",
    "      Given the speed is 60",
  ]);
  const body = tokens.filter((t) => t.line === 2);
  assertEquals(body.length, 1);
  assertEquals(body[0].tokenType, "keyword");
  assertEquals(body[0].length, "Given".length);
});

Deno.test("buildSemanticTokens: BodyTokenKind 'entity-ref' maps to 'string'", () => {
  const entry = entryWithBodyTokens([
    {
      kind: "entity-ref",
      text: "$BrakeController",
      convention: "type",
      location: { file: "t.md", line: 3, column: 8 },
    },
  ]);
  const tokens = buildSemanticTokens([entry], makeProfile([]), [
    "- [REQ-001] Title",
    "",
    "  Uses $BrakeController.",
  ]);
  const body = tokens.filter((t) => t.line === 2);
  assertEquals(body.length, 1);
  assertEquals(body[0].tokenType, "string");
  assertEquals(body[0].length, "$BrakeController".length);
});

Deno.test("buildSemanticTokens: BodyTokenKind 'inline-code' emits NO token (TextMate paints it)", () => {
  const entry = entryWithBodyTokens([
    {
      kind: "inline-code",
      text: "`x`",
      location: { file: "t.md", line: 3, column: 3 },
    },
  ]);
  const tokens = buildSemanticTokens([entry], makeProfile([]), [
    "- [REQ-001] Title",
    "",
    "  `x` is a thing.",
  ]);
  const body = tokens.filter((t) => t.line === 2);
  assertEquals(body.length, 0);
});

Deno.test("buildSemanticTokens: multiple bodyTokens on one line preserve relative positions", () => {
  const entry = entryWithBodyTokens([
    {
      kind: "modal",
      text: "shall",
      case: "lower",
      location: { file: "t.md", line: 3, column: 5 },
    },
    {
      kind: "entity-ref",
      text: "$obj",
      convention: "instance",
      location: { file: "t.md", line: 3, column: 18 },
    },
    {
      kind: "modal",
      text: "must",
      case: "lower",
      location: { file: "t.md", line: 3, column: 27 },
    },
  ]);
  const tokens = buildSemanticTokens([entry], makeProfile([]), [
    "- [REQ-001] Title",
    "",
    "    shall read $obj and must.",
  ]);
  const body = tokens.filter((t) => t.line === 2);
  assertEquals(body.length, 3);
  assertEquals(body[0].startChar, 4);
  assertEquals(body[0].tokenType, "keyword");
  assertEquals(body[1].startChar, 17);
  assertEquals(body[1].tokenType, "string");
  assertEquals(body[2].startChar, 26);
  assertEquals(body[2].tokenType, "keyword");
});

// ---------------------------------------------------------------------------
// Integration — parser → bodyTokens → LSP. Catches drift between the
// parser's emitted token shape and the LSP's consumer mapping.
// ---------------------------------------------------------------------------

import { parseFile } from "../core/mod.ts";

Deno.test("integration: parser bodyTokens drive LSP body keyword tokens (Markdown)", async () => {
  // End-to-end: parser emits bodyTokens; buildSemanticTokens consumes
  // them and emits LSP tokens of matching type. Positions are whatever
  // the parser computes; we assert the kind→type mapping holds across
  // the whole pipeline.
  const md = [
    "- [REQ-001] Brake response",
    "",
    "  The system shall debounce $Sensor inputs and must report.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
  ].join("\n");
  const result = await parseFile(md, { file: "t.md" });
  assertEquals(result.entries.length, 1);
  const entry = result.entries[0];
  const kinds = entry.bodyTokens.map((t) => t.kind).sort();
  assertEquals(kinds, ["entity-ref", "modal", "modal"]);

  const tokens = buildSemanticTokens([entry], makeProfile([]), md.split("\n"));
  const bodyTokenLine = entry.bodyTokens[0].location.line - 1;
  const onBody = tokens.filter((t) => t.line === bodyTokenLine);
  const keywords = onBody.filter((t) => t.tokenType === "keyword");
  const strings = onBody.filter((t) => t.tokenType === "string");
  assertEquals(keywords.length, 2);
  assertEquals(strings.length, 1);
  assertEquals(strings[0].length, "$Sensor".length);
});
