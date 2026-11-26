/**
 * @module core/profile/display_id_test
 */

import { assertEquals } from "@std/assert";
import {
  firstFreeDisplayIdNumber,
  formatDisplayId,
  hasScopePlaceholder,
  highestDisplayIdNumber,
  inferDisplayIdScope,
  isValidScope,
  padDisplayIdNumber,
  parseDisplayIdPattern,
  parseScopeSlot,
  scopeTemplateText,
  substituteScope,
  validateDisplayIdPattern,
} from "./display_id.ts";

Deno.test("parseDisplayIdPattern: simple 4-digit prefix", () => {
  const shape = parseDisplayIdPattern("STK_{n:4d}");
  assertEquals(shape, { prefix: "STK_", width: 4, suffix: "" });
});

Deno.test("parseDisplayIdPattern: leading-zero form is equivalent", () => {
  const shape = parseDisplayIdPattern("STK_{n:04d}");
  assertEquals(shape, { prefix: "STK_", width: 4, suffix: "" });
});

Deno.test("parseDisplayIdPattern: 6-digit width", () => {
  const shape = parseDisplayIdPattern("STK_AEB_{n:6d}");
  assertEquals(shape, { prefix: "STK_AEB_", width: 6, suffix: "" });
});

Deno.test("parseDisplayIdPattern: suffix after placeholder", () => {
  const shape = parseDisplayIdPattern("REQ-{n:03d}-draft");
  assertEquals(shape, { prefix: "REQ-", width: 3, suffix: "-draft" });
});

Deno.test("parseDisplayIdPattern: empty prefix", () => {
  const shape = parseDisplayIdPattern("{n:4d}_TAIL");
  assertEquals(shape, { prefix: "", width: 4, suffix: "_TAIL" });
});

Deno.test("parseDisplayIdPattern: malformed returns undefined", () => {
  assertEquals(parseDisplayIdPattern("STK_NOPATTERN"), undefined);
  assertEquals(parseDisplayIdPattern("STK_{NNNN}"), undefined);
  assertEquals(parseDisplayIdPattern("STK_{n:0d}"), undefined); // zero width
  assertEquals(parseDisplayIdPattern(""), undefined);
});

Deno.test("parseDisplayIdPattern: scope placeholder stays literal", () => {
  // Schema documents {scope} but it is callers' job to substitute.
  // The parser sees it as part of the prefix.
  const shape = parseDisplayIdPattern("SRS_{scope}_{n:04d}");
  assertEquals(shape, {
    prefix: "SRS_{scope}_",
    width: 4,
    suffix: "",
  });
});

Deno.test("parseDisplayIdPattern: bare {n} is mintable with width 1 (#596)", () => {
  // The mirror of the {n:4d} bug: a bare {n} compiles for classification
  // (\d+) but previously returned undefined here, so it was silently
  // non-mintable. Now it mints with no zero-padding (width 1).
  const shape = parseDisplayIdPattern("REQ-{n}");
  assertEquals(shape, { prefix: "REQ-", width: 1, suffix: "" });
  assertEquals(formatDisplayId(shape!, 7), "REQ-7");
  assertEquals(formatDisplayId(shape!, 42), "REQ-42");
});

Deno.test("parseDisplayIdPattern: named (counter-less) pattern is non-mintable (#598)", () => {
  // A named pattern classifies (compileDisplayIdPattern) but has no
  // counter to increment, so the mint path must report it as undefined.
  assertEquals(parseDisplayIdPattern("SWC_{name}"), undefined);
  assertEquals(parseDisplayIdPattern("XREQ_{scope}"), undefined);
});

Deno.test("validateDisplayIdPattern: accepts numbered and named forms (#596)", () => {
  for (
    const ok of [
      "STK_{n:4d}", // non-leading-zero padding — the #596 case
      "STK_{n:04d}",
      "REQ-{n}", // bare counter
      "XREQ_{scope}_{n:04d}", // medial named + counter
      "SWC_{name}", // counter-less named
      "XREQ_{scope}", // counter-less named
    ]
  ) {
    assertEquals(validateDisplayIdPattern(ok).ok, true, ok);
  }
});

