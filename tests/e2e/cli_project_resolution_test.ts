/**
 * @module tests/e2e/cli_project_resolution_test
 *
 * E2E: the CLI finds the project of each file the same way as the LSP and
 * the MCP server (#845): walk up to the nearest `project.yaml`, else the
 * nearest `.markspec.yaml`.
 *
 * - Explicit file arguments resolve their project from the file's own
 *   directory, not from the current directory.
 * - Files from different projects are validated separately, each against
 *   its own profile.
 * - A bare invocation resolves the project from the current directory and
 *   accepts a `.markspec.yaml`-only project.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { basename, join } from "@std/path";
import { markspec, markspecInDir, markspecPersist } from "./helpers.ts";

/** A local profile that declares the `STK_{n:04d}` type and one text
 * attribute. */
function profileDeclaring(id: string, attribute: string): string {
  return `id: "@acme/${id}"
version: 0.1.0
markspec-schema: "1"
profile:
  attributes:
    - name: ${attribute}
      type: text
  types:
    stakeholder-requirement:
      extends: Requirement
      display-id-pattern: "STK_{n:04d}"
`;
}

/** One formatter-clean entry block that carries the given trailer line.
 * The ULIDs are the ones already used by the LSP e2e fixtures. */
function entryUsing(
  displayId: string,
  attributeLine: string,
  idSuffix = "F",
): string {
  return `# Requirements

- [${displayId}] A requirement

  The system shall respond within 200 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDE${idSuffix}
      ${attributeLine}
`;
}

/** Like {@linkcode entryUsing}, with a body that prose lint flags (vague
 * wording, a placeholder, a pronoun). */
function lintyEntry(
  displayId: string,
  attributeLine: string,
  idSuffix = "F",
): string {
  return entryUsing(displayId, attributeLine, idSuffix).replace(
    "The system shall respond within 200 ms.",
    "The system shall respond as appropriate and/or etc. It may be done TBD.",
  );
}

/** A `.markspec.yaml`-only project (no `project.yaml`) whose local profile
 * declares `Priority`. */
const MARKSPEC_ONLY_PROJECT: Record<string, string> = {
  "proj/.markspec.yaml": "profiles:\n  - ./prof\nexclude:\n  - prof/\n",
  "proj/prof/markspec.yaml": profileDeclaring("prof", "Priority"),
  "proj/docs/req.md": entryUsing("STK_0001", "Priority: high"),
  "outside/.keep": "",
};

/** The duplicate display-ID / duplicate Id diagnostic codes. */
const DUPLICATE_CODES = ["MSL-R005", "MSL-R006", "MSL-I007", "MSL-I008"];

Deno.test("check <file>: .markspec.yaml-only project, run from the project root (#845)", async () => {
  const { code, stderr } = await markspec(["check", "docs/req.md"], {
    files: MARKSPEC_ONLY_PROJECT,
    cwd: "proj",
  });
  assertEquals(stderr.includes("MSL-R010"), false, stderr);
  assertEquals(code, 0, stderr);
});

Deno.test("check <file>: .markspec.yaml-only project, run from a subdirectory (#845)", async () => {
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: MARKSPEC_ONLY_PROJECT,
    cwd: "proj/docs",
  });
  assertEquals(stderr.includes("MSL-R010"), false, stderr);
  assertEquals(code, 0, stderr);
});

