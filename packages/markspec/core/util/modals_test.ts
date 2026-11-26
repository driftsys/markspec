import { assertEquals } from "@std/assert";
import { normalizeProseModals } from "./modals.ts";

// #1009: the casing pass changes prose only. Link destinations, titles and
// labels, autolinks, images, link reference definitions and raw HTML keep
// their text. The visible text of a link is prose and is lowercased.
// Each input puts a prose keyword right after the kept syntax, so a
// protected range that reaches past its node fails the test.
for (
  const [name, input, expected] of [
    [
      "an inline link URL",
      "The system SHALL follow [SHALL](http://x.example/SHALL) MUST.",
      "The system shall follow [shall](http://x.example/SHALL) must.",
    ],
    [
      "a link title",
      '[x](http://a.example/p "SHALL") MUST.',
      '[x](http://a.example/p "SHALL") must.',
    ],
    [
      "an angle-bracket autolink",
      "See <http://x.example/MUST> MAY.",
      "See <http://x.example/MUST> may.",
    ],
    [
      "a GFM literal autolink",
      "See http://y.example/MAY MUST.",
      "See http://y.example/MAY must.",
    ],
    [
      "an inline image",
      "See ![SHALL](p/SHALL.png) MUST.",
      "See ![SHALL](p/SHALL.png) must.",
    ],
    [
      "a full reference link label",
      "Use [MAY][SHALL] MUST.\n\n[SHALL]: http://z.example/SHALL",
      "Use [may][SHALL] must.\n\n[SHALL]: http://z.example/SHALL",
    ],
    [
      "a shortcut reference link",
      "See [SHALL] MUST.\n\n[SHALL]: http://z.example/",
      "See [SHALL] must.\n\n[SHALL]: http://z.example/",
    ],
    [
      "a collapsed reference link",
      "See [SHALL][] MUST.\n\n[SHALL]: http://z.example/",
      "See [SHALL][] must.\n\n[SHALL]: http://z.example/",
    ],
    [
      "a reference image",
      "See ![SHALL][img] MUST.\n\n[img]: p.png",
      "See ![SHALL][img] must.\n\n[img]: p.png",
    ],
    [
      "a footnote label",
      "A note[^SHALL] MAY.\n\n[^SHALL]: It MUST hold.",
      "A note[^SHALL] may.\n\n[^SHALL]: It must hold.",
    ],
    [
      "inline raw HTML",
      'A <a href="x/SHALL">MUST</a> link.',
      'A <a href="x/SHALL">must</a> link.',
    ],
    [
      "an HTML block",
      "<div>\nSHALL\n</div>\n\nIt MUST act.",
      "<div>\nSHALL\n</div>\n\nIt must act.",
    ],
    // A protected range that spans lines still covers its later lines, and
    // prose after it on the same line is lowercased.
    [
      "a link title over two lines",
      '[x](http://a.example/p "the\nSHALL title") MUST.',
      '[x](http://a.example/p "the\nSHALL title") must.',
    ],
    [
      "an image alt over two lines",
      "See ![the\nSHALL alt](p.png) MUST.",
      "See ![the\nSHALL alt](p.png) must.",
    ],
    [
      "an HTML tag over two lines",
      'A <span\ntitle="SHALL">x</span> MUST.',
      'A <span\ntitle="SHALL">x</span> must.',
    ],
  ]
) {
  Deno.test(`normalizeProseModals: keeps ${name} (#1009)`, () => {
    assertEquals(normalizeProseModals(input), expected);
  });
}

Deno.test("normalizeProseModals: lowercases prose around links (#1009)", () => {
  assertEquals(
    normalizeProseModals(
      "It SHALL act [here](http://a.example/MUST) and MUST NOT stop.",
    ),
    "It shall act [here](http://a.example/MUST) and must not stop.",
  );
});

Deno.test("normalizeProseModals: lowercases a keyword in emphasized link text (#1009)", () => {
  assertEquals(
    normalizeProseModals("[the *SHALL* rule](http://a.example/SHALL)"),
    "[the *shall* rule](http://a.example/SHALL)",
  );
});

// Inline code on a later line must not hide the link ranges of an earlier
// line: the merged ranges are sorted by start offset (#1009).
Deno.test("normalizeProseModals: keeps a link URL before inline code on a later line (#1009)", () => {
  assertEquals(
    normalizeProseModals("A [x](u/SHALL) b\nc `MAY` d MUST."),
    "A [x](u/SHALL) b\nc `MAY` d must.",
  );
});

