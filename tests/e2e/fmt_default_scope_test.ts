/**
 * @module tests/e2e/fmt_default_scope_test
 *
 * E2E: bare `markspec fmt` formats every markdown file under the project
 * root (gitignore-aware), never touches source files, and errors with a
 * hint outside a project.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec, markspecPersist } from "./helpers.ts";

const PROJECT_YAML = `name: fmt-scope-e2e\nversion: 0.1.0\n`;

const UNFORMATTED = `# Doc

- [REQ-0001] A requirement

  The system shall respond within 200 ms.

    Labels: x
`;

Deno.test("fmt: bare invocation formats project markdown", async () => {
  const run = await markspecPersist(["fmt"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "docs/a.md": UNFORMATTED,
      ".gitignore": "ignored/\n",
      "ignored/b.md": UNFORMATTED,
    },
  });
  try {
    assertEquals(run.code, 0, `stderr: ${run.stderr}`);
    // Scope header announces the project-wide default.
    assertStringIncludes(run.stderr, "file(s) under");
    // The tracked file was stamped (Id: added by the formatter)...
    const formatted = await Deno.readTextFile(`${run.dir}/docs/a.md`);
    assertStringIncludes(formatted, "Id: ");
    // ...the gitignored file was not touched.
    const ignored = await Deno.readTextFile(`${run.dir}/ignored/b.md`);
    assertEquals(ignored, UNFORMATTED);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("fmt: bare invocation outside a project errors with hint", async () => {
  const { code, stderr } = await markspec(["fmt"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no project root found");
  assertStringIncludes(stderr, "markspec init");
});

Deno.test("fmt: directory argument expands to markdown inside it", async () => {
  const run = await markspecPersist(["fmt", "docs"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "docs/a.md": UNFORMATTED,
      "other/b.md": UNFORMATTED,
    },
  });
  try {
    assertEquals(run.code, 0, `stderr: ${run.stderr}`);
    const inside = await Deno.readTextFile(`${run.dir}/docs/a.md`);
    assertStringIncludes(inside, "Id: ");
    // Outside the named directory: untouched.
    const outside = await Deno.readTextFile(`${run.dir}/other/b.md`);
    assertEquals(outside, UNFORMATTED);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
