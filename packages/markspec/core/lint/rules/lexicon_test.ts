/**
 * @module core/lint/rules/lexicon_test
 *
 * Unit tests for the six INCOSE lexicon rules (MSL-Q302–Q305, Q310, Q313).
 */

import { assertEquals } from "@std/assert";
import type { BodyBlock } from "../../ast/nodes.ts";
import type { Entry } from "../../model/mod.ts";
import { makeDisplayId } from "../../model/mod.ts";
import { runLexiconRules } from "./lexicon.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParagraph(text: string): BodyBlock {
  return {
    kind: "paragraph",
    content: { text, markers: [] },
    range: {
      start: { line: 1, column: 1 },
      end: { line: 1, column: text.length },
    },
  };
}

function makeEntry(text: string): Entry {
  const bodyAst: BodyBlock[] = [makeParagraph(text)];
  return {
    displayId: makeDisplayId("REQ-001"),
    title: "Test entry with body",
    body: text,
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
    source: "markdown",
  };
}

// ---------------------------------------------------------------------------
// MSL-Q302: vague terms (incose-r7-vague-term)
// ---------------------------------------------------------------------------

Deno.test("lexicon Q302: fires for 'some'", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall use some mechanism."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q302"), true);
});

Deno.test("lexicon Q302: fires for 'several'", () => {
  const diags = runLexiconRules(
    makeEntry("The system handles several sensors."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q302"), true);
});

Deno.test("lexicon Q302: fires for 'adequate'", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall provide adequate cooling."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q302"), true);
});

Deno.test("lexicon Q302: does not fire on clean text", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall process all input data within 100ms."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q302"), false);
});

Deno.test("lexicon Q302: is case-insensitive ('Some' fires)", () => {
  const diags = runLexiconRules(makeEntry("Some data shall be processed."));
  assertEquals(diags.some((d) => d.code === "MSL-Q302"), true);
});

// ---------------------------------------------------------------------------
// MSL-Q303: escape clauses (incose-r8-escape-clause)
// ---------------------------------------------------------------------------

Deno.test("lexicon Q303: fires for 'as appropriate'", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall respond as appropriate."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q303"), true);
});

Deno.test("lexicon Q303: fires for 'where possible'", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall retry where possible."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q303"), true);
});

Deno.test("lexicon Q303: fires for 'if practicable'", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall log events if practicable."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q303"), true);
});

Deno.test("lexicon Q303: does not fire on clean text", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall always respond within 100ms."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q303"), false);
});

// ---------------------------------------------------------------------------
// MSL-Q304: open-ended (incose-r9-open-ended)
// ---------------------------------------------------------------------------

Deno.test("lexicon Q304: fires for 'etc.'", () => {
  const diags = runLexiconRules(
    makeEntry("The system handles sensors, actuators, etc."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q304"), true);
});

Deno.test("lexicon Q304: fires for 'and/or'", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall start and/or stop on command."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q304"), true);
});

Deno.test("lexicon Q304: fires for 'including but not limited to'", () => {
  const diags = runLexiconRules(
    makeEntry("Inputs including but not limited to sensors are accepted."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q304"), true);
});

Deno.test("lexicon Q304: does not fire on clean text", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall handle sensor input."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q304"), false);
});

// ---------------------------------------------------------------------------
// MSL-Q305: superfluous infinitive (incose-r10-superfluous-infinitive)
// ---------------------------------------------------------------------------

Deno.test("lexicon Q305: fires for 'be able to'", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall be able to process data."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q305"), true);
});

Deno.test("lexicon Q305: fires for 'be capable of'", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall be capable of handling 100 requests."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q305"), true);
});

Deno.test("lexicon Q305: fires for 'in order to'", () => {
  const diags = runLexiconRules(
    makeEntry("In order to start, the system shall check the clock."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q305"), true);
});

Deno.test("lexicon Q305: does not fire on clean text", () => {
  const diags = runLexiconRules(makeEntry("The system shall process data."));
  assertEquals(diags.some((d) => d.code === "MSL-Q305"), false);
});

// ---------------------------------------------------------------------------
// MSL-Q310: absolute terms (incose-r26-absolute)
// ---------------------------------------------------------------------------

Deno.test("lexicon Q310: fires for 'always'", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall always respond within 100ms."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q310"), true);
});

Deno.test("lexicon Q310: fires for 'never'", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall never drop a safety message."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q310"), true);
});

Deno.test("lexicon Q310: fires for 'complete'", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall provide complete coverage."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q310"), true);
});

Deno.test("lexicon Q310: does not fire on clean text", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall respond within 100ms."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q310"), false);
});

// ---------------------------------------------------------------------------
// MSL-Q313: negation (incose-r16-not)
// ---------------------------------------------------------------------------

Deno.test("lexicon Q313: fires for standalone 'not'", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall not exceed the memory limit."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q313"), true);
});

Deno.test("lexicon Q313: does not fire on clean text without 'not'", () => {
  const diags = runLexiconRules(
    makeEntry("The system shall process all data."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q313"), false);
});

Deno.test("lexicon Q313: 'not' does not match 'note'", () => {
  const diags = runLexiconRules(
    makeEntry("Note: the system shall process sensor data."),
  );
  assertEquals(diags.some((d) => d.code === "MSL-Q313"), false);
});

Deno.test("lexicon Q313: 'not' does not match 'notation'", () => {
  const diags = runLexiconRules(makeEntry("The notation shall follow EBNF."));
  assertEquals(diags.some((d) => d.code === "MSL-Q313"), false);
});
