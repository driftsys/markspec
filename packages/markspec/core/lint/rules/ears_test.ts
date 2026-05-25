/**
 * @module core/lint/rules/ears_test
 *
 * Unit tests for EARS rules MSL-Q100 through MSL-Q104.
 */

import { assertEquals } from "@std/assert";
import type { BodyBlock } from "../../ast/nodes.ts";
import type { Entry } from "../../model/mod.ts";
import { makeDisplayId } from "../../model/mod.ts";
import { runEarsRules } from "./ears.ts";

// ---------------------------------------------------------------------------
// Test helper
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

interface MakeEntryOpts {
  location?: { file: string; line: number; column: number };
  bodyStartLine?: number;
}

function makeEntry(
  body: string,
  opts: MakeEntryOpts = {},
): Entry {
  const bodyAst: BodyBlock[] = [makeParagraph(body)];
  const location = opts.location ?? { file: "test.md", line: 1, column: 1 };
  return {
    displayId: makeDisplayId("STK_0001"),
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
    bodyTokens: [],
  };
}

// ---------------------------------------------------------------------------
// MSL-Q100: ears-no-pattern
// ---------------------------------------------------------------------------

Deno.test("Q100: no EARS pattern in normative sentence", () => {
  // Starts with "Pressure" (not "The"), no EARS leading keyword.
  // Contains a modal → normative. Matches no EARS pattern → Q100.
  const entry = makeEntry(
    "Pressure shall be maintained appropriately.",
  );
  const diags = runEarsRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q100"), true);
});

Deno.test("Q100: normative sentence with no leading keyword and no 'The' actor", () => {
  // "Readings shall be logged." — modal present but no EARS structure.
  const entry = makeEntry("Readings shall be logged.");
  const diags = runEarsRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q100"), true);
});

// ---------------------------------------------------------------------------
// MSL-Q101: ears-missing-actor
// ---------------------------------------------------------------------------

Deno.test("Q101: missing actor — single bare lowercase noun before modal", () => {
  // 'brake' is a single lowercase noun → Q101.
  const entry = makeEntry("The brake shall apply pressure.");
  const diags = runEarsRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q101"), true);
});

Deno.test("Q101: silent when compound noun phrase acts as actor", () => {
  // 'brake controller' is a two-word compound → treated as system name.
  const entry = makeEntry(
    "The brake controller shall apply force within 50 ms.",
  );
  const diags = runEarsRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q101"), false);
});

Deno.test("Q101: silent when PascalCase noun acts as actor", () => {
  const entry = makeEntry("The BrakeController shall apply force.");
  const diags = runEarsRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q101"), false);
});

// ---------------------------------------------------------------------------
// MSL-Q102: ears-negative-response
// ---------------------------------------------------------------------------

Deno.test("Q102: bare negation — 'shall not'", () => {
  const entry = makeEntry("The system shall not retry on failure.");
  const diags = runEarsRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q102"), true);
});

Deno.test("Q102: bare negation — 'should not'", () => {
  const entry = makeEntry(
    "The monitoring subsystem should not suppress sensor warnings.",
  );
  const diags = runEarsRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q102"), true);
});

Deno.test("Q102: silent when modal is positive", () => {
  const entry = makeEntry(
    "When the pedal is pressed, the brake controller shall apply pressure within 200 ms.",
  );
  const diags = runEarsRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q102"), false);
});

// ---------------------------------------------------------------------------
// MSL-Q103: ears-stacked-preconditions
// ---------------------------------------------------------------------------

Deno.test("Q103: stacked preconditions (≥3 While/When/If)", () => {
  const entry = makeEntry(
    "While engaged, when pressed, if valid, then the system shall apply.",
  );
  const diags = runEarsRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q103"), true);
});

Deno.test("Q103: silent on exactly two preconditions (Complex pattern)", () => {
  // While + When = Complex pattern (2 preconditions) → no Q103.
  const entry = makeEntry(
    "While braking is active, when the pedal pressure exceeds 5 bar, the brake controller shall hold.",
  );
  const diags = runEarsRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q103"), false);
});

// ---------------------------------------------------------------------------
// MSL-Q104: ears-malformed-attempt
// ---------------------------------------------------------------------------

Deno.test("Q104: EARS keyword present but no modal", () => {
  // EARS keyword but no modal+response → malformed.
  const entry = makeEntry("When pressed, the system the system.");
  const diags = runEarsRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q104"), true);
});

