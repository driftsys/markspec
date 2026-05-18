/**
 * @module core/lint/runner_test
 *
 * Unit tests for the lint runner: isProseScope predicate and runLint pipeline.
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../model/mod.ts";
import { isProseScope, runLint } from "./runner.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    displayId: "REQ-001",
    title: "Test requirement title",
    body: "The system shall process data correctly.",
    bodyAst: [
      {
        kind: "paragraph",
        content: { text: "The system shall process data correctly.", markers: [] },
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
    source: "markdown",
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

Deno.test("runLint: MSL-Q302 fires for 'some' in body", () => {
  const text = "The system should use some processing mechanism.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text, markers: [] },
        range: { start: { line: 1, column: 1 }, end: { line: 1, column: text.length } },
      },
    ],
  });
  const result = runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q302"), true);
});

Deno.test("runLint: MSL-Q303 fires for 'as appropriate' in body", () => {
  const text = "The system shall operate as appropriate for the situation.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text, markers: [] },
        range: { start: { line: 1, column: 1 }, end: { line: 1, column: text.length } },
      },
    ],
  });
  const result = runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q303"), true);
});

// ---------------------------------------------------------------------------
// Structural rules (via runLint)
// ---------------------------------------------------------------------------

Deno.test("runLint: MSL-Q400 fires when title is too short (< 3 chars)", () => {
  const entry = makeEntry({ title: "Hi" });
  const result = runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q400"), true);
});

Deno.test("runLint: MSL-Q401 fires when body has fewer than 5 words", () => {
  const text = "Too short body.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text, markers: [] },
        range: { start: { line: 1, column: 1 }, end: { line: 1, column: text.length } },
      },
    ],
  });
  const result = runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q401"), true);
});

// ---------------------------------------------------------------------------
// Suppression hygiene rules (via runLint)
// ---------------------------------------------------------------------------

Deno.test("runLint: MSL-Q900 fires when Markspec-disable present but no Rationale", () => {
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
  const result = runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q900"), true);
});

Deno.test("runLint: MSL-Q901 fires when Markspec-disable lists unknown rule code", () => {
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
  const result = runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q901"), true);
});

// ---------------------------------------------------------------------------
// Suppression: valid disable drops the matched rule
// ---------------------------------------------------------------------------

Deno.test("runLint: valid Markspec-disable suppresses MSL-Q302", () => {
  const text = "The system should use some processing mechanism.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text, markers: [] },
        range: { start: { line: 1, column: 1 }, end: { line: 1, column: text.length } },
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
  const result = runLint({ entries: [entry] });
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes.includes("MSL-Q302"), false);
});

// ---------------------------------------------------------------------------
// Diagnostics carry slug + group + scoreContribution
// ---------------------------------------------------------------------------

Deno.test("runLint: diagnostics include slug, group, scoreContribution fields", () => {
  const text = "The system should use some processing mechanism.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text, markers: [] },
        range: { start: { line: 1, column: 1 }, end: { line: 1, column: text.length } },
      },
    ],
  });
  const result = runLint({ entries: [entry] });
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

Deno.test("runLint: output is deterministic for same input", () => {
  const text = "The system should use some processing as appropriate.";
  const entry = makeEntry({
    body: text,
    bodyAst: [
      {
        kind: "paragraph",
        content: { text, markers: [] },
        range: { start: { line: 1, column: 1 }, end: { line: 1, column: text.length } },
      },
    ],
  });
  const r1 = runLint({ entries: [entry] });
  const r2 = runLint({ entries: [entry] });
  assertEquals(
    r1.diagnostics.map((d) => d.code),
    r2.diagnostics.map((d) => d.code),
  );
});
