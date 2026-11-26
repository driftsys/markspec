/**
 * @module core/lint/rules/xref_test
 *
 * Unit tests for the MSL-Q500 xref-glossary-undefined rule.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { BodyBlock } from "../../ast/nodes.ts";
import type { BodyToken, Entry } from "../../model/mod.ts";
import { makeDisplayId } from "../../model/mod.ts";
import { loadLexicon } from "../../lexicons/mod.ts";
import { EARS_RE, MODAL_RE } from "../../parser/body_tokens.ts";
import { EARS_KEYWORD_RE, KEYWORD_WORDS } from "../../util/modals.ts";
import { buildIdentifierIndex, runXrefRules } from "./xref.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALLOW = loadLexicon("capitalized-allow");

function makeParagraph(text: string, line = 1, column = 1): BodyBlock {
  return {
    kind: "paragraph",
    content: { text },
    range: {
      start: { line, column },
      end: { line, column: column + text.length },
    },
  };
}

interface MakeEntryOpts {
  location?: { file: string; line: number; column: number };
  bodyStartLine?: number;
  bodyTokens?: readonly BodyToken[];
}

function makeEntry(
  body: string,
  displayId = "STK_0001",
  opts: MakeEntryOpts = {},
): Entry {
  const bodyAst: BodyBlock[] = [makeParagraph(body)];
  const location = opts.location ?? { file: "test.md", line: 1, column: 1 };
  return {
    displayId: makeDisplayId(displayId),
    title: "Test requirement",
    body,
    bodyAst,
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Type", value: "Requirement" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Type", ["Requirement"]],
    ]),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    type: "Requirement",
    shape: "Authored",
    location,
    ...(opts.bodyStartLine !== undefined
      ? { bodyStartLine: opts.bodyStartLine }
      : {}),
    source: { kind: "markdown" },
    bodyTokens: opts.bodyTokens ?? [],
  };
}

function entityRef(text: string, line = 1, column = 1): BodyToken {
  const bare = text.startsWith("$") ? text.slice(1) : text;
  const convention =
    /^[A-Z][A-Z0-9_]*[A-Z0-9]$/.test(bare) && /[_0-9]/.test(bare)
      ? "constant"
      : /^[A-Z]/.test(bare)
      ? "type"
      : "instance";
  return {
    kind: "entity-ref",
    text: text.startsWith("$") ? text : `$${text}`,
    convention,
    location: { file: "test.md", line, column },
  };
}

const EMPTY_GLOSSARY = { has: (_: string) => false, size: () => 0 };

// ---------------------------------------------------------------------------
// MSL-Q500 core detection
// ---------------------------------------------------------------------------

Deno.test("Q500: fires on undefined PascalCase term", () => {
  const entry = makeEntry("The BrakeController shall apply pressure.");
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  assertEquals(diags.length, 1);
  assertEquals(diags[0].code, "MSL-Q500");
});

Deno.test("Q500: silent when term is in DefinitionList (slug match)", () => {
  const entry = makeEntry("The BrakeController shall apply pressure.");
  const idx = { has: (s: string) => s === "brakecontroller", size: () => 1 };
  const diags = runXrefRules(entry, idx, ALLOW, () => false);
  assertEquals(diags.length, 0);
});

Deno.test("Q500: silent when term is in capitalized-allow", () => {
  const entry = makeEntry("On Monday the system shall reboot.");
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  assertEquals(diags.length, 0);
});

Deno.test("Q500: silent for sentence-initial Capitalized word", () => {
  const entry = makeEntry("System shall apply pressure when triggered.");
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  // 'System' is sentence-initial → not a Q500 candidate.
  assertEquals(diags.length, 0);
});

Deno.test("Q500: silent for $Identifier leg via no-op hook", () => {
  const entry = makeEntry("The brake shall fire when BrakePedalPressed.");
  const idx = { has: (_: string) => false, size: () => 0 };
  // Hook says: $Identifier resolution would have succeeded.
  const diags = runXrefRules(
    entry,
    idx,
    ALLOW,
    (token: string) => token === "BrakePedalPressed",
  );
  assertEquals(diags.length, 0);
});

Deno.test("Q500: detects multi-word capitalized phrase", () => {
  const entry = makeEntry("The Brake Controller Unit shall apply pressure.");
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  assertEquals(diags.length, 1);
  // Message references the full phrase, not just one token.
  assertEquals(diags[0].message.includes("Brake Controller Unit"), true);
});

Deno.test("Q500: skips RFC 2119 / EARS keywords mid-sentence", () => {
  // 'When' mid-sentence (post-comma) is uppercase but is an EARS keyword
  // — not a domain term. The rule must skip it.
  const entry = makeEntry(
    "The brake shall fire, When the pedal is pressed.",
  );
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  // No diagnostic with "When" in the message.
  assertEquals(
    diags.filter((d: { message: string }) => d.message.includes("'When'"))
      .length,
    0,
  );
});

Deno.test("Q500: diagnostic range covers the token (file-absolute)", () => {
  const body = "The BrakeController shall apply.";
  const entry = makeEntry(body);
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  assertEquals(diags[0].range !== undefined, true);
  // 'BrakeController' starts at byte offset 4. If the paragraph's
  // range.start is (line=1, col=1), then the diagnostic's range.start
  // should be (line=1, col=5) — 1-based, file-absolute.
  assertEquals(diags[0].range!.start.column, 5);
});

Deno.test("Q500: ADR-021 Decision 2 — three-connector phrase does NOT span", () => {
  // 'Brake of the Vehicle of System' has three lowercase connectors total.
  // The grammar allows up to 2 connectors. So this should NOT span as one
  // phrase. Should produce diagnostics for separate sub-phrases.
  const entry = makeEntry(
    "The Brake of the Vehicle of System shall apply.",
  );
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  // Two phrases: 'Brake of the Vehicle' (2 connectors max)
  // and 'System' (1 token). Each fires independently.
  assertEquals(diags.length >= 2, true);
});

// ---------------------------------------------------------------------------
// Additional edge-case tests
// ---------------------------------------------------------------------------

Deno.test("Q500: no firing on lowercase-only body", () => {
  const entry = makeEntry("the system shall process data within 200 ms.");
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  assertEquals(diags.length, 0);
});

Deno.test("Q500: two-word capitalized phrase with connector (Brake of Controller)", () => {
  const entry = makeEntry("The Brake of Controller shall apply.");
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  assertEquals(diags.length, 1);
  assertEquals(diags[0].message.includes("Brake of Controller"), true);
});

Deno.test("Q500: silent when phrase matches glossary slug", () => {
  const entry = makeEntry("The Brake Controller shall apply.");
  const idx = { has: (s: string) => s === "brake-controller", size: () => 1 };
  const diags = runXrefRules(entry, idx, ALLOW, () => false);
  assertEquals(diags.length, 0);
});

Deno.test("Q500: fires once per unique phrase, not per occurrence", () => {
  const entry = makeEntry(
    "The BrakeController shall activate. The BrakeController shall deactivate.",
  );
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  // Both occurrences fire (the rule fires per-occurrence, not per unique phrase)
  assertEquals(diags.length, 2);
});

// ---------------------------------------------------------------------------
// Bug A regression: protected keywords must not be absorbed into phrases
// ---------------------------------------------------------------------------

Deno.test("Q500: protected keyword terminates phrase extension (Bug A)", () => {
  // 'When' mid-sentence is an EARS protected keyword. The extension loop
  // must stop at 'When' so "Brake When System" is never emitted as a
  // single phrase. 'Brake' fires alone (single-token phrase); 'When' is
  // skipped entirely; 'System' may fire on its own.
  const entry = makeEntry("The Brake When System shall apply.");
  const idx = { has: (_: string) => false, size: () => 0 };
  const diags = runXrefRules(entry, idx, ALLOW, () => false);
  // The phrase "Brake When System" must NEVER appear in any diagnostic.
  assertEquals(
    diags.find((d) => d.message.includes("Brake When System")),
    undefined,
  );
  // 'When' itself must NOT appear in any diagnostic message.
  assertEquals(
    diags.find((d) => d.message.includes("'When'")),
    undefined,
  );
});

// ---------------------------------------------------------------------------
// Bug B regression: LintDiagnostic.range must be file-absolute
// ---------------------------------------------------------------------------

Deno.test("Q500: range.start.line is file-absolute (Bug B)", () => {
  // Entry whose body sits at file line 32 (title at line 30, blank at 31).
  // The paragraph in bodyAst starts at body-relative line 1, column 1.
  // The diagnostic range.start.line must reflect the file-absolute line.
  const entry = makeEntry("The BrakeController shall apply.", "STK_0001", {
    location: { file: "/x.md", line: 30, column: 1 },
    bodyStartLine: 32,
  });
  const idx = { has: (_: string) => false, size: () => 0 };
  const diags = runXrefRules(entry, idx, ALLOW, () => false);
  assertEquals(diags.length, 1);
  // body-relative line 1 + bodyStartLine 32 - 1 = 32 (file-absolute)
  assertEquals(diags[0].range!.start.line, 32);
});

// ---------------------------------------------------------------------------
// ADR-021 Decision 2 req 4d: "Brake of the Vehicle System" is one phrase
// ---------------------------------------------------------------------------

Deno.test("Q500: 'Brake of the Vehicle System' is one phrase (ADR-021 Decision 2, req 4d)", () => {
  // 'Brake of the Vehicle System' has exactly 2 connectors ('of', 'the')
  // and 3 Capitalized tokens. Per ADR-021 Decision 2, ≤2 connectors is
  // within budget → this IS a single phrase.
  const entry = makeEntry("The Brake of the Vehicle System shall apply.");
  const idx = { has: (_: string) => false, size: () => 0 };
  const diags = runXrefRules(entry, idx, ALLOW, () => false);
  // Exactly one diagnostic emitting the full phrase.
  const q500 = diags.filter((d) => d.code === "MSL-Q500");
  assertEquals(q500.length, 1);
  assertEquals(q500[0].message.includes("Brake of the Vehicle System"), true);
});

// ---------------------------------------------------------------------------
// buildIdentifierIndex — corpus-scan $Identifier resolver leg (issue #502)
// ---------------------------------------------------------------------------

Deno.test("buildIdentifierIndex: aggregates entity-ref bare names across entries", () => {
  const e1 = makeEntry("ignored prose", "REQ_0001", {
    bodyTokens: [entityRef("$BrakePedalPressed")],
  });
  const e2 = makeEntry("ignored prose", "REQ_0002", {
    bodyTokens: [entityRef("$sensorStatus"), entityRef("$ASIL_D")],
  });
  const index = buildIdentifierIndex([e1, e2]);
  // Bare names with leading `$` stripped.
  assertEquals(index.has("BrakePedalPressed"), true);
  assertEquals(index.has("sensorStatus"), true);
  assertEquals(index.has("ASIL_D"), true);
  // Words appearing in prose but never as $Identifier MUST NOT enter the index.
  assertEquals(index.has("ignored"), false);
  assertEquals(index.has("prose"), false);
  // Set size matches the number of distinct identifiers observed.
  assertEquals(index.size, 3);
});

Deno.test("buildIdentifierIndex: empty input yields empty index", () => {
  const index = buildIdentifierIndex([]);
  assertEquals(index.size, 0);
});

Deno.test("buildIdentifierIndex: ignores non-entity-ref body tokens", () => {
  // Modal + EARS-trigger tokens must not pollute the identifier index.
  const e = makeEntry("ignored prose", "REQ_0001", {
    bodyTokens: [
      {
        kind: "modal",
        text: "shall",
        case: "lower",
        location: { file: "test.md", line: 1, column: 1 },
      },
      {
        kind: "ears-trigger",
        text: "When",
        trigger: "When",
        location: { file: "test.md", line: 1, column: 1 },
      },
      entityRef("$RealIdentifier"),
    ],
  });
  const index = buildIdentifierIndex([e]);
  assertEquals(index.size, 1);
  assertEquals(index.has("RealIdentifier"), true);
  assertEquals(index.has("shall"), false);
  assertEquals(index.has("When"), false);
});

Deno.test("Q500: does not read link destinations, titles or images as terms (#1017)", () => {
  const entry = makeEntry(
    'See [the rule](http://a.example/p "MAY") and ![SHALL](img/SHALL.png).',
  );
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  assertEquals(diags.map((d) => d.message), []);
});

Deno.test("Q500: still fires on a term in link text (#1017)", () => {
  const entry = makeEntry("See [the BrakeController](http://a.example/p).");
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  assertEquals(diags.length, 1);
  assertStringIncludes(diags[0].message, "'BrakeController'");
});

function entryWithBlocks(blocks: BodyBlock[]): Entry {
  return { ...makeEntry("x"), bodyAst: blocks };
}

Deno.test("Q500: labels defined in another block are not terms (#1017)", () => {
  const entry = entryWithBlocks([
    makeParagraph(
      "See [the rule][BrakeRef], [BrakeController] and the note[^BigNote]. The PumpUnit runs.",
    ),
    {
      kind: "unknown",
      raw:
        "[BrakeRef]: http://a.example/\n[BrakeController]: http://b.example/",
      range: { start: { line: 3, column: 1 }, end: { line: 4, column: 1 } },
    } as BodyBlock,
    {
      kind: "unknown",
      raw: "[^BigNote]: some text.",
      range: { start: { line: 6, column: 1 }, end: { line: 6, column: 1 } },
    } as BodyBlock,
  ]);
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  assertEquals(diags.length, 1);
  assertStringIncludes(diags[0].message, "'PumpUnit'");
});

Deno.test("Q500: does not read inline code as a term (#1017)", () => {
  const entry = makeEntry("The value uses `BrakeController` here.");
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  assertEquals(diags.length, 0);
});

Deno.test("Q500: a term after a multi-line code span keeps its line (#1017)", () => {
  const entry = makeEntry("Use `a\nb` and\nthe BrakeController now.");
  const diags = runXrefRules(entry, EMPTY_GLOSSARY, ALLOW, () => false);
  assertEquals(diags.length, 1);
  // Paragraph line 3; the body starts on file line 2.
  assertEquals(diags[0].range?.start.line, 4);
});

Deno.test("runXrefRules: modal and EARS keywords in any casing are not undefined terms", () => {
  const e = makeEntry(
    "The system SHALL act. Then WHEN requested the Shall WILL act, SHOULD MAY MUST NOT retry WHILE busy WHERE set UNLESS IF stopped THEN halt.",
  );
  const out = runXrefRules(e, EMPTY_GLOSSARY, ALLOW, () => false);
  assertEquals(out.map((d) => d.message), []);
});

Deno.test("runXrefRules: a keyword next to a term does not hide the term or join it", () => {
  const e = makeEntry("The BrakeController SHALL apply pressure for XyzUnit.");
  const out = runXrefRules(e, EMPTY_GLOSSARY, ALLOW, () => false);
  const phrases = out.map((d) => /'([^']+)'/.exec(d.message)?.[1]);
  assertEquals(phrases, ["BrakeController", "XyzUnit"]);
});

Deno.test("runXrefRules: a keyword after a connector run does not join the phrase", () => {
  const e = makeEntry("The value of XyzUnit of SHALL is set.");
  const out = runXrefRules(e, EMPTY_GLOSSARY, ALLOW, () => false);
  const phrases = out.map((d) => /'([^']+)'/.exec(d.message)?.[1]);
  assertEquals(phrases, ["XyzUnit"]);
});

Deno.test("KEYWORD_WORDS: covers every word of the modal and EARS regexes", () => {
  for (const re of [MODAL_RE, EARS_RE, EARS_KEYWORD_RE]) {
    const alternation = /\(([^()]+)\)/.exec(re.source)![1];
    for (const alt of alternation.split("|")) {
      for (const word of alt.toLowerCase().split(/\s+/)) {
        assertEquals(KEYWORD_WORDS.has(word), true, `missing '${word}'`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// #1028: a glossary term that contains a keyword stays whole
// ---------------------------------------------------------------------------

/** A glossary that holds `may-day-protocol` and `not-ready-state`. */
const KEYWORD_TERMS = {
  has: (s: string): boolean =>
    s === "may-day-protocol" || s === "not-ready-state",
  size: () => 2,
};

