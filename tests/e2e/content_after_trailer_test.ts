/**
 * @module tests/e2e/content_after_trailer_test
 *
 * E2E: content after an entry's trailer, in the same list item (#985).
 * `check` names the cause with MSL-P025 at the first such line, and `fmt`
 * leaves the file unchanged: it stamps no second `Id:`.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: after-trailer-e2e\nversion: 0.1.0\n",
  ".markspec.yaml": "{}\n",
};

const DOC = `- [REQ-001] Parent

  The system shall keep its Id.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

  - sibling plain
`;

Deno.test("e2e: check reports MSL-P025 for content after the trailer, fmt changes nothing (#985)", async () => {
  const { dir, stderr } = await markspecPersist(["check", "doc.md"], {
    ...PROJECT,
    "doc.md": DOC,
  });
  try {
    assertStringIncludes(stderr, "MSL-P025]: doc.md:7");
    assertStringIncludes(stderr, "above the trailer");
    assert(!stderr.includes("MSL-P020"), stderr);
    assertStringIncludes(
      stderr,
      "move the content after the trailer above it (MSL-P025)",
    );
    await markspecInDir(dir, ["fmt", "doc.md"]);
    assertEquals(await Deno.readTextFile(join(dir, "doc.md")), DOC);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

const RUST = `/// [REQ-002] Parent
///
/// The system shall keep its Id.
///
///     Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
///
/// - sib
fn foo() {}
`;

Deno.test("e2e: a source doc comment with content after the trailer keeps the base diagnostics and the default MSL-I003 (#985)", async () => {
  const { dir, stderr } = await markspecPersist(["check", "s.rs"], {
    ...PROJECT,
    "s.rs": RUST,
  });
  try {
    // As before #985: a source file gets no parse diagnostic, so no MSL-P020.
    assert(!stderr.includes("MSL-P020"), stderr);
    assertStringIncludes(stderr, "MSL-R003");
    assertStringIncludes(stderr, "run fmt to mint a ULID");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
