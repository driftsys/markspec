/**
 * @module tests/e2e/lock_project_root_test
 *
 * `markspec lock` and `markspec sync` find the project root like `check`,
 * `fmt` and `lint` (#860): the nearest `project.yaml`, else the nearest
 * `.markspec.yaml`. Each `markspec.lock` pins only the files of its own
 * project, walked the way a bare `check` walks it, so `lock`, `check`
 * (MSL-L212) and `doctor` agree from any folder.
 *
 * Blackbox: the CLI runs as a subprocess; nothing is imported from source.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

/** One entry block. The ULIDs follow the fixed fixtures of the other e2e
 * tests; `trailer` is an optional extra trailer line. */
function entry(displayId: string, idSuffix: string, trailer = ""): string {
  const extra = trailer === "" ? "" : `\n      ${trailer}`;
  return `# Requirements

- [${displayId}] A requirement

  The system shall respond within 200 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDE${idSuffix}${extra}
`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("lock: from a subfolder of a .markspec.yaml-only project writes the lockfile at the project root (#860)", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      "proj/.markspec.yaml": "profiles: []\n",
      "proj/docs/a.md": entry("STK_0001", "A"),
      "proj/docs/b.md": entry("STK_0002", "B", "Satisfies: STK_0001"),
    },
    cwd: "proj/docs",
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    assertEquals(await exists(join(run.dir, "proj", "markspec.lock")), true);
    assertEquals(
      await exists(join(run.dir, "proj", "docs", "markspec.lock")),
      false,
    );
    const check = await markspecInDir(join(run.dir, "proj"), ["check"]);
    assertEquals(check.stderr.includes("MSL-L212"), false, check.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("lock: a project.yaml in a folder the parent excludes is not a root (#860)", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      "p/project.yaml": "name: parent\nversion: 0.1.0\n",
      "p/.markspec.yaml": "profiles: []\nexclude:\n  - vendor/\n",
      "p/req.md": entry("STK_0001", "A"),
      // The parent hides this config, so the LSP, MCP and check give the
      // parent as the root of `p/vendor/`; lock must too.
      "p/vendor/project.yaml": "name: vendored\nversion: 0.1.0\n",
      "p/vendor/req.md": entry("STK_0002", "B", "Satisfies: STK_0001"),
    },
    cwd: "p/vendor",
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    assertEquals(await exists(join(run.dir, "p", "markspec.lock")), true);
    assertEquals(
      await exists(join(run.dir, "p", "vendor", "markspec.lock")),
      false,
    );
    // compile --frozen and doctor, run from `vendor/`, read the lockfile
    // where lock wrote it and compare the parent's files, which leave out
    // `vendor/` and its edge.
    const vendor = join(run.dir, "p", "vendor");
    const frozen = await markspecInDir(vendor, [
      "compile",
      "--frozen",
      "req.md",
    ]);
    assertEquals(frozen.code, 0, frozen.stderr);
    const doctor = await markspecInDir(vendor, ["doctor", "--format", "json"]);
    const report = JSON.parse(doctor.stdout) as {
      lockfile: { present: boolean; edgeDrift?: boolean };
    };
    assertEquals(report.lockfile.present, true, doctor.stdout);
    assertEquals(report.lockfile.edgeDrift, false, doctor.stdout);
    // `vendor/` is excluded from the parent's walk, so its edge is not
    // pinned: changing it leaves the lockfile in sync.
    await Deno.writeTextFile(
      join(run.dir, "p", "vendor", "req.md"),
      entry("STK_0002", "B"),
    );
    const lockCheck = await markspecInDir(join(run.dir, "p"), [
      "lock",
      "--check",
    ]);
    assertEquals(lockCheck.code, 0, lockCheck.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("lock: a lockfile does not pin the edges of a nested project (#860)", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      "p/project.yaml": "name: parent\nversion: 0.1.0\n",
      "p/req.md": entry("STK_0001", "A"),
      "p/sub/project.yaml": "name: nested\nversion: 0.1.0\n",
      "p/sub/a.md": entry("STK_0002", "B", "Satisfies: STK_0003"),
      "p/sub/b.md": entry("STK_0003", "C"),
      "p/sub/c.md": entry("STK_0004", "D"),
    },
    cwd: "p",
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    // Change an edge inside the nested project only.
    await Deno.writeTextFile(
      join(run.dir, "p", "sub", "a.md"),
      entry("STK_0002", "B", "Satisfies: STK_0004"),
    );
    const p = join(run.dir, "p");
    const lockCheck = await markspecInDir(p, ["lock", "--check"]);
    assertEquals(lockCheck.code, 0, lockCheck.stderr);
    const check = await markspecInDir(p, ["check"]);
    assertEquals(check.stderr.includes("MSL-L212"), false, check.stderr);
    const doctor = await markspecInDir(p, ["doctor", "--format", "json"]);
    const report = JSON.parse(doctor.stdout) as {
      lockfile: { present: boolean; edgeDrift?: boolean };
    };
    assertEquals(report.lockfile.present, true, doctor.stdout);
    assertEquals(report.lockfile.edgeDrift, false, doctor.stdout);
    const frozen = await markspecInDir(p, ["compile", "--frozen", "req.md"]);
    assertEquals(frozen.code, 0, frozen.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("lock in a nested project and check agree on files the enclosing .gitignore ignores (#860)", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      "p/project.yaml": "name: parent\nversion: 0.1.0\n",
      "p/.gitignore": "gen/\n",
      "p/sub/project.yaml": "name: nested\nversion: 0.1.0\n",
      "p/sub/a.md": entry("STK_0002", "B"),
      // Ignored by the parent's `.gitignore`; carries an edge that would
      // be pinned if the walk did not apply that `.gitignore`.
      "p/sub/gen/x.md": entry("STK_0009", "C", "Satisfies: STK_0002"),
    },
    cwd: "p/sub",
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    assertEquals(
      await exists(join(run.dir, "p", "sub", "markspec.lock")),
      true,
    );
    assertEquals(await exists(join(run.dir, "p", "markspec.lock")), false);
    for (const cwd of ["p", "p/sub"]) {
      const check = await markspecInDir(join(run.dir, ...cwd.split("/")), [
        "check",
      ]);
      assertEquals(
        check.stderr.includes("MSL-L212"),
        false,
        `check from ${cwd}: ${check.stderr}`,
      );
    }
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("sync log: from a subfolder of a .markspec.yaml-only project reads the project's log (#860)", async () => {
  const line = JSON.stringify({
    ts: "2026-11-01T10:00:00Z",
    op: "push",
    entryId: "01HGW2Q8MNP3RSTVWXYZABCDEA",
    displayId: "STK_0001",
    externalId: "JIRA-1",
    direction: "outbound",
    attrsChanged: ["title"],
    remoteStateBefore: "ahead",
    remoteStateAfter: "ok",
    actor: "test",
  });
  const run = await markspecPersist(
    ["sync", "log", "jira", "--format", "json"],
    {
      files: {
        "proj/.markspec.yaml": "profiles: []\n",
        "proj/docs/a.md": entry("STK_0001", "A"),
        "proj/.markspec/sync/jira/log.ndjson": `${line}\n`,
      },
      cwd: "proj/docs",
    },
  );
  try {
    assertEquals(run.code, 0, run.stderr);
    const out = JSON.parse(run.stdout) as { entries: unknown[] };
    assertEquals(out.entries.length, 1, run.stdout);
    assertStringIncludes(run.stdout, "JIRA-1");
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("lock in a nested project uses the nested roots the outermost project sees (#860)", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      "p/project.yaml": "name: parent\nversion: 0.1.0\n",
      // The parent hides `sub/vendor/`'s config, so `sub/vendor/` belongs
      // to `sub`, whatever `sub`'s own exclude: list says.
      "p/.markspec.yaml": "profiles: []\nexclude:\n  - sub/vendor/\n",
      "p/sub/project.yaml": "name: nested\nversion: 0.1.0\n",
      "p/sub/a.md": entry("STK_0002", "B"),
      "p/sub/vendor/project.yaml": "name: vendored\nversion: 0.1.0\n",
      "p/sub/vendor/x.md": entry("STK_0003", "C", "Satisfies: STK_0002"),
    },
    cwd: "p/sub",
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    for (const cwd of ["p", "p/sub"]) {
      const check = await markspecInDir(join(run.dir, ...cwd.split("/")), [
        "check",
      ]);
      assertEquals(
        check.stderr.includes("MSL-L212"),
        false,
        `check from ${cwd}: ${check.stderr}`,
      );
    }
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("fmt: the reference index of a project leaves out nested projects (#860)", async () => {
  // `Satisfies:` names the nested entry by its ULID. fmt rewrites a ULID to
  // the display ID only for entries of the same project.
  const parent = entry(
    "STK_0001",
    "A",
    "Satisfies: 01HGW2Q8MNP3RSTVWXYZABCDEB",
  );
  const run = await markspecPersist(["fmt", "req.md"], {
    files: {
      "project.yaml": "name: parent\nversion: 0.1.0\n",
      "req.md": parent,
      "sub/project.yaml": "name: nested\nversion: 0.1.0\n",
      "sub/a.md": entry("STK_0002", "B"),
    },
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    assertEquals(await Deno.readTextFile(join(run.dir, "req.md")), parent);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

for (
  const args of [["lock"], ["sync", "status"], ["sync", "log"], [
    "sync",
    "show",
    "STK_0001",
  ]]
) {
  Deno.test(`${args.join(" ")}: outside any project exits 1 (#860)`, async () => {
    const run = await markspecPersist(args, { files: { "notes/a.md": "x\n" } });
    try {
      assertEquals(run.code, 1, run.stderr);
      assertStringIncludes(run.stderr, "no project root found");
      assertStringIncludes(run.stderr, "searched from");
      assertStringIncludes(run.stderr, "run 'markspec init' to create one\n");
      assertEquals(await exists(join(run.dir, "markspec.lock")), false);
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  });
}

Deno.test("check: bare invocation inside a nested project leaves out the parent project (#860)", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      "p/project.yaml": "name: parent\nversion: 0.1.0\n",
      "p/req.md": entry("STK_0001", "A"),
      "p/sub/project.yaml": "name: nested\nversion: 0.1.0\n",
      "p/sub/a.md": entry("STK_0002", "B"),
    },
    cwd: "p/sub",
  });
  try {
    const check = await markspecInDir(join(run.dir, "p", "sub"), ["check"]);
    assertStringIncludes(check.stderr, "checking 1 file(s) under");
    assertEquals(check.stderr.includes("projects)"), false, check.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("lock: a malformed .markspec.yaml exclude: list stops lock (#860)", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      "project.yaml": "name: t\nversion: 0.1.0\n",
      ".markspec.yaml": "exclude: 5\n",
      "req.md": entry("STK_0001", "A"),
    },
  });
  try {
    assertEquals(run.code, 1, run.stderr);
    assertStringIncludes(run.stderr, "exclude");
    assertEquals(await exists(join(run.dir, "markspec.lock")), false);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
