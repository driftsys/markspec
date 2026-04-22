/**
 * @module core/validator/pattern_test
 *
 * Unit tests for display-ID pattern compilation.
 */

import { assertEquals } from "@std/assert";
import { compileDisplayIdPattern } from "./pattern.ts";

Deno.test("compileDisplayIdPattern: bare {n} becomes \\d+", () => {
  const r = compileDisplayIdPattern("REQ-{n}");
  assertEquals(r.test("REQ-1"), true);
  assertEquals(r.test("REQ-123"), true);
  assertEquals(r.test("REQ-9999"), true);
  assertEquals(r.test("REQ-"), false);
  assertEquals(r.test("REQ-abc"), false);
  assertEquals(r.test("XREQ-1"), false);
  assertEquals(r.test("REQ-1X"), false);
});

Deno.test("compileDisplayIdPattern: {n:04d} requires exactly 4 digits", () => {
  const r = compileDisplayIdPattern("REQ-{n:04d}");
  assertEquals(r.test("REQ-0001"), true);
  assertEquals(r.test("REQ-9999"), true);
  assertEquals(r.test("REQ-1"), false);
  assertEquals(r.test("REQ-12345"), false);
});

Deno.test("compileDisplayIdPattern: multi-segment prefix allowed", () => {
  const r = compileDisplayIdPattern("STAKE-REQ-{n:06d}");
  assertEquals(r.test("STAKE-REQ-000001"), true);
  assertEquals(r.test("STAKE-REQ-999999"), true);
  assertEquals(r.test("STAKE-REQ-123"), false);
});

Deno.test("compileDisplayIdPattern: pattern is anchored (no prefix/suffix slop)", () => {
  const r = compileDisplayIdPattern("REQ-{n:03d}");
  assertEquals(r.test("REQ-001"), true);
  assertEquals(r.test("XREQ-001"), false);
  assertEquals(r.test("REQ-001X"), false);
  assertEquals(r.test(" REQ-001"), false);
  assertEquals(r.test("REQ-001 "), false);
});

Deno.test("compileDisplayIdPattern: regex metachars in literal prefix are escaped", () => {
  const r = compileDisplayIdPattern("A.B-{n}");
  assertEquals(r.test("A.B-42"), true);
  assertEquals(r.test("AXB-42"), false);
});

Deno.test("compileDisplayIdPattern: missing {n} placeholder throws", () => {
  try {
    compileDisplayIdPattern("REQ-");
    throw new Error("expected compileDisplayIdPattern to throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes("{n}")) {
      throw new Error(`expected '{n}' in error message, got: ${msg}`);
    }
  }
});

Deno.test("compileDisplayIdPattern: invalid padding spec throws", () => {
  try {
    compileDisplayIdPattern("REQ-{n:abc}");
    throw new Error("expected compileDisplayIdPattern to throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes("invalid")) {
      throw new Error(`expected 'invalid' in error message, got: ${msg}`);
    }
  }
});