Deno.test("check <file>: .markspec.yaml-only project, run from outside the project (#845)", async () => {
  const run = await markspecPersist(["--version"], {
    files: MARKSPEC_ONLY_PROJECT,
  });
  try {
    const { code, stderr } = await markspecInDir(
      join(run.dir, "outside"),
      ["check", join(run.dir, "proj", "docs", "req.md")],
    );
    assertEquals(stderr.includes("MSL-R010"), false, stderr);
    assertEquals(code, 0, stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("check <files>: files from two projects use their own profiles (#845)", async () => {
  const { code, stdout, stderr } = await markspec(
    ["check", "--format", "json", "a/req.md", "a/cross.md", "b/req.md"],
    {
      files: {
        "a/.markspec.yaml": "profiles:\n  - ./prof\n",
        "a/prof/markspec.yaml": profileDeclaring("pa", "Alpha"),
        "a/req.md": entryUsing("STK_0001", "Alpha: alpha value"),
        // `Beta` is declared only by project b's profile.
        "a/cross.md": entryUsing("STK_0002", "Beta: beta value", "G"),
        "b/.markspec.yaml": "profiles:\n  - ./prof\n",
        "b/prof/markspec.yaml": profileDeclaring("pb", "Beta"),
        // Same display ID and same Id as a/req.md: not a duplicate, the
        // two entries live in different projects.
        "b/req.md": entryUsing("STK_0001", "Beta: beta value"),
      },
    },
  );
  const diagnostics = JSON.parse(stdout) as Array<{
    code: string;
    location?: { file: string };
  }>;
  const codes = diagnostics.map((d) => d.code);
  for (const dup of DUPLICATE_CODES) {
    assertEquals(codes.includes(dup), false, `unexpected ${dup}: ${stdout}`);
  }
  const r010 = diagnostics.filter((d) => d.code === "MSL-R010");
  assertEquals(r010.length, 1, `expected one MSL-R010: ${stdout}`);
  assertEquals(r010[0].location?.file, "a/cross.md");
  // MSL-R010 is a warning: a warning-only run exits 2.
  assertEquals(code, 2, stderr);
});

Deno.test("check: bare invocation in a .markspec.yaml-only project checks the whole project (#845)", async () => {
  const run = await markspecPersist(["check"], {
    files: MARKSPEC_ONLY_PROJECT,
    cwd: "proj",
  });
  try {
    assertStringIncludes(run.stderr, "checking 1 file(s) under");
    assertStringIncludes(run.stderr, join(basename(run.dir), "proj"));
    assertEquals(run.stderr.includes("no project root found"), false);
    assertEquals(run.code, 0, run.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("check: bare invocation outside any project names both root markers (#845)", async () => {
  const { code, stderr } = await markspec(["check"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no project root found");
  assertStringIncludes(stderr, "a project.yaml or .markspec.yaml");
});

Deno.test("lint <file>: .markspec.yaml-only project resolves the project from the file (#845)", async () => {
  const { code, stderr } = await markspec(["lint", "docs/req.md"], {
    files: MARKSPEC_ONLY_PROJECT,
    cwd: "proj",
  });
  assertEquals(stderr.includes("no project.yaml found"), false, stderr);
  // `Priority` is declared only by the project's profile: without the
  // profile, compiling the file reports it as an unknown attribute.
  assertEquals(stderr.includes("MSL-R010"), false, stderr);
  assertEquals(code, 0, stderr);
});

Deno.test("lint <file>: the project's profile brings a profile-typed entry into prose analysis (#845)", async () => {
  const { stdout, stderr } = await markspec(
    ["lint", "--format", "json", "docs/req.md"],
    {
      files: {
        ...MARKSPEC_ONLY_PROJECT,
        "proj/docs/req.md": lintyEntry("STK_0001", "Priority: high"),
      },
      cwd: "proj",
    },
  );
  const report = JSON.parse(stdout) as {
    diagnostics: Array<{ code: string }>;
  };
  // Without a profile, `STK_0001` has no type and is not prose-linted.
  assertEquals(
    report.diagnostics.some((d) => d.code.startsWith("MSL-Q")),
    true,
    `expected MSL-Q findings: ${stdout}\n${stderr}`,
  );
});

Deno.test("fmt <file>: .markspec.yaml-only project loads its profile (#845)", async () => {
  // The profile delivers a document (ADR-030). `fmt` refuses to write a
  // delivered document (#700), which it can know only after it loaded the
  // profile of the file's project.
  const { code, stderr } = await markspec(
    ["fmt", "prof/reference/platform.md"],
    {
      files: {
        ".markspec.yaml": "profiles:\n  - ./prof\nexclude:\n  - prof/\n",
        "prof/markspec.yaml": `${profileDeclaring("prof", "Priority")}` +
          `  delivers:\n    - path: reference/platform.md\n      corpus: true\n`,
        "prof/reference/platform.md": entryUsing("STK_0009", "Priority: low"),
      },
    },
  );
  assertEquals(code, 1, stderr);
  assertStringIncludes(stderr, "read-only");
});

/** A delivered document whose trailer `fmt` would re-indent (4 spaces
 * instead of 6), so a write would change the file. */
const UNFORMATTED_DELIVERED = `# Platform

- [STK_0009] A platform requirement

  The platform shall respond within 200 ms.

    Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
`;

/** A profile that declares `Priority` and delivers `reference/platform.md`
 * as a corpus document. */
const DELIVERING_PROFILE = `${profileDeclaring("prof", "Priority")}` +
  `  delivers:\n    - path: reference/platform.md\n      corpus: true\n`;

Deno.test("fmt <file>: refuses a delivered document of the current project's profile stored outside the project (#700, #845)", async () => {
  const run = await markspecPersist(["fmt", "../prof/reference/platform.md"], {
    files: {
      "a/.markspec.yaml": "profiles:\n  - ../prof\n",
      "a/req.md": entryUsing("STK_0001", "Priority: high"),
      "prof/markspec.yaml": DELIVERING_PROFILE,
      "prof/reference/platform.md": UNFORMATTED_DELIVERED,
    },
    cwd: "a",
  });
  try {
    assertEquals(run.code, 1, run.stderr);
    assertStringIncludes(run.stderr, "read-only");
    assertEquals(
      await Deno.readTextFile(join(run.dir, "prof/reference/platform.md")),
      UNFORMATTED_DELIVERED,
    );
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("fmt <file>: refuses a delivered document when run from outside its project (#700, #845)", async () => {
  const run = await markspecPersist(["--version"], {
    files: {
      "proj/.markspec.yaml": "profiles:\n  - ./prof\nexclude:\n  - prof/\n",
      "proj/prof/markspec.yaml": DELIVERING_PROFILE,
      "proj/prof/reference/platform.md": UNFORMATTED_DELIVERED,
      "outside/.keep": "",
    },
  });
  try {
    const target = join(run.dir, "proj", "prof", "reference", "platform.md");
    const { code, stderr } = await markspecInDir(
      join(run.dir, "outside"),
      ["fmt", target],
    );
    assertEquals(code, 1, stderr);
    assertStringIncludes(stderr, "read-only");
    assertEquals(await Deno.readTextFile(target), UNFORMATTED_DELIVERED);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

/** A parent project (profile declares `Alpha`) with a nested folder
 * `vendor/` that holds its own `.markspec.yaml` (profile declares `Beta`).
 * `hide` lists the parent's way to hide `vendor/`: a `.markspec.yaml`
 * `exclude:` entry or a `.gitignore` entry. */
type HideMode = "exclude" | "gitignore" | "hidden";

/** The nested folder for each way the parent can hide it. */
function hiddenDir(hide: HideMode): string {
  return hide === "hidden" ? ".vendor" : "vendor";
}

function parentWithHiddenNested(hide: HideMode): Record<string, string> {
  const dir = hiddenDir(hide);
  const files: Record<string, string> = {
    "p/.markspec.yaml": hide === "exclude"
      ? "profiles:\n  - ./prof\nexclude:\n  - prof/\n  - vendor/\n"
      : "profiles:\n  - ./prof\nexclude:\n  - prof/\n",
    "p/prof/markspec.yaml": profileDeclaring("pa", "Alpha"),
    [`p/${dir}/.markspec.yaml`]: "profiles:\n  - ./prof\n",
    [`p/${dir}/prof/markspec.yaml`]: profileDeclaring("pv", "Beta"),
    // `Alpha` is declared only by the parent's profile.
    [`p/${dir}/req.md`]: entryUsing("STK_0001", "Alpha: alpha value"),
  };
  if (hide === "gitignore") files["p/.gitignore"] = "vendor/\n";
  return files;
}

const HIDE_MODES = ["exclude", "gitignore", "hidden"] as const;

for (const hide of HIDE_MODES) {
  Deno.test(`check <file>: a config in a folder the parent hides (${hide}) is not a project root, as in the LSP (#845)`, async () => {
    const { code, stderr } = await markspec([
      "check",
      `p/${hiddenDir(hide)}/req.md`,
    ], {
      files: parentWithHiddenNested(hide),
    });
    assertEquals(stderr.includes("MSL-R010"), false, stderr);
    assertEquals(code, 0, stderr);
  });
}

/** A parent project (profile declares `Alpha`) and a nested project `sub/`
 * (profile declares `Beta`). Each holds an entry `STK_0001` with the same
 * Id. */
const PARENT_AND_NESTED: Record<string, string> = {
  "p/.markspec.yaml": "profiles:\n  - ./prof\nexclude:\n  - prof/\n",
  "p/prof/markspec.yaml": profileDeclaring("pa", "Alpha"),
  "p/req.md": entryUsing("STK_0001", "Alpha: alpha value"),
  "p/sub/.markspec.yaml": "profiles:\n  - ./prof\nexclude:\n  - prof/\n",
  "p/sub/prof/markspec.yaml": profileDeclaring("ps", "Beta"),
  "p/sub/req.md": entryUsing("STK_0001", "Beta: beta value"),
};

Deno.test("check: bare invocation checks each nested project with its own profile (#845)", async () => {
  const run = await markspecPersist(["check", "--strict"], {
    files: PARENT_AND_NESTED,
    cwd: "p",
  });
  try {
    for (const code of ["MSL-R010", ...DUPLICATE_CODES]) {
      assertEquals(run.stderr.includes(code), false, run.stderr);
    }
    assertStringIncludes(run.stderr, "checking 2 file(s) under");
    assertStringIncludes(run.stderr, "(2 projects)");
    assertEquals(run.code, 0, run.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

/** {@linkcode PARENT_AND_NESTED} plus a nested-project file that uses the
 * parent-only attribute `Alpha`, so the nested profile reports MSL-R010
 * for it. */
const PARENT_AND_NESTED_WITH_WARNING: Record<string, string> = {
  ...PARENT_AND_NESTED,
  "p/sub/extra.md": entryUsing("STK_0002", "Alpha: alpha value", "G"),
};

Deno.test("check <dir>: a directory argument at a parent root includes nested projects, like a bare invocation (#845)", async () => {
  const bare = await markspec(["check"], {
    files: PARENT_AND_NESTED_WITH_WARNING,
    cwd: "p",
  });
  const dirArg = await markspec(["check", "."], {
    files: PARENT_AND_NESTED_WITH_WARNING,
    cwd: "p",
  });
  for (const run of [bare, dirArg]) {
    assertStringIncludes(run.stderr, "MSL-R010", run.stderr);
    assertStringIncludes(run.stderr, "extra.md", run.stderr);
    for (const dup of DUPLICATE_CODES) {
      assertEquals(run.stderr.includes(dup), false, run.stderr);
    }
  }
  assertEquals(
    (dirArg.stderr.match(/MSL-R010/g) ?? []).length,
    (bare.stderr.match(/MSL-R010/g) ?? []).length,
    dirArg.stderr,
  );
  assertEquals(dirArg.code, bare.code, dirArg.stderr);
});

for (const hide of HIDE_MODES) {
  Deno.test(`check: bare invocation inside a folder the parent hides (${hide}) uses the parent project, as in the LSP (#845)`, async () => {
    const dir = hiddenDir(hide);
    const run = await markspecPersist(["check"], {
      files: {
        ...parentWithHiddenNested(hide),
        [`p/${dir}/docs/.keep`]: "",
        // `Beta` is declared only by the hidden folder's profile, so the
        // parent's profile reports it: this proves the parent's files were
        // checked with the parent's profile.
        "p/req.md": entryUsing("STK_0002", "Beta: beta value"),
      },
      cwd: `p/${dir}/docs`,
    });
    try {
      const header = /under (\S+)/.exec(run.stderr);
      assertEquals(header !== null, true, run.stderr);
      assertEquals(basename(header![1]), "p", run.stderr);
      assertStringIncludes(run.stderr, "unknown attribute 'Beta'");
      assertEquals(run.stderr.includes("'Alpha'"), false, run.stderr);
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  });
}

Deno.test("check <dir>: a directory argument honors the project's exclude: list, like a bare invocation (#845)", async () => {
  const { code, stderr } = await markspec(["check", "."], {
    files: {
      ...MARKSPEC_ONLY_PROJECT,
      "proj/.markspec.yaml":
        "profiles:\n  - ./prof\nexclude:\n  - prof/\n  - /skip/\n",
      // Excluded: would duplicate the display ID of docs/req.md.
      "proj/skip/dup.md": entryUsing("STK_0001", "Priority: low", "G"),
    },
    cwd: "proj",
  });
  for (const dup of DUPLICATE_CODES) {
    assertEquals(stderr.includes(dup), false, stderr);
  }
  assertEquals(code, 0, stderr);
});

Deno.test("check <files>: files of one project in two folders are checked together (#845)", async () => {
  const { stderr } = await markspec(["check", "a/one.md", "b/two.md"], {
    files: {
      ".markspec.yaml": "profiles:\n  - ./prof\nexclude:\n  - prof/\n",
      "prof/markspec.yaml": profileDeclaring("prof", "Priority"),
      "a/one.md": entryUsing("STK_0001", "Priority: high"),
      "b/two.md": entryUsing("STK_0001", "Priority: low", "G"),
    },
  });
  assertEquals(
    DUPLICATE_CODES.some((dup) => stderr.includes(dup)),
    true,
    `expected a duplicate display-ID diagnostic: ${stderr}`,
  );
});

Deno.test("lint <files>: files from two projects give one report (#845)", async () => {
  const { stdout, stderr } = await markspec(
    ["lint", "--format", "json", "a/req.md", "b/req.md"],
    {
      files: {
        "a/.markspec.yaml": "profiles:\n  - ./prof\nexclude:\n  - prof/\n",
        "a/prof/markspec.yaml": profileDeclaring("pa", "Alpha"),
        "a/req.md": lintyEntry("STK_0001", "Alpha: alpha value"),
        "b/.markspec.yaml": "profiles:\n  - ./prof\nexclude:\n  - prof/\n",
        "b/prof/markspec.yaml": profileDeclaring("pb", "Beta"),
        "b/req.md": lintyEntry("STK_0001", "Beta: beta value"),
      },
    },
  );
  const report = JSON.parse(stdout) as {
    diagnostics: Array<{ location?: { file: string } }>;
    score: { rollup: { bandCounts: Record<string, number> } };
  };
  const files = new Set(report.diagnostics.map((d) => d.location?.file));
  assertEquals(files.has("a/req.md"), true, stdout);
  assertEquals(files.has("b/req.md"), true, stdout);
  const scored = Object.values(report.score.rollup.bandCounts)
    .reduce((sum, n) => sum + n, 0);
  assertEquals(scored, 2, stdout);
  assertEquals(stderr.includes("MSL-R010"), false, stderr);
});

Deno.test("check <files>: groups are reported in the order their first file was named (#845)", async () => {
  const { stdout } = await markspec(
    ["check", "--format", "json", "b/req.md", "a/req.md"],
    {
      files: {
        "a/.markspec.yaml": "profiles: []\n",
        "a/req.md": entryUsing("STK_0001", "Alpha: alpha value"),
        "b/.markspec.yaml": "profiles: []\n",
        "b/req.md": entryUsing("STK_0001", "Beta: beta value"),
      },
    },
  );
  const files = (JSON.parse(stdout) as Array<{ location?: { file: string } }>)
    .map((d) => d.location?.file)
    .filter((f) => f !== undefined);
  assertEquals(files[0], "b/req.md", stdout);
  assertEquals(files.includes("a/req.md"), true, stdout);
});

/** A figure caption placed below its image. */
const CAPTION_BELOW = `# Requirements

- [REQ-001] System diagram requirement

  See the brake diagram below.

  ![Brake diagram](brake.svg)

  Figure: Brake pressure schematic

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

Deno.test("check <files>: each project uses its own .markspec.yaml caption conventions (#845)", async () => {
  const { stdout } = await markspec(
    ["check", "--format", "json", "a/req.md", "b/req.md"],
    {
      files: {
        "a/.markspec.yaml": "caption-conventions:\n  Figure: above\n",
        "a/req.md": CAPTION_BELOW,
        "b/.markspec.yaml": "caption-conventions:\n  Figure: below\n",
        "b/req.md": CAPTION_BELOW,
      },
    },
  );
  const c072 = (JSON.parse(stdout) as Array<
    { code: string; location?: { file: string } }
  >).filter((d) => d.code === "MSL-C072");
  assertEquals(c072.map((d) => d.location?.file), ["a/req.md"]);
});

for (const verb of ["check", "lint"]) {
  Deno.test(`${verb} <empty dir>: uses the directory's project, not the current one (#845)`, async () => {
    const { code, stderr } = await markspec([verb, "../b/empty"], {
      files: {
        // The current project's profile cannot be loaded.
        "a/.markspec.yaml": "profiles:\n  - ./missing\n",
        "b/.markspec.yaml": "profiles: []\n",
        "b/empty/.keep": "",
      },
      cwd: "a",
    });
    assertEquals(code, 0, stderr);
  });
}

Deno.test("check: bare invocation with a nested project matches the markspec.lock of the parent (#845)", async () => {
  const files = {
    ...PARENT_AND_NESTED,
    // `lock` needs a project.yaml; the nested project needs one too, or
    // the parent's project.yaml would win over its .markspec.yaml.
    "p/project.yaml": "name: parent\nversion: 0.1.0\n",
    "p/sub/project.yaml": "name: nested\nversion: 0.1.0\n",
    // Each entry links to the other, so `lock` pins one edge from each
    // project's files.
    "p/req.md": entryUsing("STK_0002", "Satisfies: STK_0001", "G"),
    "p/sub/req.md": entryUsing("STK_0001", "Satisfies: STK_0002"),
  };
  const run = await markspecPersist(["lock"], { files, cwd: "p" });
  try {
    assertEquals(run.code, 0, run.stderr);
    const { stderr } = await markspecInDir(join(run.dir, "p"), ["check"]);
    assertEquals(stderr.includes("MSL-L212"), false, stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("fmt: bare invocation skips files the repository .gitignore ignores inside a nested project", async () => {
  const generated =
    "# Gen\n\n- [STK_0009] Generated\n\n  The system shall do X.\n";
  const run = await markspecPersist(["fmt"], {
    files: {
      ".git/HEAD": "ref: refs/heads/main\n",
      ".gitignore": "gen/\n",
      "project.yaml": "name: root\nversion: 0.1.0\n",
      "sub/project.yaml": "name: nested\nversion: 0.1.0\n",
      "sub/gen/out.md": generated,
      "sub/ok.md": entryUsing("STK_0001", "Labels: a"),
    },
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    assertEquals(
      await Deno.readTextFile(join(run.dir, "sub", "gen", "out.md")),
      generated,
    );
    assertStringIncludes(run.stderr, "formatting 1 file(s)");
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
