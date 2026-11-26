/**
 * @module core/validator/pattern_test
 *
 * Unit tests for display-ID pattern compilation.
 */

import { assertEquals } from "@std/assert";
import {
  compileDisplayIdPattern,
  displayIdScope,
  displayIdScopeFilter,
  displayIdScopesInUse,
} from "./pattern.ts";
import { isValidScope, substituteScope } from "../profile/display_id.ts";

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

// ---------------------------------------------------------------------------
// {scope} values in use (#1038)
// ---------------------------------------------------------------------------

Deno.test("displayIdScope: the scope of a display ID that matches the pattern", () => {
  assertEquals(displayIdScope("SRS_{scope}_{n:04d}", "SRS_BRK_0001"), "BRK");
  assertEquals(displayIdScope("REQ-{n:03d}-{scope}", "REQ-012-ENG"), "ENG");
});

Deno.test("displayIdScope: undefined for an ID that does not match or a pattern without {scope}", () => {
  assertEquals(
    displayIdScope("SRS_{scope}_{n:04d}", "STK_BRK_0001"),
    undefined,
  );
  assertEquals(displayIdScope("SRS_{scope}_{n:04d}", "SRS_BRK_01"), undefined);
  assertEquals(displayIdScope("STK_{n:04d}", "STK_0001"), undefined);
  assertEquals(displayIdScope("SRS_{scope", "SRS_BRK_0001"), undefined);
});

Deno.test("displayIdScopesInUse: sorted, deduplicated scopes of the matching entries", () => {
  const entries = [
    { displayId: "SRS_ENG_0002" },
    { displayId: "SRS_BRK_0001" },
    { displayId: "SRS_BRK_0003" },
    { displayId: "STK_0001" },
    { displayId: "SRS_B_K_0001" },
  ];
  assertEquals(
    displayIdScopesInUse("SRS_{scope}_{n:04d}", entries),
    ["BRK", "ENG"],
  );
});

Deno.test("displayIdScopesInUse: empty for a pattern without {scope} or a malformed pattern", () => {
  const entries = [{ displayId: "STK_0001" }];
  assertEquals(displayIdScopesInUse("STK_{n:04d}", entries), []);
  assertEquals(displayIdScopesInUse("STK_{n}{n}", entries), []);
});

Deno.test("displayIdScopeFilter: drops an ID the classifier reads under another scope", () => {
  const accept = displayIdScopeFilter("G_{scope}{n:04d}", "BR");
  assertEquals(accept("G_BR10001"), false);
  assertEquals(accept("G_BR0003"), true);
});

Deno.test("displayIdScopeFilter: keeps an ID the classifier does not match", () => {
  const accept = displayIdScopeFilter("SRS_{scope}_{n:04d}", "BRK");
  assertEquals(accept("SRS_BRK_10000"), true);
  assertEquals(accept("SRS_ENG_0001"), false);
  assertEquals(accept("SRS_BRK_0001"), true);
});

Deno.test("displayIdScopeFilter: keeps every ID for a pattern without {scope}", () => {
  const accept = displayIdScopeFilter("STK_{n:04d}", "BRK");
  assertEquals(accept("STK_0001"), true);
});

Deno.test("isValidScope: every valid scope value classifies back through displayIdScope", () => {
  const pattern = "SRS_{scope}_{n:04d}";
  for (const scope of ["BRK", "brk2", "7", "A1b2C3"]) {
    assertEquals(isValidScope(scope), true, scope);
    const id = substituteScope(pattern, scope).replace("{n:04d}", "0001");
    assertEquals(displayIdScope(pattern, id), scope, id);
  }
  assertEquals(isValidScope("B_K"), false);
  assertEquals(displayIdScope(pattern, "SRS_B_K_0001"), undefined);
});

Deno.test("displayIdScope: reads a counter wider than the padding (#1038)", () => {
  assertEquals(displayIdScope("SRS_{scope}_{n:04d}", "SRS_BRK_10000"), "BRK");
  assertEquals(displayIdScope("G_{scope}{n:04d}", "G_BR10001"), "BR1");
  assertEquals(displayIdScope("SRS_{scope}_{n:04d}", "SRS_BRK_001"), undefined);
});

Deno.test("displayIdScopesInUse: lists a scope whose only ID is wider than the padding (#1038)", () => {
  assertEquals(
    displayIdScopesInUse("SRS_{scope}_{n:04d}", [
      { displayId: "SRS_BRK_10000" },
    ]),
    ["BRK"],
  );
});

Deno.test("compileDisplayIdPattern: the classifier still needs the exact padded width (#1038)", () => {
  const re = compileDisplayIdPattern("SRS_{scope}_{n:04d}");
  assertEquals(re.test("SRS_BRK_10000"), false);
  assertEquals(re.test("SRS_BRK_0001"), true);
});