Deno.test("validateDisplayIdPattern: rejects malformed forms with a reason (#596/#597)", () => {
  const cases: Array<[string, string]> = [
    ["{name}", "literal"], // bare named, no anchor
    ["REQ_FIXED", "{n}"], // no variable part
    ["REQ-{n:abc}", "invalid"], // malformed padding
    ["STK_{n:0d}", "invalid"], // zero width
    ["X_{n}_{n:04d}", "multiple"], // two counters
    ["SWC_{x}_{x}", "duplicate"], // duplicate named placeholder
  ];
  for (const [pattern, needle] of cases) {
    const result = validateDisplayIdPattern(pattern);
    assertEquals(result.ok, false, pattern);
    if (!result.ok) {
      assertEquals(
        result.message.toLowerCase().includes(needle),
        true,
        `expected '${needle}' in message for '${pattern}', got: ${result.message}`,
      );
    }
  }
});

Deno.test("padDisplayIdNumber: pads to minimum width", () => {
  assertEquals(padDisplayIdNumber(1, 4), "0001");
  assertEquals(padDisplayIdNumber(123, 4), "0123");
  assertEquals(padDisplayIdNumber(1234, 4), "1234");
  // Wider than the pattern: respects printf %0Nd "minimum width" semantics.
  assertEquals(padDisplayIdNumber(12345, 4), "12345");
});

Deno.test("formatDisplayId: composes prefix + padded number + suffix", () => {
  const shape = { prefix: "STK_", width: 4, suffix: "" };
  assertEquals(formatDisplayId(shape, 7), "STK_0007");
  const wide = { prefix: "STK_AEB_", width: 6, suffix: "" };
  assertEquals(formatDisplayId(wide, 7), "STK_AEB_000007");
  const withSuffix = { prefix: "REQ-", width: 3, suffix: "-draft" };
  assertEquals(formatDisplayId(withSuffix, 12), "REQ-012-draft");
});

Deno.test("firstFreeDisplayIdNumber: returns the start number when its ID is free", () => {
  const shape = { prefix: "G_BR", width: 2, suffix: "" };
  assertEquals(firstFreeDisplayIdNumber(shape, 7, () => false), 7);
});

Deno.test("firstFreeDisplayIdNumber: skips numbers whose formatted ID is taken (#1041)", () => {
  const shape = { prefix: "G_BR", width: 2, suffix: "" };
  const taken = new Set(["G_BR100", "G_BR101"]);
  const seen: string[] = [];
  const n = firstFreeDisplayIdNumber(shape, 100, (id) => {
    seen.push(id);
    return taken.has(id);
  });
  assertEquals(n, 102);
  assertEquals(seen, ["G_BR100", "G_BR101", "G_BR102"]);
});

Deno.test("firstFreeDisplayIdNumber: passes the number to the predicate and pads it", () => {
  const shape = { prefix: "REQ-", width: 3, suffix: "-draft" };
  const calls: Array<[string, number]> = [];
  const n = firstFreeDisplayIdNumber(shape, 4, (id, num) => {
    calls.push([id, num]);
    return num === 4;
  });
  assertEquals(n, 5);
  assertEquals(calls, [["REQ-004-draft", 4], ["REQ-005-draft", 5]]);
});

Deno.test("firstFreeDisplayIdNumber: stops at the largest safe integer instead of looping (#1041)", () => {
  const shape = { prefix: "R_", width: 0, suffix: "" };
  // Above 2^53 - 1, n + 1 can equal n: an always-taken predicate must not
  // loop forever. The bound itself is returned, as is a start above it.
  const near = Number.MAX_SAFE_INTEGER - 2;
  assertEquals(
    firstFreeDisplayIdNumber(shape, near, () => true),
    Number.MAX_SAFE_INTEGER,
  );
  assertEquals(
    firstFreeDisplayIdNumber(shape, 2 ** 53 + 1, () => true),
    2 ** 53,
  );
});

