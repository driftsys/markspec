/**
 * @module tests/e2e/insert_test
 *
 * E2E tests for `markspec insert <type> <file>` — the agent write
 * path. Appends a scaffolded entry block to an existing file.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { markspec, markspecPersist } from "./helpers.ts";

const PROJECT_YAML = `name: phase5-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/phase5-typed"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`;

const BASE_FILES = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": `profiles:\n  - ./profiles/typed\n`,
  "profiles/typed/markspec.yaml": PROFILE_YAML,
};

const ULID_RE = /Id: [0-9A-HJKMNP-TV-Z]{26}/;

Deno.test("insert: appends a new entry to the target file", async () => {
  const initial = `# Requirements

- [REQ-0001] First

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const { code, stderr } = await markspec(
    ["insert", "requirement", "req.md"],
    {
      files: {
        ...BASE_FILES,
        "req.md": initial,
      },
    },
  );
  assertEquals(code, 0, `expected exit 0; stderr: ${stderr}`);

  // Re-run to validate; should still be 0 errors. We can't easily
  // read the file back through the helper, so assert via a follow-up
  // validate run on the modified file inside the helper's temp dir.
  // Instead, assert the success message + new display ID surfaced.
  assertStringIncludes(stderr, "REQ-0002");
  assertStringIncludes(stderr, "req.md");
});

Deno.test("insert: starts from REQ-0001 when target file is empty/no entries", async () => {
  const { code, stderr } = await markspec(
    ["insert", "requirement", "req.md"],
    {
      files: {
        ...BASE_FILES,
        "req.md": `# Empty\n`,
      },
    },
  );
  assertEquals(code, 0);
  assertStringIncludes(stderr, "REQ-0001");
});

Deno.test("insert: emits a real ULID (not a placeholder)", async () => {
  const { code, stdout, stderr } = await markspec(
    ["insert", "requirement", "req.md", "--print"],
    {
      files: {
        ...BASE_FILES,
        "req.md": `# Empty\n`,
      },
    },
  );
  assertEquals(code, 0, `expected exit 0; stderr: ${stderr}`);
  // --print echoes the inserted block to stdout for inspection.
  assert(ULID_RE.test(stdout), `expected a ULID in stdout, got: ${stdout}`);
});

Deno.test("insert: unknown type fails with error", async () => {
  const { code, stderr } = await markspec(
    ["insert", "no-such-type", "req.md"],
    {
      files: {
        ...BASE_FILES,
        "req.md": `# Empty\n`,
      },
    },
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no-such-type");
});

Deno.test("insert: target file missing fails with error", async () => {
  const { code, stderr } = await markspec(
    ["insert", "requirement", "does-not-exist.md"],
    {
      files: BASE_FILES,
    },
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "does-not-exist.md");
});

Deno.test("insert: a Satisfies target in another file reports no MSL-L006 (#950)", async () => {
  const { code, stderr } = await markspec(
    ["insert", "requirement", "req.md"],
    {
      files: {
        ...BASE_FILES,
        "profiles/typed/markspec.yaml": `${PROFILE_YAML}      traceability:
        Satisfies:
          target: [requirement]
          cardinality: 0..3
          required: false
`,
        "req.md": `# Requirements

- [REQ-0001] First

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Satisfies: REQ-0900
`,
        "other.md": `# Other

- [REQ-0900] Elsewhere

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`,
      },
    },
  );
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("MSL-L006"), false, stderr);
});

// ---------------------------------------------------------------------------
// The IDs of the whole project count (#1047)
// ---------------------------------------------------------------------------

const PROJECT_PROFILE_YAML = `id: "@acme/project-ids"
version: 0.1.0
profile:
  types:
    software-requirement:
      extends: Requirement
      display-id-pattern: "SRS_{scope}_{n:04d}"
    stakeholder-requirement:
      extends: Requirement
      display-id-pattern: "STK_{n:04d}"
`;

/** One entry block with display ID `id` and a fixed ULID suffix `n`. */
function block(id: string, n: number): string {
  return `- [${id}] Request ${n}

  The controller shall respond within ${n}00 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCD${String(n).padStart(2, "0")}
`;
}