Deno.test("normalizeProseModals: definitions keep a reference label and are not returned (#1014)", () => {
  const defs = "[SHALL]: http://x.example/\n\n[^MUST]: A note.";
  assertEquals(
    normalizeProseModals(
      "See [SHALL] and [the rule MUST][SHALL][^MUST].",
      "lower",
      defs,
    ),
    "See [SHALL] and [the rule must][SHALL][^MUST].",
  );
  assertEquals(
    normalizeProseModals("See [SHALL].", "lower", ""),
    "See [shall].",
  );
});

for (
  const [name, input, expected] of [
    ["must-have", "a must-have feature", "a must-have feature"],
    ["must-read", "the must-read list", "the must-read list"],
    ["shall-like", "a shall-like clause", "a shall-like clause"],
    ["well-must", "a well-must case", "a well-must case"],
    ["mustard", "add mustard here", "add mustard here"],
    ["shallow", "a shallow pool", "a shallow pool"],
    [
      "must not before a hyphenated word",
      "it must not-so-fast",
      "it MUST not-so-fast",
    ],
    ["must not", "it must not fail", "it MUST NOT fail"],
  ] as const
) {
  Deno.test(`normalizeProseModals: rfc8174 handles ${name}`, () => {
    assertEquals(normalizeProseModals(input, "rfc8174"), expected);
  });
}

Deno.test("normalizeProseModals: rfc8174 uppercases a `not` on the next line of the same paragraph", () => {
  assertEquals(
    normalizeProseModals("it must\nnot fail", "rfc8174"),
    "it MUST\nNOT fail",
  );
  assertEquals(
    normalizeProseModals("it SHALL  \n  Not fail", "rfc8174"),
    "it SHALL  \n  NOT fail",
  );
});

// The tests below pass a single paragraph. normalize.ts passes the text of a
// blockquote or a note to the helper as one text with several blocks; the
// tests further down cover that.
// Regression: a "keyword ends the previous line" marker of -1 matched line
// 0, so a `not` with no keyword before it at the start of a block was
// uppercased.
Deno.test("normalizeProseModals: rfc8174 leaves a `not` with no keyword before it at the start of a block", () => {
  assertEquals(
    normalizeProseModals("Not all inputs are valid.", "rfc8174"),
    "Not all inputs are valid.",
  );
});

Deno.test("normalizeProseModals: rfc8174 leaves a `not` that starts the next block, passed separately", () => {
  assertEquals(normalizeProseModals("it must", "rfc8174"), "it MUST");
  assertEquals(normalizeProseModals("not fail", "rfc8174"), "not fail");
});

// A blockquote or a note reaches the helper as one text, with the quote
// markers removed. A heading followed by a paragraph is the only shape where
// the same-block check decides the result: the line-break pattern allows only
// spaces and tabs between the lines, so another block reaches the check only
// through a heading line.
for (const newline of ["\n", "\r\n"]) {
  const label = newline === "\n" ? "LF" : "CRLF";
  Deno.test(`normalizeProseModals: rfc8174 does not join a keyword at the end of a heading and a \`not\` in the next paragraph (${label})`, () => {
    assertEquals(
      normalizeProseModals(`# It must${newline}not fail.`, "rfc8174"),
      `# It MUST${newline}not fail.`,
    );
  });

  // A setext heading is one block that spans both lines, so the `not` is
  // joined.
  Deno.test(`normalizeProseModals: rfc8174 joins a keyword and a \`not\` on two lines of a setext heading (${label})`, () => {
    assertEquals(
      normalizeProseModals(`It must${newline}not fail${newline}===`, "rfc8174"),
      `It MUST${newline}NOT fail${newline}===`,
    );
  });
}

// These shapes never reach the same-block check: the line-break pattern
// does not match them. They pin that block splitting, not the check.
Deno.test("normalizeProseModals: rfc8174 does not match a keyword and a `not` that a list marker or a blank line separates", () => {
  for (
    const [input, expected] of [
      ["- it must\n- not every item.", "- it MUST\n- not every item."],
      [
        "The system must\n- not every item.",
        "The system MUST\n- not every item.",
      ],
      ["- it must\n\n  not here", "- it MUST\n\n  not here"],
      ["> it must\n\nnot here", "> it MUST\n\nnot here"],
    ] as const
  ) {
    assertEquals(normalizeProseModals(input, "rfc8174"), expected);
  }
  // A `not` on the next line of the same paragraph of a list item is joined.
  assertEquals(
    normalizeProseModals("- it must\n  not fail", "rfc8174"),
    "- it MUST\n  NOT fail",
  );
});

Deno.test("normalizeProseModals: rfc8174 does not uppercase a keyword in underscore emphasis", () => {
  assertEquals(
    normalizeProseModals("It _must_ act.", "rfc8174"),
    "It _must_ act.",
  );
});

