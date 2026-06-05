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

Deno.test("compileDisplayIdPattern: {n:4d} (no leading zero) now compiles (#596)", () => {
  // The annex documents SRS_{n:4d} / HAZ_{n:3d} as valid, and the mint
  // parser accepts them — classification must too, or `markspec check`
  // crashes. {n:4d} is exactly N digits, same as {n:04d}.
  const r = compileDisplayIdPattern("STK_{n:4d}");
  assertEquals(r.test("STK_0001"), true);
  assertEquals(r.test("STK_9999"), true);
  assertEquals(r.test("STK_1"), false); // wrong width
  assertEquals(r.test("STK_12345"), false);
});

Deno.test("compileDisplayIdPattern: {n:0d} (zero width) throws (#596)", () => {
  try {
    compileDisplayIdPattern("REQ-{n:0d}");
    throw new Error("expected compileDisplayIdPattern to throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes("invalid")) {
      throw new Error(`expected 'invalid' in error message, got: ${msg}`);
    }
  }
});

Deno.test("compileDisplayIdPattern: duplicate named placeholder throws clean message (#597)", () => {
  // Previously surfaced as a raw 'Duplicate capture group name' from
  // `new RegExp`. The validateDisplayIdPattern oracle now catches it first.
  try {
    compileDisplayIdPattern("SWC_{x}_{x}");
    throw new Error("expected compileDisplayIdPattern to throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes("duplicate")) {
      throw new Error(`expected 'duplicate' in error message, got: ${msg}`);
    }
  }
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

Deno.test("compileDisplayIdPattern: named {scope} segment matches any token", () => {
  const r = compileDisplayIdPattern("XREQ_{scope}_{n:04d}");
  assertEquals(r.test("XREQ_IMMER_0010"), true);
  assertEquals(r.test("XREQ_WELCOME_0001"), true);
  assertEquals(r.test("XREQ__0010"), false); // empty scope
  assertEquals(r.test("XREQ_IMMER_10"), false); // wrong padding
  assertEquals(r.test("XREQ_IMMER_FOO_0010"), false); // extra segment
});

Deno.test("compileDisplayIdPattern: counter-less named pattern matches rest-of-ID", () => {
  // Named (no {n}) pattern with a literal anchor — issue #594. The trailing
  // {name} captures the rest of the display ID, underscores included, so
  // named component IDs classify by prefix.
  const r = compileDisplayIdPattern("SWC_{name}");
  assertEquals(r.test("SWC_DSG"), true);
  assertEquals(r.test("SWC_LIGHT_CTRL"), true); // underscore in the name
  assertEquals(r.test("SWC_io.adc"), true); // dot
  assertEquals(r.test("SWC_drv/pwm"), true); // slash
  assertEquals(r.test("HWC_PIU"), false); // wrong prefix
  assertEquals(r.test("SWC_"), false); // empty name
  assertEquals(r.test("XSWC_DSG"), false); // anchored prefix
});

Deno.test("compileDisplayIdPattern: counter-less {scope} pattern is now valid (named)", () => {
  // `XREQ_{scope}` was rejected before #594 (no counter); it is now a named
  // pattern whose {scope} captures the rest of the ID.
  const r = compileDisplayIdPattern("XREQ_{scope}");
  assertEquals(r.test("XREQ_LIGHT"), true);
  assertEquals(r.test("XREQ_LIGHT_CTRL"), true);
  assertEquals(r.test("XREQ_"), false);
});

Deno.test("compileDisplayIdPattern: bare {name} with no literal anchor throws", () => {
  try {
    compileDisplayIdPattern("{name}");
    throw new Error("expected compileDisplayIdPattern to throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes("literal")) {
      throw new Error(`expected 'literal' in error message, got: ${msg}`);
    }
  }
});

Deno.test("compileDisplayIdPattern: all-literal pattern (no placeholder) still throws", () => {
  // A literal-only template has no variable part — neither counter nor named —
  // and is rejected with the historical missing-{n} message.
  try {
    compileDisplayIdPattern("REQ_FIXED");
    throw new Error("expected compileDisplayIdPattern to throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes("{n}")) {
      throw new Error(`expected '{n}' in error message, got: ${msg}`);
    }
  }
});
