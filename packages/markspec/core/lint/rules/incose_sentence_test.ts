/**
 * @module core/lint/rules/incose_sentence_test
 *
 * Unit tests for INCOSE sentence rules MSL-Q306 through MSL-Q312
 * and entry-level MSL-Q402.
 */

import { assertEquals } from "@std/assert";
import type { BodyBlock } from "../../ast/nodes.ts";
import type { Entry } from "../../model/mod.ts";
import { makeDisplayId } from "../../model/mod.ts";
import { runIncoseSentenceRules } from "./incose_sentence.ts";

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

interface MakeEntryOpts {
  location?: { file: string; line: number; column: number };
  bodyStartLine?: number;
}

/**
 * Build a minimal Authored entry for testing. Supports multi-paragraph bodies
 * (separate text blocks with `\n\n` in `body`) — the body is split on `\n\n`
 * and each chunk becomes its own `paragraph` BodyBlock. Line numbers for
 * subsequent paragraphs are approximated by offset from the first paragraph.
 */
function makeEntry(
  body: string,
  opts: MakeEntryOpts = {},
): Entry {
  const paragraphs = body.split(/\n\n+/);
  const bodyAst: BodyBlock[] = [];
  let lineOffset = 1;
  for (const para of paragraphs) {
    if (para.trim().length === 0) continue;
    bodyAst.push(makeParagraph(para.trim(), lineOffset));
    // Advance line offset: count newlines in para + 2 for the separator.
    lineOffset += (para.match(/\n/g)?.length ?? 0) + 2;
  }
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
// MSL-Q306: incose-r11-separate-clauses
// ---------------------------------------------------------------------------

Deno.test("Q306: separate clauses (≥2 conditions, <3)", () => {
  const entry = makeEntry(
    "The system, when X and when Y, shall apply.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q306"), true);
});

Deno.test("Q306: silent when Q103 already fires (≥3 conditions)", () => {
  // Slice 6's Q103 covers this case; Q306 must NOT also fire here.
  const entry = makeEntry(
    "When X, when Y, when Z, the system shall apply.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q306"), false);
});

Deno.test("Q306: silent on exactly 1 condition keyword", () => {
  const entry = makeEntry(
    "When the pedal is pressed, the brake controller shall apply pressure.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q306"), false);
});

Deno.test("Q306: silent on non-normative sentences (no modal)", () => {
  const entry = makeEntry("The system, when X and when Y, is configured.");
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q306"), false);
});

Deno.test("Q306: carries correct metadata", () => {
  const entry = makeEntry(
    "The system, when X and when Y, shall apply.",
  );
  const diags = runIncoseSentenceRules(entry);
  const q306 = diags.find((d) => d.code === "MSL-Q306");
  assertEquals(q306?.slug, "incose-r11-separate-clauses");
  assertEquals(q306?.group, "incose");
  assertEquals(q306?.scoreContribution, 1);
  assertEquals(q306?.severity, "info");
});

// ---------------------------------------------------------------------------
// MSL-Q307: incose-r18-single-thought
// ---------------------------------------------------------------------------

Deno.test("Q307: single thought — two obligations with 'and'", () => {
  const entry = makeEntry("The brake shall apply and the engine shall stop.");
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q307"), true);
});

Deno.test("Q307: silent when only one modal (no compound)", () => {
  const entry = makeEntry(
    "The brake controller shall apply pressure and release gradually.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q307"), false);
});

Deno.test("Q307: silent when no 'and' linking two modals", () => {
  const entry = makeEntry("The system shall apply and log.");
  // Only 1 modal verb (`shall`); 'and' joins two verbs to the same modal.
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q307"), false);
});

Deno.test("Q307: carries correct metadata", () => {
  const entry = makeEntry("The brake shall apply and the engine shall stop.");
  const diags = runIncoseSentenceRules(entry);
  const q307 = diags.find((d) => d.code === "MSL-Q307");
  assertEquals(q307?.slug, "incose-r18-single-thought");
  assertEquals(q307?.group, "incose");
  assertEquals(q307?.scoreContribution, 3);
  assertEquals(q307?.severity, "warning");
});

// ---------------------------------------------------------------------------
// MSL-Q308: incose-r19-combinator
// ---------------------------------------------------------------------------

Deno.test("Q308: combinator 'however' joining clauses", () => {
  const entry = makeEntry(
    "The system shall log, however the logger shall rotate files.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q308"), true);
});

Deno.test("Q308: combinator 'whereas' joining clauses", () => {
  const entry = makeEntry(
    "The system shall apply force, whereas the safety unit shall limit torque.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q308"), true);
});

Deno.test("Q308: combinator 'but' in normative sentence", () => {
  const entry = makeEntry(
    "The system shall apply force, but the controller shall limit it.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q308"), true);
});

Deno.test("Q308: silent in non-normative sentence", () => {
  // No modal → not normative → Q308 skips.
  const entry = makeEntry(
    "The component is designed to respond quickly, however it is not required.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q308"), false);
});

