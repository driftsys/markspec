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
      defs,
    ),
    "See [SHALL] and [the rule must][SHALL][^MUST].",
  );
  assertEquals(normalizeProseModals("See [SHALL].", ""), "See [shall].");
});
