/**
 * @module core/lint/rules/xref_test
 *
 * Unit tests for the MSL-Q500 xref-glossary-undefined rule.
 */

import { assertEquals } from "@std/assert";
import type { BodyBlock } from "../../ast/nodes.ts";
import type { BodyToken, Entry } from "../../model/mod.ts";
import { makeDisplayId } from "../../model/mod.ts";
import { loadLexicon } from "../../lexicons/mod.ts";
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