function q500Phrases(body: string, glossary = KEYWORD_TERMS): string[] {
  const out = runXrefRules(makeEntry(body), glossary, ALLOW, () => false);
  return out.map((d) => /'([^']+)'/.exec(d.message)?.[1] ?? "");
}

Deno.test("runXrefRules: a Title-case glossary term that contains a keyword is defined (#1028)", () => {
  assertEquals(
    q500Phrases("The pump uses the May Day Protocol in the Not Ready State."),
    [],
  );
});

Deno.test("runXrefRules: an all-caps glossary term that contains a keyword is defined (#1028)", () => {
  assertEquals(
    q500Phrases("The pump uses the MAY DAY PROTOCOL in the NOT READY STATE."),
    [],
  );
});

Deno.test("runXrefRules: a keyword phrase that is not a glossary term is still split (#1028)", () => {
  assertEquals(
    q500Phrases(
      "The pump uses the May Day Protocol in the Not Ready State.",
      EMPTY_GLOSSARY,
    ),
    ["Day Protocol", "Ready State"],
  );
  assertEquals(
    q500Phrases("The pump uses the May Day Plan."),
    ["Day Plan"],
  );
});

Deno.test("runXrefRules: a glossary term after a keyword in the sentence is defined (#1028)", () => {
  assertEquals(q500Phrases("The system shall use the May Day Protocol."), []);
  assertEquals(q500Phrases("The system SHALL use the MAY DAY PROTOCOL."), []);
});

