/**
 * @module core/util/line_endings_test
 *
 * Unit tests for line-ending detection and normalisation helpers.
 */

import { assertEquals } from "@std/assert";
import {
  applyLineEnding,
  detectLineEnding,
  normalizeLineEndings,
} from "./line_endings.ts";

Deno.test("detectLineEnding: empty string → lf", () => {
  assertEquals(detectLineEnding(""), "lf");
});

Deno.test("detectLineEnding: no line breaks → lf", () => {
  assertEquals(detectLineEnding("single line"), "lf");
});

Deno.test("detectLineEnding: pure LF → lf", () => {
  assertEquals(detectLineEnding("a\nb\n"), "lf");
});

Deno.test("detectLineEnding: pure CRLF → crlf", () => {
  assertEquals(detectLineEnding("a\r\nb\r\n"), "crlf");
});

Deno.test("detectLineEnding: pure CR (legacy Mac) → cr", () => {
  assertEquals(detectLineEnding("a\rb\r"), "cr");
});

Deno.test("detectLineEnding: first separator wins on mixed input", () => {
  assertEquals(detectLineEnding("first\r\nthen\n"), "crlf");
  assertEquals(detectLineEnding("first\nthen\r\n"), "lf");
});

Deno.test("normalizeLineEndings: LF passes through unchanged", () => {
  const text = "a\nb\nc\n";
  assertEquals(normalizeLineEndings(text), text);
});

Deno.test("normalizeLineEndings: CRLF collapses to LF", () => {
  assertEquals(normalizeLineEndings("a\r\nb\r\n"), "a\nb\n");
});

Deno.test("normalizeLineEndings: bare CR collapses to LF", () => {
  assertEquals(normalizeLineEndings("a\rb\r"), "a\nb\n");
});

Deno.test("normalizeLineEndings: mixed CRLF and LF normalises both", () => {
  assertEquals(normalizeLineEndings("a\r\nb\nc\r\n"), "a\nb\nc\n");
});

Deno.test("applyLineEnding: lf is identity", () => {
  assertEquals(applyLineEnding("a\nb\n", "lf"), "a\nb\n");
});

Deno.test("applyLineEnding: crlf converts every LF", () => {
  assertEquals(applyLineEnding("a\nb\n", "crlf"), "a\r\nb\r\n");
});

Deno.test("applyLineEnding: cr converts every LF", () => {
  assertEquals(applyLineEnding("a\nb\n", "cr"), "a\rb\r");
});

Deno.test("CRLF round-trip via apply(normalize(x))", () => {
  const original = "alpha\r\nbeta\r\ngamma\r\n";
  const normalised = normalizeLineEndings(original);
  const restored = applyLineEnding(normalised, "crlf");
  assertEquals(restored, original);
});
