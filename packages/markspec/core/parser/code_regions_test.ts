/**
 * @module core/parser/code_regions_test
 *
 * Unit tests for {@linkcode nonProseRanges}.
 */

import { assertEquals } from "@std/assert";
import { nonProseRanges } from "./code_regions.ts";

Deno.test("nonProseRanges: ranges of the definitions are not returned (#1017)", () => {
  const text = "See [BrakeRef] here.";
  const ranges = nonProseRanges(
    text,
    undefined,
    "[BrakeRef]: http://a.example/\n\n[^Note]: Use `x`.",
  );
  assertEquals(ranges, [{ start: 4, end: 14 }]);
  for (const r of ranges) assertEquals(r.end <= text.length, true);
});

Deno.test("nonProseRanges: a label is a range only with its definition", () => {
  assertEquals(nonProseRanges("See [BrakeRef] here."), []);
});
