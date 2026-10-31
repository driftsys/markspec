/**
 * @module tests/e2e/check_nested_test
 *
 * E2E: bare `markspec check` treats a folder with its own `project.yaml` as a
 * separate project (ADR-028 section 7, #856). Each project is checked with
 * its own profile, graph, lockfile and gates.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspecInDir, markspecPersist } from "./helpers.ts";
import { BASE_FILES, CLEAN_REQ } from "./check_project_test.ts";

/** The same project files, placed under `sub/`. */
function nested(
  files: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([k, v]) => [`sub/${k}`, v]),
  );
}

const SUB_BASE = nested({
  ...BASE_FILES,
  "project.yaml": "name: nested-sub\nversion: 0.1.0\n",
});

const SUB_REQ = CLEAN_REQ.replace(
  "01REQ000000000000000000001",
  "01REQ000000000000000000002",
);

async function check(
  files: Record<string, string>,
  args: string[] = ["check"],
) {
  const r = await markspecPersist(args, { files });
  await Deno.remove(r.dir, { recursive: true });
  return r;
}

Deno.test("check nested: same display ID in parent and sub is not a duplicate", async () => {
  const r = await check({
    ...BASE_FILES,
    "docs/req.md": CLEAN_REQ,
    ...SUB_BASE,
    "sub/docs/req.md": SUB_REQ,
  });
  assertEquals(r.stderr.includes("MSL-R006"), false, r.stderr);
  assertEquals(r.stderr.includes("MSL-I008"), false, r.stderr);
  assertEquals(r.code, 0, r.stderr);
});

Deno.test("check nested: parent link into sub is unresolved (MSL-L006)", async () => {
  const r = await check({
    ...BASE_FILES,
    "docs/sreq.md": `# System Requirements

- [SREQ-0001] Derived response time

  The system shall forward responses within 100 ms.

      Id: 01SREQ00000000000000000001
      Type: system-requirement
      Satisfies: REQ-0001
`,
    ...SUB_BASE,
    "sub/docs/req.md": SUB_REQ,
  });
  assertStringIncludes(r.stderr, "MSL-L006");
  assertStringIncludes(r.stderr, "SREQ-0001");
});

Deno.test("check nested: error inside sub is reported and sets the exit code", async () => {
  const r = await check({
    ...BASE_FILES,
    "docs/req.md": CLEAN_REQ,
    ...SUB_BASE,
    "sub/docs/req.md": SUB_REQ + "\n" + SUB_REQ.replace(
      "01REQ000000000000000000002",
      "01REQ000000000000000000003",
    ),
  });
  assertEquals(r.code, 1, r.stderr);
  assertStringIncludes(r.stderr, "MSL-R006");
  assertStringIncludes(r.stderr, "sub/docs/req.md");
});

Deno.test("check nested: sub is validated with its own profile", async () => {
  const widgetProfile = `id: "@acme/widget"
version: 0.1.0
profile:
  types:
    widget:
      extends: Requirement
      display-id-pattern: "WID-{n:04d}"
`;
  const r = await check({
    ...BASE_FILES,
    "docs/req.md": CLEAN_REQ,
    "sub/project.yaml": "name: nested-sub\nversion: 0.1.0\n",
    "sub/.markspec.yaml": "profiles:\n  - ./profiles/w\n",
    "sub/profiles/w/markspec.yaml": widgetProfile,
    "sub/docs/wid.md": `# Widgets

- [WID-0001] Widget response

  The widget shall respond within 200 ms.

      Id: 01WDG000000000000000000001
      Type: widget
`,
  });
  assertEquals(r.stderr.includes("error["), false, r.stderr);
  assertEquals(r.stderr.includes("MSL-T"), false, r.stderr);
});

Deno.test("check nested: scope header once per project", async () => {
  const r = await check({
    ...BASE_FILES,
    "docs/req.md": CLEAN_REQ,
    ...SUB_BASE,
    "sub/docs/req.md": SUB_REQ,
  });
  const headers = r.stderr.split("\n").filter((l) => l.startsWith("checking "));
  assertEquals(headers.length, 2, r.stderr);
  assertStringIncludes(headers[0], "1 file(s)");
  assertEquals(headers[0].endsWith("/sub"), false);
  assertEquals(headers[1].endsWith("/sub"), true);
});

Deno.test("check nested: --format json is one flat array", async () => {
  const r = await check({
    ...BASE_FILES,
    "docs/bad.md": CLEAN_REQ.replace("Type: requirement\n", "Type: nope\n"),
    ...SUB_BASE,
    "sub/docs/bad.md": SUB_REQ.replace("Type: requirement\n", "Type: nope\n"),
  }, ["check", "--format", "json"]);
  const parsed = JSON.parse(r.stdout);
  assertEquals(Array.isArray(parsed), true);
  const files = parsed.map((d: { location?: { file: string } }) =>
    d.location?.file ?? ""
  );
  assertEquals(files.some((f: string) => f.includes("/sub/")), true, r.stdout);
  assertEquals(
    files.some((f: string) =>
      f.endsWith("docs/bad.md") && !f.includes("/sub/")
    ),
    true,
    r.stdout,
  );
});

