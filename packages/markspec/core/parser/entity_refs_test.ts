/**
 * @module core/parser/entity_refs_test
 *
 * Unit tests for `$Identifier` entity-reference extraction.
 */

import { assertEquals } from "@std/assert";
import { classifyConvention, extractEntityRefs } from "./entity_refs.ts";

const baseLocation = { file: "test.md", line: 1, column: 1 };

// ---------------------------------------------------------------------------
// classifyConvention
// ---------------------------------------------------------------------------

Deno.test("classifyConvention: PascalCase single segment → type", () => {
  assertEquals(classifyConvention("BrakeController"), "type");
});

Deno.test("classifyConvention: PascalCase single-uppercase segment → type", () => {
  assertEquals(classifyConvention("Asil"), "type");
});

Deno.test("classifyConvention: all-uppercase no underscore → type", () => {
  // Per spec §2.5.2, `$ASIL` parses as PascalCase (single uppercase
  // segment), not as a constant. Constants must include `_` or a
  // digit to distinguish.
  assertEquals(classifyConvention("ASIL"), "type");
});

Deno.test("classifyConvention: camelCase → instance", () => {
  assertEquals(classifyConvention("rawPressure"), "instance");
});

Deno.test("classifyConvention: camelCase single lowercase letter → instance", () => {
  assertEquals(classifyConvention("x"), "instance");
});

Deno.test("classifyConvention: SCREAMING_SNAKE → constant", () => {
  assertEquals(classifyConvention("DEBOUNCE_WINDOW"), "constant");
});

Deno.test("classifyConvention: uppercase with digit → constant", () => {
  // Digit qualifies it as a constant under the same "needs _ or digit"
  // disambiguation rule.
  assertEquals(classifyConvention("ASIL3"), "constant");
});

// ---------------------------------------------------------------------------
// extractEntityRefs
// ---------------------------------------------------------------------------

Deno.test("extractEntityRefs: extracts a single $Identifier from prose", () => {
  const refs = extractEntityRefs("The $brakeSensor reports.", baseLocation);
  assertEquals(refs.length, 1);
  assertEquals(refs[0].ident, "$brakeSensor");
  assertEquals(refs[0].convention, "instance");
});

Deno.test("extractEntityRefs: skips $-prefixed tokens inside fenced code", () => {
  const body = [
    "The $sensor outside.",
    "```",
    "let $foo = 1;",
    "```",
  ].join("\n");
  const refs = extractEntityRefs(body, baseLocation);
  assertEquals(refs.map((r) => r.ident), ["$sensor"]);
});

Deno.test("extractEntityRefs: skips both halves of an inline $$math$$ fence", () => {
  // The regex matches `$<letter>...`, so `$$math$$` matches just once
  // — at the second `$` of the opening fence, where the next char is
  // a letter. That match is rejected by the "preceded by another $"
  // guard. Net result: zero refs.
  const refs = extractEntityRefs("Inline $$math$$ here.", baseLocation);
  assertEquals(refs.length, 0);
});

Deno.test("extractEntityRefs: standalone $ident inside inline math still fires (known limitation)", () => {
  // Spec §2.5.2 says entity refs aren't recognised in math content,
  // but the current implementation tracks `$$` opener/closer only at
  // the regex level — it doesn't model an inline single-`$` math
  // region. A `$ident` mid-formula therefore extracts. Pinned for
  // visibility; a future slice could pre-scan inline math fences.
  const refs = extractEntityRefs("$$x = $foo + 1$$", baseLocation);
  assertEquals(refs.length, 1);
  assertEquals(refs[0].ident, "$foo");
});

Deno.test("extractEntityRefs: skips $ident inside a multi-line $$ display-math block", () => {
  const body = [
    "Before $alpha here.",
    "$$",
    "E = $betaMatrix + 1",
    "$$",
    "After $gamma here.",
  ].join("\n");
  const refs = extractEntityRefs(body, baseLocation);
  assertEquals(refs.map((r) => r.ident), ["$alpha", "$gamma"]);
});

Deno.test("extractEntityRefs: discards backslash-escaped $ident", () => {
  const refs = extractEntityRefs("Literal \\$dollar text.", baseLocation);
  assertEquals(refs.length, 0);
});

Deno.test("extractEntityRefs: reports line and column for each ref", () => {
  const body = "line one\nThe $sensor is here.\nline three";
  const refs = extractEntityRefs(body, baseLocation);
  assertEquals(refs.length, 1);
  assertEquals(refs[0].location.line, 2); // baseLocation.line + 1
  // "The $sensor" — `$` is at column 5 (1-based).
  assertEquals(refs[0].location.column, 5);
});

Deno.test("extractEntityRefs: returns empty array for body with no refs", () => {
  const refs = extractEntityRefs("Plain prose with no dollars.", baseLocation);
  assertEquals(refs.length, 0);
});