Deno.test("highestDisplayIdNumber: finds max within prefix+suffix match", () => {
  const shape = { prefix: "STK_AEB_", width: 4, suffix: "" };
  const entries = [
    { displayId: "STK_AEB_0001" },
    { displayId: "STK_AEB_0042" },
    { displayId: "STK_AEB_0007" },
    { displayId: "SYS_NOMATCH_0099" }, // different prefix
    { displayId: "STK_AEB_0099_extra" }, // wrong suffix shape — but our suffix is empty, so it matches
  ];
  // "STK_AEB_0099_extra" → starts with STK_AEB_, suffix "" matches anything,
  // numberPart = "0099_extra" → parseInt → 99. So 99 is the max.
  // (The trailing junk doesn't fail parseInt; this matches CLI behavior.)
  assertEquals(highestDisplayIdNumber(shape, entries), 99);
});

Deno.test("highestDisplayIdNumber: requires suffix match when shape has one", () => {
  const shape = { prefix: "REQ-", width: 3, suffix: "-draft" };
  const entries = [
    { displayId: "REQ-001-draft" },
    { displayId: "REQ-042-draft" },
    { displayId: "REQ-099" }, // missing suffix
  ];
  assertEquals(highestDisplayIdNumber(shape, entries), 42);
});

Deno.test("highestDisplayIdNumber: returns 0 when no matching IDs", () => {
  const shape = { prefix: "STK_", width: 4, suffix: "" };
  const entries = [{ displayId: "SYS_0001" }];
  assertEquals(highestDisplayIdNumber(shape, entries), 0);
});

// ---------------------------------------------------------------------------
// {scope} placeholder (#1038)
// ---------------------------------------------------------------------------

Deno.test("hasScopePlaceholder: a numbered pattern with {scope} has one", () => {
  assertEquals(hasScopePlaceholder("SRS_{scope}_{n:04d}"), true);
  assertEquals(hasScopePlaceholder("REQ-{n:03d}-{scope}"), true);
});

Deno.test("hasScopePlaceholder: a pattern without {scope} has none", () => {
  assertEquals(hasScopePlaceholder("STK_{n:04d}"), false);
  assertEquals(hasScopePlaceholder("SRS_{area}_{n:04d}"), false);
});

Deno.test("hasScopePlaceholder: a named (counter-less) pattern has none", () => {
  assertEquals(hasScopePlaceholder("SWC_{scope}"), false);
});

Deno.test("isValidScope: accepts one or more letters or digits", () => {
  assertEquals(isValidScope("BRK"), true);
  assertEquals(isValidScope("brk2"), true);
  assertEquals(isValidScope("7"), true);
});

Deno.test("isValidScope: rejects an empty value and non-alphanumeric characters", () => {
  assertEquals(isValidScope(""), false);
  assertEquals(isValidScope("B_K"), false);
  assertEquals(isValidScope("B-K"), false);
  assertEquals(isValidScope("BRK "), false);
  assertEquals(isValidScope("{scope}"), false);
});

Deno.test("substituteScope: the value replaces {scope}, so the pattern parses with a scoped prefix", () => {
  const pattern = substituteScope("SRS_{scope}_{n:04d}", "BRK");
  assertEquals(pattern, "SRS_BRK_{n:04d}");
  assertEquals(parseDisplayIdPattern(pattern), {
    prefix: "SRS_BRK_",
    width: 4,
    suffix: "",
  });
});

Deno.test("substituteScope: a {scope} after the counter lands in the suffix", () => {
  assertEquals(
    parseDisplayIdPattern(substituteScope("REQ-{n:03d}-{scope}", "ENG")),
    { prefix: "REQ-", width: 3, suffix: "-ENG" },
  );
});

Deno.test("substituteScope: other named placeholders keep their {name} form", () => {
  assertEquals(
    substituteScope("SRS_{scope}_{area}_{n:04d}", "BRK"),
    "SRS_BRK_{area}_{n:04d}",
  );
});

Deno.test("substituteScope: a pattern without {scope} is returned unchanged", () => {
  assertEquals(substituteScope("STK_{n:04d}", "BRK"), "STK_{n:04d}");
});

