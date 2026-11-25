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

// Options used by the formatter's text-loss guard (#989).
const GUARD = { ignoreTextCase: true, ignoreListStart: true } as const;

Deno.test("md_equiv: default relation keeps text case and list start", () => {
  assertEquals(markdownSemanticallyEquivalent("SHALL", "shall"), false);
  assertEquals(markdownSemanticallyEquivalent("3. a", "1. a"), false);
});

Deno.test("md_equiv: guard options ignore text case and list start", () => {
  assertEquals(markdownSemanticallyEquivalent("SHALL", "shall", GUARD), true);
  assertEquals(
    markdownSemanticallyEquivalent("3. a\n4. b", "1. a\n2. b", GUARD),
    true,
  );
});

Deno.test("md_equiv: guard options still reject lost content", () => {
  for (
    const [original, emitted] of [
      ["Term\n&#58; first line\nsecond line.", "Term\n: first line"],
      ["Table: first line\nsecond line.", "Table: first line"],
      ["Table: see [x](http://a.example/p)", "Table: see x"],
      ["*a* b", "a b"],
      ["[x](http://a.example/p)", "[x](http://a.example/q)"],
      ['![alt](p.png "Title")', "![alt](p.png)"],
      ["![ALT](p.png)", "![alt](p.png)"],
      ["`SHALL`", "`shall`"],
      ["a b b", "a b"],
    ]
  ) {
    assertEquals(
      markdownSemanticallyEquivalent(original, emitted, GUARD),
      false,
      `${JSON.stringify(original)} vs ${JSON.stringify(emitted)}`,
    );
  }
});

Deno.test("md_equiv: feature and gherkin fences are equal only with featureLangAlias (#1011)", () => {
  const feature = "```feature\nFeature: F\n```";
  const gherkin = "```gherkin\nFeature: F\n```";
  assertEquals(markdownSemanticallyEquivalent(feature, gherkin), false);
  assertEquals(markdownSemanticallyEquivalent(feature, gherkin, GUARD), false);
  assertEquals(
    markdownSemanticallyEquivalent(feature, gherkin, {
      ...GUARD,
      featureLangAlias: true,
    }),
    true,
  );
});

Deno.test("md_equiv: featureLangAlias still rejects any other lang change (#1011)", () => {
  const options = { ...GUARD, featureLangAlias: true } as const;
  for (
    const [a, b] of [
      ["```gherkin\nx\n```", "```js\nx\n```"],
      ["```feature\nx\n```", "```js\nx\n```"],
      ["```feature\nx\n```", "```\nx\n```"],
      ["```gherkin\nx\n```", "```Gherkin\nx\n```"],
      ["```feature\nx\n```", "```gherkin\ny\n```"],
      ["```feature a\nx\n```", "```gherkin\nx\n```"],
    ]
  ) {
    assertEquals(
      markdownSemanticallyEquivalent(a, b, options),
      false,
      `${JSON.stringify(a)} vs ${JSON.stringify(b)}`,
    );
  }
});