Deno.test("Q104: silent when EARS keyword has a modal", () => {
  // When + modal → NOT malformed.
  const entry = makeEntry(
    "When the pedal is pressed, the brake controller shall apply pressure.",
  );
  const diags = runEarsRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q104"), false);
});

Deno.test("Q104: fires on non-normative malformed EARS attempt", () => {
  // No modal, but sentence opens with EARS keyword. Q104 should still fire.
  const entry = makeEntry("If the sensor fails, the component.");
  const diags = runEarsRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q104"), true);
});

// ---------------------------------------------------------------------------
// Silent on non-normative sentences
// ---------------------------------------------------------------------------

Deno.test("EARS: silent on non-normative sentences", () => {
  // No modal → not normative → no Q100/Q101/Q102/Q103.
  // No EARS keyword → no Q104.
  const entry = makeEntry("The brake is a critical safety system.");
  const diags = runEarsRules(entry);
  assertEquals(diags.length, 0);
});

// ---------------------------------------------------------------------------
// Valid EARS patterns are silent
// ---------------------------------------------------------------------------

Deno.test("EARS: valid Event-driven pattern is silent", () => {
  const entry = makeEntry(
    "When the pedal is pressed, the brake controller shall apply pressure within 200 ms.",
  );
  const diags = runEarsRules(entry);
  // Q100 silent (matches Event-driven).
  // Q101 silent ('brake controller' is a compound noun phrase actor).
  // Q102 silent (no negation).
  // Q103 silent (1 precondition, not 3).
  // Q104 silent (modal+response present).
  assertEquals(diags.length, 0);
});

Deno.test("EARS: valid Unwanted-behaviour pattern is silent", () => {
  const entry = makeEntry(
    "If a sensor reading is invalid, then the brake controller shall ignore it.",
  );
  const diags = runEarsRules(entry);
  assertEquals(diags.length, 0);
});

Deno.test("EARS: valid State-driven pattern is silent", () => {
  const entry = makeEntry(
    "While the vehicle is decelerating, the brake controller shall maintain hydraulic pressure.",
  );
  const diags = runEarsRules(entry);
  assertEquals(diags.length, 0);
});

Deno.test("EARS: valid Ubiquitous pattern with compound actor is silent", () => {
  // 'brake controller' is a two-word compound noun → actor present.
  const entry = makeEntry(
    "The brake controller shall apply force within 50 ms.",
  );
  const diags = runEarsRules(entry);
  assertEquals(diags.length, 0);
});

// ---------------------------------------------------------------------------
// Range is file-absolute, sentence-span
// ---------------------------------------------------------------------------

Deno.test("EARS: range is file-absolute, sentence-span", () => {
  // Entry whose body starts at file line 32.
  // Q101 fires (single lowercase noun 'brake' before modal).
  // The diagnostic range must reflect bodyStartLine + paragraph offset.
  const entry = makeEntry("The brake shall apply pressure.", {
    location: { file: "/x.md", line: 30, column: 1 },
    bodyStartLine: 32,
  });
  const diags = runEarsRules(entry);
  const q101 = diags.find((d) => d.code === "MSL-Q101");
  assertEquals(q101 !== undefined, true);
  assertEquals(q101?.range?.start.line, 32); // file-absolute
});

// ---------------------------------------------------------------------------
// LintDiagnostic fields
// ---------------------------------------------------------------------------

Deno.test("EARS: diagnostics carry slug, group, scoreContribution", () => {
  const entry = makeEntry("Pressure shall be maintained appropriately.");
  const diags = runEarsRules(entry);
  const q100 = diags.find((d) => d.code === "MSL-Q100");
  assertEquals(q100 !== undefined, true);
  assertEquals(q100?.slug, "ears-no-pattern");
  assertEquals(q100?.group, "ears");
  assertEquals(q100?.scoreContribution, 1);
});

Deno.test("EARS: Q103 has warn severity and score 3", () => {
  const entry = makeEntry(
    "While engaged, when pressed, if valid, then the system shall apply.",
  );
  const diags = runEarsRules(entry);
  const q103 = diags.find((d) => d.code === "MSL-Q103");
  assertEquals(q103?.severity, "warning");
  assertEquals(q103?.scoreContribution, 3);
});
