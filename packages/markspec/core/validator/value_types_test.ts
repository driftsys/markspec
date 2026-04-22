/**
 * @module core/validator/value_types_test
 *
 * Unit tests for per-type value validators.
 */

import { assertEquals } from "@std/assert";
import { validateValue } from "./value_types.ts";
import type { AttrDecl } from "../model/mod.ts";

function decl(type: AttrDecl["type"], opts: Partial<AttrDecl> = {}): AttrDecl {
  return {
    name: opts.name ?? "X",
    type,
    required: opts.required ?? false,
    cardinality: opts.cardinality ?? { lower: 0, upper: 1 },
    values: opts.values,
    inverse: opts.inverse,
  };
}

// text
Deno.test("validateValue: text accepts any string", () => {
  const d = decl("text");
  assertEquals(validateValue("hello", d), null);
  assertEquals(validateValue("", d), null);
  assertEquals(validateValue("multiline\nstring", d), null);
});

// integer
Deno.test("validateValue: integer accepts digits (positive + negative)", () => {
  const d = decl("integer");
  assertEquals(validateValue("0", d), null);
  assertEquals(validateValue("42", d), null);
  assertEquals(validateValue("-42", d), null);
  assertEquals(validateValue("1000000", d), null);
});

Deno.test("validateValue: integer rejects non-integer formats", () => {
  const d = decl("integer");
  for (const v of ["42.5", "abc", "", "1e10"]) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid integer`);
    }
  }
});

// boolean
Deno.test("validateValue: boolean accepts true/false", () => {
  const d = decl("boolean");
  assertEquals(validateValue("true", d), null);
  assertEquals(validateValue("false", d), null);
});

Deno.test("validateValue: boolean rejects other strings", () => {
  const d = decl("boolean");
  for (const v of ["True", "yes", "1"]) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid boolean`);
    }
  }
});

// date
Deno.test("validateValue: date accepts ISO 8601 YYYY-MM-DD", () => {
  const d = decl("date");
  assertEquals(validateValue("2024-01-15", d), null);
  assertEquals(validateValue("2026-04-22", d), null);
  assertEquals(validateValue("1999-12-31", d), null);
});

Deno.test("validateValue: date rejects other formats", () => {
  const d = decl("date");
  const bad = [
    "2024/01/15",
    "01-15-2024",
    "2024-1-15",
    "2024-01-15T00:00:00",
    "not a date",
    "",
  ];
  for (const v of bad) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid date`);
    }
  }
});

// enum
Deno.test("validateValue: enum accepts declared values", () => {
  const d = decl("enum", { values: ["draft", "approved", "deprecated"] });
  assertEquals(validateValue("draft", d), null);
  assertEquals(validateValue("approved", d), null);
  assertEquals(validateValue("deprecated", d), null);
});

Deno.test("validateValue: enum rejects undeclared values", () => {
  const d = decl("enum", { values: ["draft", "approved"] });
  const r1 = validateValue("pending", d);
  if (r1 === null) throw new Error("expected 'pending' to be invalid enum");
  if (!r1.includes("pending")) {
    throw new Error(`expected value in error message: ${r1}`);
  }
});

Deno.test("validateValue: enum is case-sensitive", () => {
  const d = decl("enum", { values: ["Draft"] });
  assertEquals(validateValue("Draft", d), null);
  const r = validateValue("draft", d);
  if (r === null) throw new Error("expected lowercase 'draft' to be invalid");
});