Deno.test("normalizeProseModals: rfc8174 keeps `mustnot` and `shallnot` as written", () => {
  assertEquals(
    normalizeProseModals("a mustnot and a shallnot", "rfc8174"),
    "a mustnot and a shallnot",
  );
});

Deno.test("normalizeProseModals: rfc8174 hard breaks: a backslash keeps `not`, two spaces do not", () => {
  assertEquals(
    normalizeProseModals("it must\\\nnot fail", "rfc8174"),
    "it MUST\\\nnot fail",
  );
  assertEquals(
    normalizeProseModals("it must  \nnot fail", "rfc8174"),
    "it MUST  \nNOT fail",
  );
});

Deno.test("normalizeProseModals: rfc8174 does not join a keyword and a `not` across a blank line", () => {
  assertEquals(
    normalizeProseModals("it must\n\nnot fail", "rfc8174"),
    "it MUST\n\nnot fail",
  );
  assertEquals(
    normalizeProseModals("it must\n  \nnot fail", "rfc8174"),
    "it MUST\n  \nnot fail",
  );
});

Deno.test("normalizeProseModals: rfc8174 leaves a `not` after a fenced code block", () => {
  assertEquals(
    normalizeProseModals("it must\n```\nx\n```\nnot fail", "rfc8174"),
    "it MUST\n```\nx\n```\nnot fail",
  );
  // A keyword inside the fence is kept as written.
  assertEquals(
    normalizeProseModals("```\nit must\nnot x\n```", "rfc8174"),
    "```\nit must\nnot x\n```",
  );
});

Deno.test("normalizeProseModals: rfc8174 uppercases a `not` on a continuation line indented four or more spaces", () => {
  assertEquals(
    normalizeProseModals("it must\n    not fail", "rfc8174"),
    "it MUST\n    NOT fail",
  );
  assertEquals(
    normalizeProseModals("it shall\n\tnot fail", "rfc8174"),
    "it SHALL\n\tNOT fail",
  );
  assertEquals(
    normalizeProseModals("it must\r\n      not fail", "rfc8174"),
    "it MUST\r\n      NOT fail",
  );
});

Deno.test("normalizeProseModals: rfc8174 leaves a `not` in code or inside a longer word", () => {
  assertEquals(
    normalizeProseModals("it must\nnothing here", "rfc8174"),
    "it MUST\nnothing here",
  );
  assertEquals(
    normalizeProseModals("it must\n`not` here", "rfc8174"),
    "it MUST\n`not` here",
  );
  assertEquals(
    normalizeProseModals("it `must`\nnot here", "rfc8174"),
    "it `must`\nnot here",
  );
  assertEquals(
    normalizeProseModals("it must `not` here", "rfc8174"),
    "it MUST `not` here",
  );
});

// The keyword and the `not` are both inside one code span that crosses a
// line break. Only the code-range check keeps them as written.
Deno.test("normalizeProseModals: rfc8174 keeps a keyword and `not` inside one code span across a line break", () => {
  assertEquals(
    normalizeProseModals("it `x must\nnot` y", "rfc8174"),
    "it `x must\nnot` y",
  );
  assertEquals(
    normalizeProseModals('[a](u "x shall\nnot") y', "rfc8174"),
    '[a](u "x shall\nnot") y',
  );
});

Deno.test("normalizeProseModals: rfc8174 does not match a hyphenated keyword before a `not` on the next line", () => {
  assertEquals(
    normalizeProseModals("a HALF-MUST\nnot here", "rfc8174"),
    "a HALF-MUST\nnot here",
  );
  assertEquals(
    normalizeProseModals("a must-\nnot here", "rfc8174"),
    "a must-\nnot here",
  );
  assertEquals(
    normalizeProseModals("a mustard\nnot here", "rfc8174"),
    "a mustard\nnot here",
  );
});

Deno.test("normalizeProseModals: rfc8174 keeps a keyword on a line indented four or more spaces", () => {
  assertEquals(
    normalizeProseModals("    it must not act", "rfc8174"),
    "    it must not act",
  );
});

Deno.test("normalizeProseModals: rfc8174 uppercases a sentence-initial keyword", () => {
  assertEquals(
    normalizeProseModals("Must we stop? Shall not.", "rfc8174"),
    "MUST we stop? SHALL NOT.",
  );
});

Deno.test("normalizeProseModals: rfc8174 keeps `must nothing` as MUST nothing", () => {
  assertEquals(
    normalizeProseModals("it must nothing", "rfc8174"),
    "it MUST nothing",
  );
});

Deno.test("normalizeProseModals: rfc8174 keeps uppercase MAY, SHOULD and WILL as written", () => {
  const text = "It MAY retry, SHOULD log and WILL stop. It may, should, will.";
  assertEquals(normalizeProseModals(text, "rfc8174"), text);
});