Deno.test("highestDisplayIdNumber: a substituted scope counts only its own IDs", () => {
  const shape = parseDisplayIdPattern(
    substituteScope("SRS_{scope}_{n:04d}", "BRK"),
  )!;
  const entries = [
    { displayId: "SRS_BRK_0001" },
    { displayId: "SRS_ENG_0007" },
  ];
  assertEquals(highestDisplayIdNumber(shape, entries), 1);
});

Deno.test("parseScopeSlot: literal text before {scope} and between {scope} and the counter", () => {
  assertEquals(parseScopeSlot("SRS_{scope}_{n:04d}"), {
    beforeScope: "SRS_",
    afterScope: "_",
  });
  assertEquals(parseScopeSlot("X-{scope}.{n}-draft"), {
    beforeScope: "X-",
    afterScope: ".",
  });
});

Deno.test("parseScopeSlot: undefined without {scope}, or with {scope} after the counter", () => {
  assertEquals(parseScopeSlot("STK_{n:04d}"), undefined);
  assertEquals(parseScopeSlot("REQ-{n:03d}-{scope}"), undefined);
  assertEquals(parseScopeSlot("SWC_{scope}"), undefined);
});

Deno.test("inferDisplayIdScope: a text that holds the full scope slot gives its scope", () => {
  const pattern = "SRS_{scope}_{n:04d}";
  assertEquals(inferDisplayIdScope(pattern, "SRS_BRK_"), "BRK");
  assertEquals(inferDisplayIdScope(pattern, "SRS_BRK_00"), "BRK");
  assertEquals(inferDisplayIdScope(pattern, "SRS_BRK_0001"), "BRK");
});

Deno.test("inferDisplayIdScope: a text shorter than the full scope slot gives no scope", () => {
  const pattern = "SRS_{scope}_{n:04d}";
  assertEquals(inferDisplayIdScope(pattern, "SRS_"), undefined);
  assertEquals(inferDisplayIdScope(pattern, "SRS_B"), undefined);
  assertEquals(inferDisplayIdScope(pattern, "SRS_BRK"), undefined);
  assertEquals(inferDisplayIdScope(pattern, "STK_BRK_"), undefined);
});

Deno.test("inferDisplayIdScope: no scope for a pattern without a scope slot", () => {
  assertEquals(inferDisplayIdScope("STK_{n:04d}", "STK_BRK_"), undefined);
});

Deno.test("inferDisplayIdScope: no scope when nothing separates {scope} from the counter", () => {
  assertEquals(
    inferDisplayIdScope("SRS{scope}{n:04d}", "SRSBRK0001"),
    undefined,
  );
});

Deno.test("scopeTemplateText: {scope} before the counter", () => {
  assertEquals(scopeTemplateText("SRS_{scope}_{n:04d}"), {
    anchor: "SRS_",
    beforeScope: "SRS_",
    afterScope: "_NNNN",
  });
});

Deno.test("scopeTemplateText: {scope} after the counter", () => {
  assertEquals(scopeTemplateText("R-{n:03d}-{scope}"), {
    anchor: "R-",
    beforeScope: "R-NNN-",
    afterScope: "",
  });
  assertEquals(scopeTemplateText("R{n}.{scope}.x"), {
    anchor: "R",
    beforeScope: "RN.",
    afterScope: ".x",
  });
});

Deno.test("scopeTemplateText: undefined without {scope} or for a named pattern", () => {
  assertEquals(scopeTemplateText("STK_{n:04d}"), undefined);
  assertEquals(scopeTemplateText("SWC_{scope}"), undefined);
});

Deno.test("inferDisplayIdScope: no scope when the text after the scope slot is not digits (#1038)", () => {
  const pattern = "SRS_{scope}_{n:04d}";
  assertEquals(inferDisplayIdScope(pattern, "SRS_BR_K_"), undefined);
  assertEquals(inferDisplayIdScope(pattern, "SRS_BRK_0X"), undefined);
  assertEquals(inferDisplayIdScope(pattern, "SRS_BRK_10000"), "BRK");
});