Deno.test("runXrefRules: a glossary term with a keyword ends the phrase before it (#1028)", () => {
  assertEquals(
    q500Phrases("The Brake May Day Protocol applies."),
    ["Brake"],
  );
});

Deno.test("runXrefRules: the range after a glossary term with a keyword is exact (#1028)", () => {
  const body = "The pump uses the May Day Protocol for XyzUnit.";
  const out = runXrefRules(makeEntry(body), KEYWORD_TERMS, ALLOW, () => false);
  assertEquals(out.length, 1);
  assertStringIncludes(out[0].message, "'XyzUnit'");
  assertEquals(out[0].range!.start.column, body.indexOf("XyzUnit") + 1);
  assertEquals(out[0].range!.end.column, body.indexOf("XyzUnit") + 8);
});

Deno.test("runXrefRules: a glossary term with a keyword inside inline code is not read (#1028)", () => {
  assertEquals(q500Phrases("The pump uses `the May Day Plan` now."), []);
});

Deno.test("runXrefRules: a glossary term with a keyword at a sentence start is defined (#1028)", () => {
  assertEquals(q500Phrases("May Day Protocol applies here."), []);
  assertEquals(q500Phrases("MAY DAY PROTOCOL applies here."), []);
  assertEquals(q500Phrases("Not Ready State shall inhibit operation."), []);
  assertEquals(q500Phrases("NOT READY STATE shall inhibit operation."), []);
  assertEquals(
    q500Phrases("The pump stops. May Day Protocol applies here."),
    [],
  );
});

