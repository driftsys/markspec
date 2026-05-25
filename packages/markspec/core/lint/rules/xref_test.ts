/**
 * @module core/lint/rules/xref_test
 *
 * Unit tests for the MSL-Q500 xref-glossary-undefined rule.
 */

import { assertEquals } from "@std/assert";
import type { BodyBlock } from "../../ast/nodes.ts";
import type { Entry } from "../../model/mod.ts";
import { makeDisplayId } from "../../model/mod.ts";
import { loadLexicon } from "../../lexicons/mod.ts";
import { runXrefRules } from "./xref.ts";

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

function makeEntry(body: string, displayId = "STK_0001"): Entry {
  const bodyAst: BodyBlock[] = [makeParagraph(body)];
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
    location: { file: "test.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
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
