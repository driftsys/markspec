import { assertEquals } from "@std/assert";
import {
  isUnterminatedLocator,
  normalizeLocator,
  parseTraceValue,
  splitTraceValues,
  traceTarget,
} from "./split.ts";

Deno.test("splitTraceValues: comma inside a locator does not split", () => {
  assertEquals(splitTraceValues("A [x, y], B"), ["A [x, y]", "B"]);
});

Deno.test("splitTraceValues: escaped bracket stays in the locator", () => {
  assertEquals(splitTraceValues("A [a\\]b], C"), ["A [a\\]b]", "C"]);
});

Deno.test("splitTraceValues: plain CSV, single value, empty parts", () => {
  assertEquals(splitTraceValues("A, B ,C"), ["A", "B", "C"]);
  assertEquals(splitTraceValues("A"), ["A"]);
  assertEquals(splitTraceValues(" , A,, "), ["A"]);
  assertEquals(splitTraceValues(""), []);
});

Deno.test("splitTraceValues: without a closed locator, every comma splits", () => {
  assertEquals(splitTraceValues("A [x, y"), ["A [x", "y"]);
});

Deno.test("splitTraceValues: a closed locator elsewhere enables bracket splitting", () => {
  assertEquals(splitTraceValues("A [x, y], B [z"), ["A [x, y]", "B [z"]);
});

Deno.test("parseTraceValue: locator is normalized, raw text is kept", () => {
  assertEquals(parseTraceValue("REQ_1 [Brake  at 20 m]"), {
    target: "REQ_1",
    locator: "Brake at 20 m",
    locatorRaw: "Brake  at 20 m",
  });
});

Deno.test("parseTraceValue: escapes are removed from the locator", () => {
  assertEquals(parseTraceValue("REQ_1 [a\\\\b\\]]").locator, "a\\b]");
});

Deno.test("parseTraceValue: no locator", () => {
  assertEquals(parseTraceValue("REQ_1"), { target: "REQ_1" });
});

Deno.test("parseTraceValue: unterminated locator is the whole target", () => {
  assertEquals(parseTraceValue("REQ_1 [abc"), { target: "REQ_1 [abc" });
});

Deno.test("parseTraceValue: a value without a locator is kept whole", () => {
  assertEquals(parseTraceValue("ISO-26262-6 §4.3"), {
    target: "ISO-26262-6 §4.3",
  });
  assertEquals(parseTraceValue("SYS_1 note"), { target: "SYS_1 note" });
});

Deno.test("parseTraceValue: an empty locator is a locator", () => {
  assertEquals(parseTraceValue("REQ_1 []"), {
    target: "REQ_1",
    locator: "",
    locatorRaw: "",
  });
  assertEquals(parseTraceValue("REQ_1 [ ]").locator, "");
});

Deno.test("normalizeLocator: NFC, trim and whitespace collapse", () => {
  assertEquals(normalizeLocator("  a \t b\n c "), "a b c");
  assertEquals(normalizeLocator("é"), "é");
});

Deno.test("parseTraceValue: text after a closed locator is no locator", () => {
  assertEquals(parseTraceValue("REQ_1 [a] extra"), {
    target: "REQ_1 [a] extra",
  });
  assertEquals(parseTraceValue("REQ_1 [a][b]").locator, undefined);
  assertEquals(parseTraceValue("REQ_1 [x [y] z]").locator, undefined);
});

Deno.test("parseTraceValue: unterminated locator keeps the whole value", () => {
  assertEquals(parseTraceValue("REQ_1 [x"), { target: "REQ_1 [x" });
});

Deno.test("trailing backslash in a locator never closes it", () => {
  assertEquals(splitTraceValues("A [x\\"), ["A [x\\"]);
  assertEquals(splitTraceValues("A [x\\, B"), ["A [x\\", "B"]);
  assertEquals(parseTraceValue("REQ_1 [x\\]"), { target: "REQ_1 [x\\]" });
});

Deno.test("no whitespace before [ : no locator, every comma splits", () => {
  assertEquals(splitTraceValues("A[x, y], B"), ["A[x", "y]", "B"]);
  assertEquals(splitTraceValues("A[x], B [y, z]"), ["A[x]", "B [y, z]"]);
  assertEquals(parseTraceValue("A[x]"), { target: "A[x]" });
});

Deno.test("parseTraceValue: unknown escape is kept as written", () => {
  assertEquals(parseTraceValue("R [a\\xb]").locator, "a\\xb");
});

Deno.test("normalizeLocator: explicit NFC escapes", () => {
  assertEquals(normalizeLocator("é"), "é");
  assertEquals(normalizeLocator("é"), "é");
});

Deno.test("traceTarget: drops a closed locator only", () => {
  assertEquals(traceTarget("REQ_1 [Brake at 20 m]"), "REQ_1");
  assertEquals(traceTarget("  REQ_1  "), "REQ_1");
  assertEquals(traceTarget("REQ_1 trailing text"), "REQ_1 trailing text");
  assertEquals(traceTarget("REQ_1 [open"), "REQ_1 [open");
});

Deno.test("isUnterminatedLocator: open bracket after whitespace", () => {
  assertEquals(isUnterminatedLocator("A [x"), true);
  assertEquals(isUnterminatedLocator("A [x]"), false);
  assertEquals(isUnterminatedLocator("A[x"), false);
  assertEquals(isUnterminatedLocator("A [x\\]"), true);
});
