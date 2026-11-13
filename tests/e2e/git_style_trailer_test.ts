/**
 * @module tests/e2e/git_style_trailer_test
 *
 * E2E: a git-style trailer block (no indentation, #914) in Markdown is
 * accepted, reported by `check` as MSL-P023, rewritten by `fmt`, and
 * reported as format drift (MSL-F010) by the project-wide gate.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspec, markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT = {
  "project.yaml": "name: git-style-e2e\nversion: 0.1.0\n",
  ".markspec.yaml": "{}\n",
};

const ULID = "01HGW2Q8MNP3RSTVWXYZABCDEF";

const GIT_STYLE = `# Doc

- [REQ-0001] Response time

  The system shall respond within 200 ms.

  Id: ${ULID}
  Labels: ASIL-B
`;

const INDENTED = `# Doc

- [REQ-0001] Response time

  The system shall respond within 200 ms.

      Id: ${ULID}
      Labels: ASIL-B
`;

Deno.test("check: git-style trailer warns MSL-P023 at the trailer line", async () => {
  const { code, stderr } = await markspec(["check", "doc.md"], {
    "doc.md": GIT_STYLE,
  });
  assertStringIncludes(stderr, "MSL-P023");
  assertStringIncludes(stderr, "doc.md:7");
  assertEquals(stderr.includes("error["), false, stderr);
  assertEquals(code, 2);
});

Deno.test("check: indented trailer raises no MSL-P023", async () => {
  const { stderr } = await markspec(["check", "doc.md"], {
    "doc.md": INDENTED,
  });
  assertEquals(stderr.includes("MSL-P023"), false, stderr);
});

Deno.test("fmt: rewrites a git-style trailer to the indented form", async () => {
  const run = await markspecPersist(["fmt", "doc.md"], { "doc.md": GIT_STYLE });
  try {
    assertEquals(run.code, 0, run.stderr);
    assertEquals(await Deno.readTextFile(join(run.dir, "doc.md")), INDENTED);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("check: project gate reports a git-style trailer as MSL-F010 drift", async () => {
  const { stderr } = await markspec(["check"], {
    files: { ...PROJECT, "docs/req.md": GIT_STYLE },
  });
  assertStringIncludes(stderr, "MSL-F010");
  assertStringIncludes(stderr, "file is not formatted");
});

Deno.test("fmt then check: the rewritten project is clean of MSL-P023 and MSL-F010", async () => {
  const run = await markspecPersist(["fmt"], {
    files: { ...PROJECT, "docs/req.md": GIT_STYLE },
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    const check = await markspecInDir(run.dir, ["check"]);
    assertEquals(check.stderr.includes("MSL-P023"), false, check.stderr);
    assertEquals(check.stderr.includes("MSL-F010"), false, check.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("check: non-core keys without Id stay body text, no trailer warning", async () => {
  const { stderr } = await markspec(["check", "doc.md"], {
    "doc.md": `# Doc

- [REQ-0001] Response time

  The system shall respond within 200 ms.

  Note: keep this
  Status: draft
`,
  });
  assertEquals(stderr.includes("MSL-P023"), false, stderr);
});
