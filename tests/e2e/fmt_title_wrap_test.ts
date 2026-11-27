/**
 * @module tests/e2e/fmt_title_wrap_test
 *
 * E2E: `fmt` wraps an entry title longer than the line width, as `prim fmt`
 * does, and keeps an already wrapped title as it is (#984). The input is the
 * `SAD_DESK_0012` entry of ADR-035, which `fmt` used to join onto one line of
 * 82 columns, so bare `check` reported MSL-F010 on it.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspec, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: title-wrap-e2e\nversion: 0.1.0\n",
};

const WRAPPED =
  `- [SAD_DESK_0012] Read endpoints for documents, rendered entries, and source
  text

  The desk backend shall serve three read endpoints.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

const JOINED = WRAPPED.replace("source\n  text", "source text");

Deno.test("e2e: fmt wraps a long entry title at the line width (#984)", async () => {
  const { dir, code, stderr } = await markspecPersist(["fmt", "adr.md"], {
    ...PROJECT,
    "adr.md": JOINED,
  });
  try {
    assertEquals(code, 0, stderr);
    assertEquals(await Deno.readTextFile(join(dir, "adr.md")), WRAPPED);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("e2e: check reports no fmt drift on a wrapped entry title (#984)", async () => {
  const { stderr } = await markspec(["check"], {
    ...PROJECT,
    "adr.md": WRAPPED,
  });
  assertEquals(stderr.includes("MSL-F010"), false, stderr);
});

Deno.test("e2e: fmt honors max_line_length for entry titles (#984)", async () => {
  const { dir, code, stderr } = await markspecPersist(["fmt", "adr.md"], {
    ...PROJECT,
    ".editorconfig": "root = true\n\n[*]\nmax_line_length = 100\n",
    "adr.md": WRAPPED,
  });
  try {
    assertEquals(code, 0, stderr);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "adr.md")),
      "and source text\n",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