Deno.test("Q308: carries correct metadata", () => {
  const entry = makeEntry(
    "The system shall log, however the logger shall rotate files.",
  );
  const diags = runIncoseSentenceRules(entry);
  const q308 = diags.find((d) => d.code === "MSL-Q308");
  assertEquals(q308?.slug, "incose-r19-combinator");
  assertEquals(q308?.group, "incose");
  assertEquals(q308?.scoreContribution, 1);
  assertEquals(q308?.severity, "info");
});

// ---------------------------------------------------------------------------
// MSL-Q309: incose-r24-pronouns
// ---------------------------------------------------------------------------

Deno.test("Q309: pronoun without antecedent ('it')", () => {
  const entry = makeEntry("The brake controller shall apply it.");
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q309"), true);
});

Deno.test("Q309: pronoun 'this' in normative sentence", () => {
  const entry = makeEntry("The system shall validate this before processing.");
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q309"), true);
});

Deno.test("Q309: pronoun 'they' in normative sentence", () => {
  const entry = makeEntry("The sensors shall report when they detect a fault.");
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q309"), true);
});

Deno.test("Q309: silent when 'that' is a relative clause", () => {
  const entry = makeEntry(
    "The brake controller shall apply pressure that exceeds 100N.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q309"), false);
});

Deno.test("Q309: silent in non-normative sentence", () => {
  // No modal → not normative → Q309 skips.
  const entry = makeEntry("The brake is a component, and it is critical.");
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q309"), false);
});

Deno.test("Q309: carries correct metadata", () => {
  const entry = makeEntry("The brake controller shall apply it.");
  const diags = runIncoseSentenceRules(entry);
  const q309 = diags.find((d) => d.code === "MSL-Q309");
  assertEquals(q309?.slug, "incose-r24-pronouns");
  assertEquals(q309?.group, "incose");
  assertEquals(q309?.scoreContribution, 1);
  assertEquals(q309?.severity, "info");
});

// ---------------------------------------------------------------------------
// MSL-Q311: incose-r27-explicit-conditions
// ---------------------------------------------------------------------------

Deno.test("Q311: implicit condition 'where relevant'", () => {
  const entry = makeEntry(
    "The system shall, where relevant, log warnings.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q311"), true);
});

Deno.test("Q311: implicit condition 'when applicable'", () => {
  const entry = makeEntry(
    "The system shall, when applicable, engage the safety mode.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q311"), true);
});

Deno.test("Q311: implicit condition 'as appropriate'", () => {
  const entry = makeEntry(
    "The module shall apply corrections as appropriate.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q311"), true);
});

Deno.test("Q311: silent when condition is explicit (EARS leading clause)", () => {
  const entry = makeEntry(
    "Where logging is enabled, the system shall log warnings.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q311"), false);
});

Deno.test("Q311: silent when EARS 'When' starts the sentence", () => {
  const entry = makeEntry(
    "When applicable, the system shall engage the safety mode.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q311"), false);
});

Deno.test("Q311: silent in non-normative sentence", () => {
  // No modal → not normative.
  const entry = makeEntry("The system is, where relevant, audited by QA.");
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q311"), false);
});

Deno.test("Q311: carries correct metadata", () => {
  const entry = makeEntry(
    "The system shall, where relevant, log warnings.",
  );
  const diags = runIncoseSentenceRules(entry);
  const q311 = diags.find((d) => d.code === "MSL-Q311");
  assertEquals(q311?.slug, "incose-r27-explicit-conditions");
  assertEquals(q311?.group, "incose");
  assertEquals(q311?.scoreContribution, 1);
  assertEquals(q311?.severity, "info");
});

// ---------------------------------------------------------------------------
// MSL-Q312: incose-r33-range-of-values
// ---------------------------------------------------------------------------

Deno.test("Q312: bare quantity without tolerance ('200N')", () => {
  const entry = makeEntry("The brake shall apply 200N within 200 ms.");
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q312"), true);
});

Deno.test("Q312: silent with explicit tolerance ('± 5N')", () => {
  const entry = makeEntry(
    "The brake shall apply 200N ± 5N within 200 ms ± 10 ms.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q312"), false);
});

Deno.test("Q312: silent on plain numbers without units", () => {
  // "5 entries" / "version 1" — no unit, so not a measurable quantity.
  const entry = makeEntry("The system shall log 5 entries at version 1.");
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q312"), false);
});

Deno.test("Q312: silent when 'between ... and ...' tolerance present", () => {
  const entry = makeEntry(
    "The system shall apply between 150N and 250N force.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q312"), false);
});

Deno.test("Q312: fires on time unit (ms) without tolerance", () => {
  const entry = makeEntry(
    "The system shall respond within 500 ms from sensor input.",
  );
  // "within" here is not a tolerance marker by the current heuristic;
  // however Q312 fires on bare 500 ms. This is an accepted false positive
  // (the author should add ± or use ≤ to be precise).
  // NOTE: "within" is NOT in TOLERANCE_MARKER_RE; only "up to"/"at most"/"≤" etc. are.
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q312"), true);
});

