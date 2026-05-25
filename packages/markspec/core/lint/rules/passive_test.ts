/**
 * @module core/lint/rules/passive_test
 *
 * Unit tests for MSL-Q300 (incose-r2-active-voice) and
 * MSL-Q301 (incose-r3-subject-verb).
 */

import { assertEquals } from "@std/assert";
import type { BodyBlock } from "../../ast/nodes.ts";
import type { Entry } from "../../model/mod.ts";
import { makeDisplayId } from "../../model/mod.ts";
import { runPassiveRules } from "./passive.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

function makeEntry(body: string): Entry {
  return {
    displayId: makeDisplayId("STK_0001"),
    title: "Test requirement",
    body,
    bodyAst: [makeParagraph(body)],
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

// ---------------------------------------------------------------------------
// MSL-Q300: incose-r2-active-voice
// ---------------------------------------------------------------------------

Deno.test("Q300: fires on 'shall be applied' (modal + be + -ed)", () => {
  const entry = makeEntry("Pressure shall be applied within 200 ms.");
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q300"), true);
});

Deno.test("Q300: fires on 'shall be processed' (regular -ed)", () => {
  const entry = makeEntry("The signal shall be processed by the controller.");
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q300"), true);
});

Deno.test("Q300: fires on 'should be initialized' (should + be + -ed)", () => {
  const entry = makeEntry(
    "The module should be initialized before use.",
  );
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q300"), true);
});

Deno.test("Q300: fires on 'must be done' (irregular participial)", () => {
  const entry = makeEntry("The calibration must be done before shipment.");
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q300"), true);
});

Deno.test("Q300: fires on 'shall be written' (irregular participial)", () => {
  const entry = makeEntry("The report shall be written by the engineer.");
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q300"), true);
});

Deno.test("Q300: fires on 'shall be taken' (irregular participial)", () => {
  const entry = makeEntry("Action shall be taken within 5 s of detection.");
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q300"), true);
});

Deno.test("Q300: silent on active form 'shall apply'", () => {
  const entry = makeEntry("The brake shall apply pressure within 200 ms.");
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q300"), false);
});

Deno.test("Q300: silent on 'shall be ready' (adjective, not participial)", () => {
  // "ready" does not end in -ed and is not in the irregular list.
  const entry = makeEntry(
    "The system shall be ready to receive commands within 100 ms.",
  );
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q300"), false);
});

Deno.test("Q300: silent on 'shall be able' (adjective phrase)", () => {
  const entry = makeEntry(
    "The operator shall be able to override the alert.",
  );
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q300"), false);
});

Deno.test("Q300: silent on non-normative sentence (no modal)", () => {
  const entry = makeEntry("The data is transferred to the archive.");
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q300"), false);
});

Deno.test("Q300: silent on empty bodyAst", () => {
  const entry: Entry = {
    displayId: makeDisplayId("STK_0001"),
    title: "Test requirement",
    body: "",
    bodyAst: [],
    rawAttributes: [{ key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" }],
    typedAttributes: new Map(),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    type: "Requirement",
    shape: "Authored",
    location: { file: "test.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  };
  const diags = runPassiveRules(entry);
  assertEquals(diags.length, 0);
});

Deno.test("Q300: diagnostic carries correct code, slug, group, severity", () => {
  const entry = makeEntry("The sensor shall be calibrated annually.");
  const diags = runPassiveRules(entry);
  const d = diags.find((x) => x.code === "MSL-Q300");
  assertEquals(d !== undefined, true);
  assertEquals(d!.slug, "incose-r2-active-voice");
  assertEquals(d!.group, "incose");
  assertEquals(d!.severity, "warning");
  assertEquals(d!.scoreContribution, 3);
});

Deno.test("Q300: diagnostic has a range", () => {
  const entry = makeEntry("The sensor shall be calibrated annually.");
  const diags = runPassiveRules(entry);
  const d = diags.find((x) => x.code === "MSL-Q300");
  assertEquals(d?.range !== undefined, true);
  assertEquals(typeof d!.range!.start.line, "number");
  assertEquals(typeof d!.range!.start.column, "number");
});

Deno.test("Q300: fires on 'shall not be applied' (negated modal + passive)", () => {
  const entry = makeEntry(
    "Voltage shall not be applied during initialization.",
  );
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q300"), true);
});

// ---------------------------------------------------------------------------
// MSL-Q301: incose-r3-subject-verb
// ---------------------------------------------------------------------------

Deno.test("Q301: fires on 'It shall' (pronoun subject)", () => {
  const entry = makeEntry("It shall be possible to override the alert.");
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q301"), true);
});

Deno.test("Q301: fires on 'This shall' (pronoun subject)", () => {
  const entry = makeEntry("This shall be confirmed within 10 s.");
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q301"), true);
});

Deno.test("Q301: fires on 'That shall' (pronoun subject)", () => {
  const entry = makeEntry("That shall be logged in the event journal.");
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q301"), true);
});

Deno.test("Q301: fires on 'There shall' (existential-there)", () => {
  const entry = makeEntry(
    "There shall be no false activations during normal operation.",
  );
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q301"), true);
});

Deno.test("Q301: silent on clear actor subject", () => {
  const entry = makeEntry("The brake controller shall apply pressure.");
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q301"), false);
});

Deno.test("Q301: silent on 'The system shall'", () => {
  const entry = makeEntry("The system shall detect obstacles within 100 ms.");
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q301"), false);
});

Deno.test("Q301: silent on non-normative sentence", () => {
  const entry = makeEntry("It is a critical system component.");
  const diags = runPassiveRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q301"), false);
});

Deno.test("Q301: diagnostic carries correct code, slug, group, severity", () => {
  const entry = makeEntry("It shall be possible to configure the threshold.");
  const diags = runPassiveRules(entry);
  const d = diags.find((x) => x.code === "MSL-Q301");
  assertEquals(d !== undefined, true);
  assertEquals(d!.slug, "incose-r3-subject-verb");
  assertEquals(d!.group, "incose");
  assertEquals(d!.severity, "info");
  assertEquals(d!.scoreContribution, 1);
});

Deno.test("Q301: diagnostic has a range", () => {
  const entry = makeEntry("It shall be possible to configure the threshold.");
  const diags = runPassiveRules(entry);
  const d = diags.find((x) => x.code === "MSL-Q301");
  assertEquals(d?.range !== undefined, true);
});

// ---------------------------------------------------------------------------
// Co-firing: Q300 and Q301 may both fire on same sentence
// ---------------------------------------------------------------------------

Deno.test("Q300 and Q301 may co-fire: 'It shall be applied'", () => {
  const entry = makeEntry("It shall be applied within 200 ms.");
  const diags = runPassiveRules(entry);
  // Both fire: pronoun subject (Q301) + passive construction (Q300)
  assertEquals(diags.some((d) => d.code === "MSL-Q300"), true);
  assertEquals(diags.some((d) => d.code === "MSL-Q301"), true);
});

// ---------------------------------------------------------------------------
// File-absolute range: bodyStartLine respected
// ---------------------------------------------------------------------------

Deno.test("Q300: range uses file-absolute line from bodyStartLine", () => {
  const body = "The sensor shall be calibrated annually.";
  const entry: Entry = {
    displayId: makeDisplayId("STK_0001"),
    title: "Test requirement",
    body,
    bodyAst: [makeParagraph(body, 1, 1)],
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
    location: { file: "test.md", line: 5, column: 1 },
    bodyStartLine: 7,
    source: { kind: "markdown" },
    bodyTokens: [],
  };
  const diags = runPassiveRules(entry);
  const d = diags.find((x) => x.code === "MSL-Q300");
  assertEquals(d !== undefined, true);
  // bodyStartLine=7, paragraph on line 1 (body-relative) → abs line = 7 + 1 - 1 = 7
  assertEquals(d!.range!.start.line, 7);
});
