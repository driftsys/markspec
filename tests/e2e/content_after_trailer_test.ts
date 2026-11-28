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

// #998: a trailer whose `Id:` line is indented with a tab, followed by a list
// item. The tab expands to column 4, so the line is a git-style trailer
// paragraph in the list item, and the list item after it is content after the
// trailer.
const TAB_DOC = `- [REQ-001] Parent

  The system shall keep its Id.

\tId: 01HGW2Q8MNP3RSTVWXYZABCDEF

  - sib
`;

Deno.test("e2e: a tab-indented Id: line followed by a list item gets MSL-P025, fmt never stamps a second Id (#998)", async () => {
  const { dir, stderr } = await markspecPersist(["check", "doc.md"], {
    ...PROJECT,
    "doc.md": TAB_DOC,
  });
  try {
    assertStringIncludes(stderr, "MSL-P025]: doc.md:7");
    assert(!stderr.includes("MSL-P020"), stderr);
    assertStringIncludes(
      stderr,
      "move the content after the trailer above it (MSL-P025)",
    );
    const path = join(dir, "doc.md");
    await markspecInDir(dir, ["fmt", "doc.md"]);
    const once = await Deno.readTextFile(path);
    await markspecInDir(dir, ["fmt", "doc.md"]);
    const twice = await Deno.readTextFile(path);
    assertEquals(once, TAB_DOC);
    assertEquals(twice, once);
    assertEquals(once.match(/Id:/g)?.length, 1);
    assertStringIncludes(once, "\tId: 01HGW2Q8MNP3RSTVWXYZABCDEF\n");
    assert(!once.includes("```"), once);
    const after = await markspecInDir(dir, ["check", "doc.md"]);
    assertStringIncludes(after.stderr, "MSL-P025]: doc.md:7");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("e2e: a tab-indented Id: line as the last block keeps its Id after fmt (#998)", async () => {
  const doc = TAB_DOC.replace("\n  - sib\n", "");
  const { dir, stderr } = await markspecPersist(["check", "doc.md"], {
    ...PROJECT,
    "doc.md": doc,
  });
  try {
    assertStringIncludes(stderr, "MSL-P023");
    assert(!stderr.includes("MSL-I003"), stderr);
    const path = join(dir, "doc.md");
    await markspecInDir(dir, ["fmt", "doc.md"]);
    const once = await Deno.readTextFile(path);
    await markspecInDir(dir, ["fmt", "doc.md"]);
    assertEquals(await Deno.readTextFile(path), once);
    assertEquals(once.match(/Id:/g)?.length, 1);
    assertStringIncludes(once, "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n");
    const after = await markspecInDir(dir, ["check", "doc.md"]);
    assertEquals(after.code, 0, after.stderr);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