const A_MD = `# A\n\n${
  [
    block("SRS_BRK_0001", 1),
    block("SRS_BRK_0002", 2),
    block("STK_0001", 3),
    block("STK_0002", 4),
  ].join("\n")
}`;
const B_MD = `# B\n\n${
  [block("SRS_BRK_0001", 5), block("STK_0001", 6)].join("\n")
}`;

/** A project whose profile is at the project root. */
function projectFiles(root: string): Record<string, string> {
  const at = (name: string) => root === "" ? name : `${root}/${name}`;
  return {
    [at("project.yaml")]: PROJECT_YAML,
    [at(".markspec.yaml")]: `profiles:\n  - ./profiles/acme\n`,
    [at("profiles/acme/markspec.yaml")]: PROJECT_PROFILE_YAML,
  };
}

Deno.test("insert --scope: an ID in another file of the project counts (#1047)", async () => {
  const run = await markspecPersist(
    ["insert", "software-requirement", "--scope", "BRK", "b.md"],
    { files: { ...projectFiles(""), "a.md": A_MD, "b.md": B_MD } },
  );
  try {
    assertEquals(run.code, 0, run.stderr);
    assertStringIncludes(run.stderr, "appended SRS_BRK_0003 to b.md");
    const text = await Deno.readTextFile(`${run.dir}/b.md`);
    assertEquals(text.startsWith(B_MD), true, text);
    assertStringIncludes(text.slice(B_MD.length), "- [SRS_BRK_0003] ");
    // The other file is never written.
    assertEquals(await Deno.readTextFile(`${run.dir}/a.md`), A_MD);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("insert: an ID in another file of the project counts for a pattern without {scope} (#1047)", async () => {
  const run = await markspecPersist(
    ["insert", "stakeholder-requirement", "b.md"],
    { files: { ...projectFiles(""), "a.md": A_MD, "b.md": B_MD } },
  );
  try {
    assertEquals(run.code, 0, run.stderr);
    assertStringIncludes(run.stderr, "appended STK_0003 to b.md");
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("insert: the project of the target file counts, not the current directory (#1047)", async () => {
  const run = await markspecPersist(
    ["insert", "software-requirement", "--scope", "BRK", "../docs/b.md"],
    {
      files: { ...projectFiles(""), "docs/a.md": A_MD, "docs/b.md": B_MD },
      cwd: "profiles",
    },
  );
  try {
    assertEquals(run.code, 0, run.stderr);
    assertStringIncludes(run.stderr, "appended SRS_BRK_0003");
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("insert: a file excluded by .markspec.yaml exclude: is not read (#1047)", async () => {
  const run = await markspecPersist(
    ["insert", "software-requirement", "--scope", "BRK", "b.md"],
    {
      files: {
        ...projectFiles(""),
        ".markspec.yaml":
          `profiles:\n  - ./profiles/acme\nexclude:\n  - archive/\n`,
        "archive/a.md": A_MD,
        "b.md": B_MD,
      },
    },
  );
  try {
    assertEquals(run.code, 0, run.stderr);
    // archive/a.md holds SRS_BRK_0002, but a bare `check` skips it too.
    assertStringIncludes(run.stderr, "appended SRS_BRK_0002 to b.md");
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("insert: a target file with no project config above it reads only its own entries (#1047)", async () => {
  // The profile comes from the project.yaml of the current directory, as
  // before; the target file lies outside that project, so the other file
  // next to it is not read.
  const run = await markspecPersist(
    ["insert", "software-requirement", "--scope", "BRK", "../loose/b.md"],
    {
      files: {
        ...projectFiles("proj"),
        "loose/a.md": A_MD,
        "loose/b.md": B_MD,
      },
      cwd: "proj",
    },
  );
  try {
    assertEquals(run.code, 0, run.stderr);
    assertStringIncludes(run.stderr, "appended SRS_BRK_0002");
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
