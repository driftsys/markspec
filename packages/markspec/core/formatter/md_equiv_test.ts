import { assertEquals } from "@std/assert";
import {
  markdownEquivalenceTree,
  markdownSemanticallyEquivalent,
} from "./md_equiv.ts";

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

// The info string of a fenced code block is compared as written: a decoded
// escape or character reference is a difference; spaces around it are not
// (#1008).
Deno.test("markdownSemanticallyEquivalent: a decoded fence info string differs (#1008)", () => {
  for (
    const [a, b] of [
      ["```js a&amp;b\nx\n```", "```js a&b\nx\n```"],
      ["```js a\\_b \\{1\\}\nx\n```", "```js a_b {1}\nx\n```"],
    ]
  ) {
    assertEquals(markdownSemanticallyEquivalent(a, b), false, a);
  }
});

Deno.test("markdownSemanticallyEquivalent: spaces around a fence info string do not matter (#1008)", () => {
  assertEquals(
    markdownSemanticallyEquivalent(
      "```js title=x  \nx\n```",
      "```js title=x\nx\n```",
    ),
    true,
  );
  assertEquals(
    markdownSemanticallyEquivalent("~~~ js\nx\n~~~", "```js\nx\n```"),
    true,
  );
});

// The language word is compared as mdast `lang`, and only the verbatim text
// after it is compared as a separate key. Two fences that differ only in
// the language word differ only in `lang`, so a mapping applied to `lang`
// alone (#1011) makes them equal (#1008).
Deno.test("markdownEquivalenceTree: fences with another language differ only in lang (#1008)", () => {
  const feature = "```feature title=x\nx\n```";
  const gherkin = "```gherkin   title=x\nx\n```";
  assertEquals(markdownSemanticallyEquivalent(feature, gherkin), false);
  const a = markdownEquivalenceTree(feature) as {
    children: Record<string, unknown>[];
  };
  const b = markdownEquivalenceTree(gherkin) as {
    children: Record<string, unknown>[];
  };
  assertEquals(a.children[0].lang, "feature");
  assertEquals(b.children[0].lang, "gherkin");
  assertEquals({ ...a.children[0], lang: "gherkin" }, b.children[0]);
  assertEquals({ ...a, children: [{ ...a.children[0], lang: "gherkin" }] }, b);
});

Deno.test("markdownSemanticallyEquivalent: an indented code block is not read as a fence (#1008)", () => {
  assertEquals(
    markdownSemanticallyEquivalent(
      "Text.\n\n    ```js x\n    y",
      "Text.\n\n```\n```js x\ny\n```",
    ),
    true,
  );
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
