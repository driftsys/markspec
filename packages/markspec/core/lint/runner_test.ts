/**
 * @module core/lint/runner_test
 *
 * Unit tests for the lint runner: isProseScope predicate and runLint pipeline.
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";
import { isProseScope, runLint } from "./runner.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEntry(
  { displayId, ...overrides }: Partial<Omit<Entry, "displayId">> & {
    displayId?: string;
  } = {},
): Entry {
  return {
    displayId: makeDisplayId(displayId ?? "REQ-001"),
    title: "Test requirement title",
    body: "The system shall process data correctly.",
    bodyAst: [
      {
        kind: "paragraph",
        content: {
          text: "The system shall process data correctly.",
        },
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: 40 },
        },
      },
    ],
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isProseScope
// ---------------------------------------------------------------------------

Deno.test("isProseScope: Requirement-typed authored entry is in-scope", () => {
  const entry = makeEntry({ type: "Requirement" });
  assertEquals(isProseScope(entry), true);
});

Deno.test("isProseScope: Specification-typed entry is in-scope", () => {
  const entry = makeEntry({
    type: "Specification",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Type", value: "Specification" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Type", ["Specification"]],
    ]),
  });
  assertEquals(isProseScope(entry), true);
});

Deno.test("isProseScope: Reference-shape entry is out-of-scope", () => {
  const entry = makeEntry({
    shape: "Reference",
    id: "urn:example:123",
    rawAttributes: [{ key: "Id", value: "urn:example:123" }],
    typedAttributes: new Map([["Id", ["urn:example:123"]]]),
    type: undefined,
  });
  assertEquals(isProseScope(entry), false);
});

Deno.test("isProseScope: Component-typed entry is out-of-scope", () => {
  const entry = makeEntry({
    displayId: "COMP-001",
    type: "Component",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Type", value: "Component" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Type", ["Component"]],
    ]),
  });
  assertEquals(isProseScope(entry), false);
});

// ---------------------------------------------------------------------------
// Lexicon rules (via runLint)
// ---------------------------------------------------------------------------

Deno.test("runLint: MSL-Q302 fires for 'some' in body", async () => {
  const text = "The system should use some processing mechanism.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text },
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: text.length },
        },
      },
    ],
  });
  const result = await runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q302"), true);
});

Deno.test("runLint: MSL-Q303 fires for 'as appropriate' in body", async () => {
  const text = "The system shall operate as appropriate for the situation.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text },
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: text.length },
        },
      },
    ],
  });
  const result = await runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q303"), true);
});

// ---------------------------------------------------------------------------
// Structural rules (via runLint)
// ---------------------------------------------------------------------------

Deno.test("runLint: MSL-Q400 fires when title is too short (< 3 chars)", async () => {
  const entry = makeEntry({ title: "Hi" });
  const result = await runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q400"), true);
});

Deno.test("runLint: MSL-Q401 fires when body has fewer than 5 words", async () => {
  const text = "Too short body.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text },
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: text.length },
        },
      },
    ],
  });
  const result = await runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q401"), true);
});

// ---------------------------------------------------------------------------
// Suppression hygiene rules (via runLint)
// ---------------------------------------------------------------------------

Deno.test("runLint: MSL-Q900 fires when Markspec-disable present but no Rationale", async () => {
  const entry = makeEntry({
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Type", value: "Requirement" },
      { key: "Markspec-disable", value: "MSL-Q302" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Type", ["Requirement"]],
      ["Markspec-disable", ["MSL-Q302"]],
    ]),
  });
  const result = await runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q900"), true);
});

Deno.test("runLint: MSL-Q901 fires when Markspec-disable lists unknown rule code", async () => {
  const entry = makeEntry({
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Type", value: "Requirement" },
      { key: "Markspec-disable", value: "MSL-ZZZZ" },
      { key: "Rationale", value: "Accepted for this specific entry." },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Type", ["Requirement"]],
      ["Markspec-disable", ["MSL-ZZZZ"]],
      ["Rationale", ["Accepted for this specific entry."]],
    ]),
  });
  const result = await runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q901"), true);
});

// ---------------------------------------------------------------------------
// Suppression: valid disable drops the matched rule
// ---------------------------------------------------------------------------

Deno.test("runLint: valid Markspec-disable suppresses MSL-Q302", async () => {
  const text = "The system should use some processing mechanism.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text },
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: text.length },
        },
      },
    ],
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Type", value: "Requirement" },
      { key: "Markspec-disable", value: "MSL-Q302" },
      { key: "Rationale", value: "Reviewed and accepted." },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Type", ["Requirement"]],
      ["Markspec-disable", ["MSL-Q302"]],
      ["Rationale", ["Reviewed and accepted."]],
    ]),
  });
  const result = await runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q302"), false);
});

// ---------------------------------------------------------------------------
// Diagnostics carry slug + group + scoreContribution
// ---------------------------------------------------------------------------

Deno.test("runLint: diagnostics include slug, group, scoreContribution fields", async () => {
  const text = "The system should use some processing mechanism.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text },
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: text.length },
        },
      },
    ],
  });
  const result = await runLint({ entries: [entry] });
  const q302 = result.diagnostics.find((d) => d.code === "MSL-Q302");
  assertEquals(q302 !== undefined, true);
  // deno-lint-ignore no-explicit-any
  const d = q302 as any;
  assertEquals(typeof d.slug, "string");
  assertEquals(typeof d.group, "string");
  assertEquals(typeof d.scoreContribution, "number");
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

Deno.test("runLint: output is deterministic for same input", async () => {
  const text = "The system should use some processing as appropriate.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text },
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: text.length },
        },
      },
    ],
  });
  const r1 = await runLint({ entries: [entry] });
  const r2 = await runLint({ entries: [entry] });
  assertEquals(
    r1.diagnostics.map((d) => d.code),
    r2.diagnostics.map((d) => d.code),
  );
});

// ---------------------------------------------------------------------------
// Q902: disable-unused (runner integration)
// ---------------------------------------------------------------------------

Deno.test("runLint: MSL-Q902 fires when Markspec-disable code did not match any diagnostic", async () => {
  // "incose-r7-vague-term" → MSL-Q302 (vague-term). Body has no vague term → Q302 won't fire.
  const text = "The system shall process the request within 200 ms.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text },
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: text.length },
        },
      },
    ],
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Type", value: "Requirement" },
      { key: "Markspec-disable", value: "MSL-Q302" },
      { key: "Rationale", value: "Reviewed and accepted." },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Type", ["Requirement"]],
      ["Markspec-disable", ["MSL-Q302"]],
      ["Rationale", ["Reviewed and accepted."]],
    ]),
  });
  const result = await runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q902"), true);
});

Deno.test("runLint: MSL-Q902 silent when Markspec-disable code did match a suppressed diagnostic", async () => {
  // Body contains "some" → Q302 fires, gets suppressed → no Q902.
  const text = "The system should use some processing mechanism.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text },
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: text.length },
        },
      },
    ],
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Type", value: "Requirement" },
      { key: "Markspec-disable", value: "MSL-Q302" },
      { key: "Rationale", value: "Reviewed and accepted." },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Type", ["Requirement"]],
      ["Markspec-disable", ["MSL-Q302"]],
      ["Rationale", ["Reviewed and accepted."]],
    ]),
  });
  const result = await runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  // Q302 was suppressed and actually matched → Q902 must NOT fire.
  assertEquals(codes.includes("MSL-Q902"), false);
  // Q302 itself must not appear (it was suppressed).
  assertEquals(codes.includes("MSL-Q302"), false);
});

Deno.test("runLint: MSL-Q902 silent when entry has no Markspec-disable", async () => {
  const text = "The system shall process the request within 200 ms.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text },
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: text.length },
        },
      },
    ],
  });
  const result = await runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q902"), false);
});

Deno.test("runLint: MSL-Q902 emits one diagnostic per unused code", async () => {
  // Disable three codes; body triggers none of them.
  const text = "The system shall process the request within 200 ms.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text },
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: text.length },
        },
      },
    ],
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Type", value: "Requirement" },
      // Q302 (vague-term), Q303 (subjective), Q304 (weak-imperative) — none fire on this body.
      { key: "Markspec-disable", value: "MSL-Q302, MSL-Q303, MSL-Q304" },
      { key: "Rationale", value: "Reviewed and accepted." },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Type", ["Requirement"]],
      ["Markspec-disable", ["MSL-Q302", "MSL-Q303", "MSL-Q304"]],
      ["Rationale", ["Reviewed and accepted."]],
    ]),
  });
  const result = await runLint({ entries: [entry] });
  const q902s = result.diagnostics.filter((d) => d.code === "MSL-Q902");
  // One Q902 per unused code → 3 total.
  assertEquals(q902s.length, 3);
});

Deno.test("runLint: MSL-Q902 has correct fields (info, score 0, group disable)", async () => {
  const text = "The system shall process the request within 200 ms.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text },
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: text.length },
        },
      },
    ],
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Type", value: "Requirement" },
      { key: "Markspec-disable", value: "MSL-Q302" },
      { key: "Rationale", value: "Reviewed and accepted." },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Type", ["Requirement"]],
      ["Markspec-disable", ["MSL-Q302"]],
      ["Rationale", ["Reviewed and accepted."]],
    ]),
  });
  const result = await runLint({ entries: [entry] });
  const d = result.diagnostics.find((x) => x.code === "MSL-Q902");
  assertEquals(d !== undefined, true);
  assertEquals(d!.severity, "info");
  assertEquals(d!.scoreContribution, 0);
  assertEquals(d!.group, "disable");
  assertEquals(d!.slug, "disable-unused");
});

Deno.test("runLint: MSL-Q902 does NOT fire for unknown codes (Q901's territory)", async () => {
  // Unknown code 'MSL-ZZZZ' triggers Q901 (unknown-rule). Q902 must NOT
  // ALSO fire on the same token — that would double-diagnose every
  // malformed disable entry.
  const text = "The system shall process the request within 200 ms.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text },
        range: {
          start: { line: 1, column: 1 },
          end: { line: 1, column: text.length },
        },
      },
    ],
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Type", value: "Requirement" },
      { key: "Markspec-disable", value: "MSL-ZZZZ" },
      { key: "Rationale", value: "Reviewed and accepted." },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Type", ["Requirement"]],
      ["Markspec-disable", ["MSL-ZZZZ"]],
      ["Rationale", ["Reviewed and accepted."]],
    ]),
  });
  const result = await runLint({ entries: [entry] });
  // Q901 fires (unknown rule).
  assertEquals(
    result.diagnostics.some((d) => d.code === "MSL-Q901"),
    true,
  );
  // Q902 does NOT also fire on the same token.
  assertEquals(
    result.diagnostics.some((d) => d.code === "MSL-Q902"),
    false,
  );
});
