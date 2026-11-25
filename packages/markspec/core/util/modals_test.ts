import { assertEquals } from "@std/assert";
import { normalizeProseModals } from "./modals.ts";

// #1009: the casing pass changes prose only. Link destinations, titles and
// labels, autolinks, images, link reference definitions and raw HTML keep
// their text. The visible text of a link is prose and is lowercased.
for (
  const [name, input, expected] of [
    [
      "an inline link URL",
      "The system SHALL follow [SHALL](http://x.example/SHALL).",
      "The system shall follow [shall](http://x.example/SHALL).",
    ],
    [
      "a link title",
      '[x](http://a.example/p "SHALL")',
      '[x](http://a.example/p "SHALL")',
    ],
    [
      "an angle-bracket autolink",
      "See <http://x.example/MUST> now.",
      "See <http://x.example/MUST> now.",
    ],
    [
      "a GFM literal autolink",
      "See http://y.example/MAY now.",
      "See http://y.example/MAY now.",
    ],
    [
      "an inline image",
      "See ![SHALL](p/SHALL.png) here.",
      "See ![SHALL](p/SHALL.png) here.",
    ],
    [
      "a full reference link label",
      "Use [MAY][SHALL].\n\n[SHALL]: http://z.example/SHALL",
      "Use [may][SHALL].\n\n[SHALL]: http://z.example/SHALL",
    ],
    [
      "a shortcut reference link",
      "See [SHALL].\n\n[SHALL]: http://z.example/",
      "See [SHALL].\n\n[SHALL]: http://z.example/",
    ],
    [
      "a collapsed reference link",
      "See [SHALL][].\n\n[SHALL]: http://z.example/",
      "See [SHALL][].\n\n[SHALL]: http://z.example/",
    ],
    [
      "a reference image",
      "See ![SHALL][img].\n\n[img]: p.png",
      "See ![SHALL][img].\n\n[img]: p.png",
    ],
    [
      "a footnote label",
      "A note[^SHALL].\n\n[^SHALL]: It MUST hold.",
      "A note[^SHALL].\n\n[^SHALL]: It must hold.",
    ],
    [
      "inline raw HTML",
      'A <a href="x/SHALL">MUST</a> link.',
      'A <a href="x/SHALL">must</a> link.',
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