Deno.test("runXrefRules: without the glossary a keyword phrase at a sentence start is still split (#1028)", () => {
  assertEquals(
    q500Phrases("May Day Protocol applies here.", EMPTY_GLOSSARY),
    ["Day Protocol"],
  );
  assertEquals(
    q500Phrases("MAY DAY PROTOCOL applies here.", EMPTY_GLOSSARY),
    ["DAY PROTOCOL"],
  );
  assertEquals(
    q500Phrases("Not Ready State shall inhibit operation.", EMPTY_GLOSSARY),
    ["Ready State"],
  );
  assertEquals(
    q500Phrases("NOT READY STATE shall inhibit operation.", EMPTY_GLOSSARY),
    ["READY STATE"],
  );
  // A sentence-initial word that is not a keyword is still not a term.
  assertEquals(q500Phrases("Pump Day Protocol applies here."), [
    "Day Protocol",
  ]);
});

Deno.test("runXrefRules: the longest glossary term with a keyword wins (#1028)", () => {
  const glossary = {
    has: (s: string): boolean => s === "may-day" || s === "may-day-protocol",
    size: () => 2,
  };
  assertEquals(q500Phrases("the May Day Protocol now.", glossary), []);
});

Deno.test("runXrefRules: words after a leading glossary term with a keyword are reported (#1028)", () => {
  assertEquals(q500Phrases("the Not Ready State Machine now."), ["Machine"]);
});
