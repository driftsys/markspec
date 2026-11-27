/**
 * @module tests/e2e/fmt_trailer_like_wrap_test
 *
 * E2E (#1034): `markspec fmt` can wrap an entry body so that its last line
 * looks like a malformed trailer line (`below:`, or `some_signal_name: ...`)
 * directly under the prose line above it. The parser keeps that line in the
 * body, so `markspec check` must not report it as MSL-P021 or MSL-P022: a
 * file that passes `check` still passes it after `fmt`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = "name: repro\nversion: 0.0.0\n";

const CASES: ReadonlyArray<
  { name: string; doc: string; wrapped: string }
> = [
  {
    name: "a word and a colon",
    doc: `# Repro

- [REQ_0001] Wrap before a colon

  Each section of this chapter shall follow the functional requirement layout below:

      Id: 01M4K302WXTJ1ENHY3AX47HNAG
`,
    wrapped: "  Each section of this chapter shall follow the functional " +
      "requirement layout\n  below:\n\n      Id: ",
  },
  {
    name: "a snake_case key and a colon",
    doc: `# Repro

- [REQ_0002] Wrap before a snake key

  The controller shall publish the value of the following signal on change some_signal_name: the speed.

      Id: 01M4K302WXTJ1ENHY3AX47HNAH
`,
    wrapped: "  The controller shall publish the value of the following " +
      "signal on change\n  some_signal_name: the speed.\n\n      Id: ",
  },
  {
    name: "a word and a colon after a Note: lead-in",
    doc: `# Repro

- [REQ_0003] Wrap a Note paragraph before a colon

  The lamp shall light within 100 ms.

  Note: each section of this chapter shall follow the functional lamp layout below:

      Id: 01M4K302WXTJ1ENHY3AX47HNAJ
`,
    wrapped:
      "  Note: each section of this chapter shall follow the functional " +
      "lamp layout\n  below:\n\n      Id: ",
  },
  {
    name: "a word and a colon after a Rationale: lead-in",
    doc: `# Repro

- [REQ_0004] Wrap a Rationale paragraph before a colon

  Rationale: each section of this chapter shall follow the functional layout below:

      Id: 01M4K302WXTJ1ENHY3AX47HNAK
`,
    wrapped: "  Rationale: each section of this chapter shall follow the " +
      "functional layout\n  below:\n\n      Id: ",
  },
];

for (const { name, doc, wrapped } of CASES) {
  Deno.test(`check passes after fmt wraps a body onto ${name} (#1034)`, async () => {
    const before = await markspecPersist(["check", "spec.md"], {
      files: { "project.yaml": PROJECT, "spec.md": doc },
    });
    try {
      assertEquals(before.code, 0, `check before fmt: ${before.stderr}`);

      const formatted = await markspecInDir(before.dir, ["fmt", "spec.md"]);
      assertEquals(formatted.code, 0, `fmt: ${formatted.stderr}`);
      // fmt produced the wrapped, trailer-like last body line.
      const out = await Deno.readTextFile(join(before.dir, "spec.md"));
      assertStringIncludes(out, wrapped);

      const after = await markspecInDir(before.dir, ["check", "spec.md"]);
      assertEquals(after.code, 0, `check after fmt: ${after.stderr}`);
      const output = after.stderr + after.stdout;
      assertEquals(output.includes("MSL-P021"), false, output);
      assertEquals(output.includes("MSL-P022"), false, output);
    } finally {
      await Deno.remove(before.dir, { recursive: true });
    }
  });
}
