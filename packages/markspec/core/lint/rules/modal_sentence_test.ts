/**
 * @module core/lint/rules/modal_sentence_test
 *
 * Unit tests for modal sentence rules MSL-Q200 and MSL-Q201.
 */

import { assertEquals } from "@std/assert";
import type { BodyBlock } from "../../ast/nodes.ts";
import type { Entry } from "../../model/mod.ts";
import { makeDisplayId } from "../../model/mod.ts";
import { runModalSentenceRules } from "./modal_sentence.ts";

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
  /** Resolved core type string (e.g. "Requirement", "Test"). */
  type?: string;
  location?: { file: string; line: number; column: number };
  bodyStartLine?: number;
}

function makeEntry(
  body: string,
  opts: MakeEntryOpts = {},
): Entry {
  const bodyAst: BodyBlock[] = [makeParagraph(body)];
  const location = opts.location ?? { file: "test.md", line: 1, column: 1 };
  const entryType = opts.type;
  return {
    displayId: makeDisplayId("STK_0001"),
    title: "Test requirement",
    body,
    bodyAst,
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      ...(entryType ? [{ key: "Type", value: entryType }] : []),
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ...(entryType ? [["Type", [entryType]] as [string, string[]]] : []),
    ]),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    type: entryType,
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
// MSL-Q200: modal-multiple
// ---------------------------------------------------------------------------

Deno.test("Q200: fires when ≥2 modals in one sentence", () => {
  const entry = makeEntry(
    "The system shall apply pressure and shall log the event.",
  );
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), true);
});

Deno.test("Q200: silent when modals split across sentences", () => {
  const entry = makeEntry("The system shall apply. The logger shall record.");
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), false);
});

Deno.test("Q200: silent on single modal", () => {
  const entry = makeEntry("The system shall apply pressure.");
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), false);
});

Deno.test("Q200: 3 modals in one sentence still fires once", () => {
  const entry = makeEntry(
    "The brake shall apply, shall log, and shall release.",
  );
  const diags = runModalSentenceRules(entry);
  const q200 = diags.filter((d) => d.code === "MSL-Q200");
  assertEquals(q200.length, 1); // one diagnostic per offending sentence
});

Deno.test("Q200: 'shall not' counts as one modal, not two", () => {
  const entry = makeEntry(
    "The system shall not retry on failure.",
  );
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), false);
});

Deno.test("Q200: 'shall not' + 'shall' counts as two modals", () => {
  // Two distinct modal tokens: "shall not" and "shall".
  const entry = makeEntry(
    "The system shall not retry on failure and shall log the event.",
  );
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), true);
});

// ---------------------------------------------------------------------------
// MSL-Q201: modal-soft-in-normative
// ---------------------------------------------------------------------------

Deno.test("Q201: fires for 'should' in Requirement-typed entry", () => {
  const entry = makeEntry("The system should retry on failure.", {
    type: "Requirement",
  });
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q201"), true);
});

Deno.test("Q201: fires for 'may' in Requirement-typed entry", () => {
  const entry = makeEntry("The driver may override the alert.", {
    type: "Requirement",
  });
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q201"), true);
});

Deno.test("Q201: silent for 'shall' in Requirement-typed entry", () => {
  const entry = makeEntry("The system shall retry on failure.", {
    type: "Requirement",
  });
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q201"), false);
});

Deno.test("Q201: silent for 'should' in a non-Requirement entry (e.g. Test)", () => {
  const entry = makeEntry("The test should verify the brake actuation.", {
    type: "Test",
  });
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q201"), false);
});

Deno.test("Q201: silent for 'should' in entry with no resolved type", () => {
  // Profile-less project: entry type is undefined. Q201 conservatively skips.
  const entry = makeEntry("The system should retry on failure.");
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q201"), false);
});

// ---------------------------------------------------------------------------
// Co-firing
// ---------------------------------------------------------------------------

Deno.test("Q200+Q201: can co-fire on 'The system should retry and should log.' in Requirement", () => {
  // Both: ≥2 modals (Q200) AND soft modal in Requirement (Q201).
  const entry = makeEntry(
    "The system should retry and should log.",
    { type: "Requirement" },
  );
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), true);
  assertEquals(diags.some((d) => d.code === "MSL-Q201"), true);
});

// ---------------------------------------------------------------------------
// File-absolute range
// ---------------------------------------------------------------------------

Deno.test("Q200: range is file-absolute, sentence-span", () => {
  // Use bodyStartLine to verify file-absolute emission.
  const entry = makeEntry(
    "The system shall apply and shall log.",
    {
      location: { file: "/x.md", line: 30, column: 1 },
      bodyStartLine: 32,
    },
  );
  const diags = runModalSentenceRules(entry);
  const q200 = diags.find((d) => d.code === "MSL-Q200");
  assertEquals(q200?.range?.start.line, 32);
});

// ---------------------------------------------------------------------------
// Metadata fields
// ---------------------------------------------------------------------------

Deno.test("Q200: carries correct slug, group, scoreContribution, severity", () => {
  const entry = makeEntry(
    "The system shall apply pressure and shall log the event.",
  );
  const diags = runModalSentenceRules(entry);
  const q200 = diags.find((d) => d.code === "MSL-Q200");
  assertEquals(q200?.slug, "modal-multiple");
  assertEquals(q200?.group, "modal");
  assertEquals(q200?.scoreContribution, 3);
  assertEquals(q200?.severity, "warning");
});

Deno.test("Q201: carries correct slug, group, scoreContribution, severity", () => {
  const entry = makeEntry("The system should retry on failure.", {
    type: "Requirement",
  });
  const diags = runModalSentenceRules(entry);
  const q201 = diags.find((d) => d.code === "MSL-Q201");
  assertEquals(q201?.slug, "modal-soft-in-normative");
  assertEquals(q201?.group, "modal");
  assertEquals(q201?.scoreContribution, 1);
  assertEquals(q201?.severity, "info");
});

// ---------------------------------------------------------------------------
// Silent on non-normative sentences (no modals)
// ---------------------------------------------------------------------------

Deno.test("modal: silent on non-normative sentences", () => {
  const entry = makeEntry("The brake is a critical safety component.", {
    type: "Requirement",
  });
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.length, 0);
});