Deno.test("check nested: lock then check reports no MSL-L212", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      ...BASE_FILES,
      "docs/req.md": CLEAN_REQ,
      ...SUB_BASE,
      "sub/docs/req.md": SUB_REQ,
    },
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    const r = await markspecInDir(run.dir, ["check"]);
    assertEquals(r.stderr.includes("MSL-L212"), false, r.stderr);
    assertEquals(r.code, 0, r.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

/** An unstamped requirement inside the gitignored `sub/gen/` folder. `fmt`
 * would stamp an `Id:` into it; `check` would report it. */
const GEN_REQ = `# Generated

- [REQ-0009] Generated requirement

  The system shall log within 50 ms.

      Type: requirement
`;

/** Root and nested project, a root `.gitignore` that ignores `gen/`, and a
 * `.git` directory that makes the root the git work-tree root. */
const GITIGNORED_GEN = {
  ".git/HEAD": "ref: refs/heads/main\n",
  ".gitignore": "gen/\n",
  ...BASE_FILES,
  "docs/req.md": CLEAN_REQ,
  ...SUB_BASE,
  "sub/docs/req.md": SUB_REQ,
  "sub/gen/x.md": GEN_REQ,
};

Deno.test("check nested: root .gitignore applies inside sub (bare check)", async () => {
  const r = await check(GITIGNORED_GEN);
  assertEquals(r.stderr.includes("gen/x.md"), false, r.stderr);
  assertEquals(r.stderr.includes("REQ-0009"), false, r.stderr);
  assertEquals(r.code, 0, r.stderr);
});

Deno.test("check nested: root .gitignore applies inside sub (bare fmt --check)", async () => {
  const r = await check(GITIGNORED_GEN, ["fmt", "--check"]);
  assertEquals(r.stdout.includes("gen/x.md"), false, r.stdout);
  assertEquals(r.stderr.includes("gen/x.md"), false, r.stderr);
  assertEquals(r.code, 0, r.stderr);
});

Deno.test("check nested: lock run from sub pins the file set bare check uses", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      ...GITIGNORED_GEN,
      // An edge in the gitignored folder: if `lock` and `check` disagree on
      // whether `sub/gen/` belongs to `sub`, the pinned edges differ.
      "sub/gen/x.md": `# Generated

- [SREQ-0009] Generated derived requirement

  The system shall forward logs within 50 ms.

      Id: 01SREQ00000000000000000009
      Type: system-requirement
      Satisfies: REQ-0001
`,
    },
    cwd: "sub",
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    const lock = await Deno.readTextFile(`${run.dir}/sub/markspec.lock`);
    assertEquals(lock.includes("01SREQ00000000000000000009"), false, lock);
    const r = await markspecInDir(run.dir, ["check"]);
    assertEquals(r.stderr.includes("MSL-L212"), false, r.stderr);
    assertEquals(r.code, 0, r.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

/** A system requirement in `sub` with no `Satisfies:` edge yet. */
const SUB_SREQ = `# System Requirements

- [SREQ-0001] Derived response time

  The system shall forward responses within 100 ms.

      Id: 01SREQ00000000000000000001
      Type: system-requirement
`;

/** Lock `sub` from inside it, then return the persisted run. */
async function lockSub() {
  const run = await markspecPersist(["lock"], {
    files: {
      ...BASE_FILES,
      "docs/req.md": CLEAN_REQ,
      ...SUB_BASE,
      "sub/docs/req.md": SUB_REQ,
      "sub/docs/sreq.md": SUB_SREQ,
    },
    cwd: "sub",
  });
  assertEquals(run.code, 0, run.stderr);
  return run;
}

Deno.test("check nested: a fresh markspec.lock in sub is clean", async () => {
  const run = await lockSub();
  try {
    const r = await markspecInDir(run.dir, ["check"]);
    assertEquals(r.stderr.includes("MSL-L212"), false, r.stderr);
    assertEquals(r.code, 0, r.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("check nested: a stale markspec.lock in sub reports MSL-L212 in sub", async () => {
  const run = await lockSub();
  try {
    const sreqPath = `${run.dir}/sub/docs/sreq.md`;
    const content = await Deno.readTextFile(sreqPath);
    await Deno.writeTextFile(
      sreqPath,
      content.replace(
        "Type: system-requirement\n",
        "Type: system-requirement\n      Satisfies: REQ-0001\n",
      ),
    );
    const r = await markspecInDir(run.dir, ["check", "--format", "json"]);
    assertEquals(r.code, 1, r.stderr);
    const diags = JSON.parse(r.stdout) as Array<
      { code: string; location?: { file: string } }
    >;
    const l212 = diags.filter((d) => d.code === "MSL-L212");
    assertEquals(l212.length, 1, r.stdout);
    assertStringIncludes(l212[0].location?.file ?? "", "/sub/markspec.lock");
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