Deno.test("Q312: silent when ≤ comparison operator acts as tolerance", () => {
  const entry = makeEntry(
    "The system shall respond in ≤ 500 ms from sensor input.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q312"), false);
});

Deno.test("Q312: silent in non-normative sentence", () => {
  // No modal → not normative.
  const entry = makeEntry("The sensor measures 200N force at the brake pad.");
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q312"), false);
});

Deno.test("Q312: carries correct metadata", () => {
  const entry = makeEntry("The brake shall apply 200N of force.");
  const diags = runIncoseSentenceRules(entry);
  const q312 = diags.find((d) => d.code === "MSL-Q312");
  assertEquals(q312?.slug, "incose-r33-range-of-values");
  assertEquals(q312?.group, "incose");
  assertEquals(q312?.scoreContribution, 1);
  assertEquals(q312?.severity, "info");
});

// ---------------------------------------------------------------------------
// MSL-Q402: struct-multiple-shall (entry-level)
// ---------------------------------------------------------------------------

Deno.test("Q402: entry-level multiple shall, no Q200 overlap", () => {
  // Two paragraphs, two modals, one per sentence — no Q200.
  const entry = makeEntry(
    "The system shall apply.\n\nThe system shall log.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q402"), true);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), false);
});

Deno.test("Q402: silent when Q200 fires (single sentence ≥2 modals)", () => {
  // Single sentence with 2 modals → Q402 must defer (Q200 territory).
  const entry = makeEntry("The system shall apply and shall log.");
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q402"), false);
});

Deno.test("Q402: silent on single modal", () => {
  const entry = makeEntry("The system shall apply pressure.");
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q402"), false);
});

Deno.test("Q402: fires across two sentences in the same paragraph", () => {
  // Two sentences with one modal each — both in the same paragraph block.
  const entry = makeEntry(
    "The system shall apply. The system shall log.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q402"), true);
});

Deno.test("Q402: carries correct metadata", () => {
  const entry = makeEntry(
    "The system shall apply.\n\nThe system shall log.",
  );
  const diags = runIncoseSentenceRules(entry);
  const q402 = diags.find((d) => d.code === "MSL-Q402");
  assertEquals(q402?.slug, "struct-multiple-shall");
  assertEquals(q402?.group, "incose");
  assertEquals(q402?.scoreContribution, 3);
  assertEquals(q402?.severity, "warning");
});

// ---------------------------------------------------------------------------
// Range emission: file-absolute, sentence-span
// ---------------------------------------------------------------------------

Deno.test("Range emission: file-absolute, sentence-span", () => {
  const entry = makeEntry(
    "The brake controller shall apply it.",
    {
      location: { file: "/x.md", line: 30, column: 1 },
      bodyStartLine: 32,
    },
  );
  const diags = runIncoseSentenceRules(entry);
  const q309 = diags.find((d) => d.code === "MSL-Q309");
  assertEquals(q309?.range?.start.line, 32);
});

// ---------------------------------------------------------------------------
// Silent on non-normative sentences (no modals at all)
// ---------------------------------------------------------------------------

Deno.test("INCOSE: all rules silent on non-normative sentences", () => {
  // No modal → not normative → no sentence-level rules fire.
  // Also no Q402 since total modals = 0.
  const entry = makeEntry(
    "The brake is a critical safety system, when relevant.",
  );
  const diags = runIncoseSentenceRules(entry);
  // Only sentence-level incose rules; Q402 also silent (0 modals < 2).
  assertEquals(diags.filter((d) => d.code.startsWith("MSL-Q3")).length, 0);
  assertEquals(diags.some((d) => d.code === "MSL-Q402"), false);
});

Deno.test("Q309: per-occurrence comma exception ('When X, it ... it ...')", () => {
  // The first `it` is exempted (after a comma — EARS lead-in). The
  // subsequent `it` is NOT after a comma and MUST fire Q309. Previously
  // a sentence-wide regex check incorrectly exempted both occurrences.
  const entry = makeEntry(
    "When the pedal is pressed, it shall log and then it shall store it.",
  );
  const diags = runIncoseSentenceRules(entry);
  const q309 = diags.filter((d) => d.code === "MSL-Q309");
  // At least one Q309 fires (for the second/third `it`, not the first).
  assertEquals(q309.length >= 1, true);
});

Deno.test("Q307: can co-fire with modal-multiple territory", () => {
  // Q307 fires on `and`-joined dual-modal sentence; the same construct
  // would also trigger Q200 (slice 7) when run through the full pipeline.
  // We test Q307 in isolation here — runner-level integration confirms
  // both fire together (slice 7 wired Q200; this slice wired Q307).
  const entry = makeEntry(
    "The brake shall apply and the engine shall stop.",
  );
  const diags = runIncoseSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q307"), true);
  // Q200 is in modal_sentence.ts, not incose_sentence.ts — verify it
  // is NOT emitted by THIS rule module (cross-module dedupe via the
  // runner, not via these rules).
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), false);
});
