import { assertEquals } from "@std/assert";
import {
  normalizeLocator,
  parseTraceValue,
  splitTraceValues,
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

Deno.test("splitTraceValues: unterminated locator keeps the rest together", () => {
  assertEquals(splitTraceValues("A [x, y"), ["A [x, y"]);
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

Deno.test("parseTraceValue: legacy whitespace locator keeps the first token", () => {
  assertEquals(parseTraceValue("ISO-26262-6 §4.3"), {
    target: "ISO-26262-6",
  });
});

Deno.test("normalizeLocator: NFC, trim and whitespace collapse", () => {
  assertEquals(normalizeLocator("  a \t b\n c "), "a b c");
  assertEquals(normalizeLocator("é"), "é");
});

Deno.test("parseTraceValue: text after a closed locator keeps the first token", () => {
  assertEquals(parseTraceValue("REQ_1 [a] extra").target, "REQ_1");
  assertEquals(parseTraceValue("REQ_1 [a][b]").target, "REQ_1");
  assertEquals(parseTraceValue("REQ_1 [x [y] z]").target, "REQ_1");
  assertEquals(parseTraceValue("REQ_1 [a] extra").locator, undefined);
});

Deno.test("parseTraceValue: unterminated locator keeps the whole value", () => {
  assertEquals(parseTraceValue("REQ_1 [x"), { target: "REQ_1 [x" });
});

Deno.test("trailing backslash in a locator never closes it", () => {
  assertEquals(splitTraceValues("A [x\\"), ["A [x\\"]);
  assertEquals(splitTraceValues("A [x\\, B"), ["A [x\\, B"]);
  assertEquals(parseTraceValue("REQ_1 [x\\]"), { target: "REQ_1 [x\\]" });
});

Deno.test("no whitespace before [ : split keeps it, parse sees no locator", () => {
  assertEquals(splitTraceValues("A[x, y], B"), ["A[x, y]", "B"]);
  assertEquals(parseTraceValue("A[x, y]"), { target: "A[x," });
});

Deno.test("parseTraceValue: unknown escape is kept as written", () => {
  assertEquals(parseTraceValue("R [a\\xb]").locator, "a\\xb");
});

Deno.test("normalizeLocator: explicit NFC escapes", () => {
  assertEquals(normalizeLocator("é"), "é");
  assertEquals(normalizeLocator("é"), "é");
});
