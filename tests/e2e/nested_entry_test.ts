/**
 * @module tests/e2e/nested_entry_test
 *
 * E2E: an entry-shaped list item nested in an entry (#928) is not an entry.
 * `check` reports MSL-P024, the parent keeps its own Id, and `fmt` leaves
 * the file unchanged and gives the same output when run twice.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspec, markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: nested-e2e\nversion: 0.1.0\n",
  ".markspec.yaml": "{}\n",
};

const PARENT_ID = "01HGW2Q8MNP3RSTVWXYZABCDEF";
const CHILD_ID = "01HGW2Q8MNP3RSTVWXYZABCDEG";

const NESTED = `# Doc

- [REQ-0001] Parent

  The system shall keep its own Id.

      Id: ${PARENT_ID}

  - [REQ-0003] Child

    Child body.

        Id: ${CHILD_ID}
`;

Deno.test("check: a nested entry warns MSL-P024 and not MSL-P020", async () => {
  const { code, stderr } = await markspec(["check", "doc.md"], {
    "doc.md": NESTED,
  });
  assertStringIncludes(stderr, "MSL-P024");
  assertStringIncludes(stderr, "doc.md:9");
  assertEquals(stderr.includes("MSL-P020"), false, stderr);
  assertEquals(stderr.includes("error["), false, stderr);
  assertEquals(code, 2);
});

Deno.test("compile: the parent keeps its own Id next to a nested entry", async () => {
  const { stdout } = await markspec(["compile", "doc.md", "--format", "json"], {
    files: { ...PROJECT, "doc.md": NESTED },
  });
  assertStringIncludes(stdout, PARENT_ID);
  assertEquals(stdout.includes(CHILD_ID), false);
});

Deno.test("fmt: a nested entry is left unchanged and fmt is idempotent", async () => {
  const run = await markspecPersist(["fmt", "doc.md"], {
    files: { ...PROJECT, "doc.md": NESTED },
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    const first = await Deno.readTextFile(join(run.dir, "doc.md"));
    assertEquals(first, NESTED);
    await markspecInDir(run.dir, ["fmt", "doc.md"]);
    assertEquals(await Deno.readTextFile(join(run.dir, "doc.md")), first);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

const UNSEPARATED = `# Doc

- [REQ-0001] Parent

  The system shall keep its own Id.
  Id: ${PARENT_ID}
  - [REQ-0003] Child

    Child body.

        Id: ${CHILD_ID}
`;

Deno.test("fmt: a trailer directly above a nested entry keeps both Ids", async () => {
  const run = await markspecPersist(["fmt", "doc.md"], {
    files: { ...PROJECT, "doc.md": UNSEPARATED },
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    const first = await Deno.readTextFile(join(run.dir, "doc.md"));
    assertStringIncludes(first, `      Id: ${PARENT_ID}\n`);
    assertStringIncludes(first, `        Id: ${CHILD_ID}\n`);
    await markspecInDir(run.dir, ["fmt", "doc.md"]);
    assertEquals(await Deno.readTextFile(join(run.dir, "doc.md")), first);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
