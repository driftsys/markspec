import { assertEquals } from "@std/assert";
import { markdownSemanticallyEquivalent } from "./md_equiv.ts";

Deno.test("md_equiv: re-wrapped prose is equivalent", () => {
  assertEquals(
    markdownSemanticallyEquivalent(
      "aaa bbb ccc\nddd",
      "aaa\nbbb ccc ddd",
    ),
    true,
  );
});

Deno.test("md_equiv: dropped word is NOT equivalent", () => {
  assertEquals(
    markdownSemanticallyEquivalent("aaa bbb ccc", "aaa ccc"),
    false,
  );
});

Deno.test("md_equiv: emphasis delimiter style is equivalent", () => {
  assertEquals(
    markdownSemanticallyEquivalent("*em* __st__", "_em_ **st**"),
    true,
  );
});

Deno.test("md_equiv: hard break vs soft wrap is NOT equivalent", () => {
  // Two trailing spaces = hard break (mdast `break` node); plain
  // newline = soft wrap (text). Must not compare equal.
  assertEquals(
    markdownSemanticallyEquivalent("aaa  \nbbb", "aaa\nbbb"),
    false,
  );
});

Deno.test("md_equiv: table realignment is equivalent", () => {
  assertEquals(
    markdownSemanticallyEquivalent(
      "| a | b |\n|--|--|\n| 1 | 2 |",
      "| a   | b   |\n| --- | --- |\n| 1   | 2   |",
    ),
    true,
  );
});

Deno.test("md_equiv: fenced code content is verbatim — whitespace change NOT equivalent", () => {
  assertEquals(
    markdownSemanticallyEquivalent(
      "```\nfoo  bar\n```",
      "```\nfoo bar\n```",
    ),
    false,
  );
});

Deno.test("md_equiv: list marker style is equivalent", () => {
  assertEquals(
    markdownSemanticallyEquivalent("* one\n* two", "- one\n- two"),
    true,
  );
});

Deno.test("md_equiv: NBSP vs plain space is NOT equivalent", () => {
  // remark decodes `&nbsp;` to a literal U+00A0 inside text values.
  // NBSP is content (e.g. `10\u00a0Nm` unit binding), not a wrap
  // artifact — it must not collapse into a plain space.
  assertEquals(
    markdownSemanticallyEquivalent(
      "torque of 10\u00a0Nm applies",
      "torque of 10 Nm applies",
    ),
    false,
  );
});

Deno.test("md_equiv: inline code content is verbatim — whitespace change NOT equivalent", () => {
  assertEquals(
    markdownSemanticallyEquivalent("a `x  y` b", "a `x y` b"),
    false,
  );
});
