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
import { setupGitFixture } from "./helpers_git.ts";

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

/** Snapshot every directory and file, including hidden paths and file bytes. */
async function snapshotTree(
  root: string,
): Promise<Record<string, Uint8Array | null>> {
  const tree: Record<string, Uint8Array | null> = {};
  async function visit(relative: string): Promise<void> {
    for await (const item of Deno.readDir(join(root, relative))) {
      const path = join(relative, item.name);
      if (item.isDirectory) {
        tree[path] = null;
        await visit(path);
      } else {
        tree[path] = await Deno.readFile(join(root, path));
      }
    }
  }
  await visit("");
  return tree;
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

/** A valid sync mapping for the `jira` system; `external` names the
 * external field bound to the `Title` attribute. */
function jiraMapping(external: string): string {
  return `schema: 1
system: jira
direction: bidirectional
identity:
  external-id-scheme: jira
attributes:
  - markspec: Title
    external: ${external}
cache:
  ttl: 15m
`;
}

for (const failure of ["parse", "validation"]) {
  Deno.test(`lock: ${failure} error leaves the whole project unchanged with a cold Git profile (#873)`, async () => {
    const fixtureDir = await Deno.makeTempDir();
    try {
      const fixture = await setupGitFixture({
        workspaceDir: fixtureDir,
        name: "profile",
        files: {
          "markspec.yaml":
            'id: "@test/lock-profile"\nversion: 1.0.0\nprofile:\n  types: {}\n',
        },
        tag: "v1.0.0",
      });
      const run = await markspecPersist(["--version"], {
        "project.yaml": "name: t\nversion: 0.1.0\n",
        ".markspec.yaml":
          `profiles:\n  - "git+${fixture.url}#${fixture.tag}"\n`,
        ".gitignore": "build/\n",
        ".markspec/sync/jira.yaml": jiraMapping("summary"),
        ".markspec/sync/doors.yaml": failure === "parse"
          ? "schema: [\n"
          : jiraMapping("summary").replaceAll("jira", "doors"),
        "req.md": "# Requirements\n",
      });
      try {
        assertEquals(run.code, 0, run.stderr);
        const cache = join(run.dir, ".markspec/cache");
        assertEquals(await exists(cache), false);
        const before = await snapshotTree(run.dir);
        const permissions = ["--allow-run=git", "--allow-env"];
        for (const args of [["lock"], ["lock", "--check"]]) {
          const result = await markspecInDir(run.dir, args, permissions);
          assertEquals(result.code, 1, result.stderr);
          assertStringIncludes(
            result.stderr,
            failure === "parse" ? "MSL-S001" : "MSL-S020",
          );
          assertEquals(result.stdout, "");
          const after = await snapshotTree(run.dir);
          assertEquals(
            Object.keys(after).sort(),
            Object.keys(before).sort(),
            args.join(" "),
          );
          for (const path of Object.keys(before)) {
            assertEquals(
              after[path],
              before[path],
              `${args.join(" ")}: ${path}`,
            );
          }
        }
        // Control: the same cold profile can be acquired offline and writes
        // both its cache and the existing .gitignore once the mapping is valid.
        await Deno.remove(join(run.dir, ".markspec/sync/doors.yaml"));
        const valid = await markspecInDir(run.dir, ["lock"], permissions);
        assertEquals(valid.code, 0, valid.stderr);
        assertEquals(await exists(cache), true);
        assertStringIncludes(
          await Deno.readTextFile(join(run.dir, ".gitignore")),
          ".markspec/cache/",
        );
        const cached = await snapshotTree(cache);
        assertEquals(
          Object.keys(cached).some((path) => path.endsWith("markspec.yaml")),
          true,
        );
      } finally {
        await Deno.remove(run.dir, { recursive: true });
      }
    } finally {
      await Deno.remove(fixtureDir, { recursive: true });
    }
  });
}

Deno.test("lock: a nested project uses the sync mappings of the enclosing project (#860)", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      "p/project.yaml": "name: parent\nversion: 0.1.0\n",
      "p/.markspec/sync/jira.yaml": jiraMapping("summary"),
      "p/sub/project.yaml": "name: nested\nversion: 0.1.0\n",
      "p/sub/a.md": entry("STK_0002", "B", "External-id: jira:ABC-1"),
    },
    cwd: "p/sub",
  });
  try {
    assertEquals(run.stderr.includes("MSL-S021"), false, run.stderr);
    assertEquals(run.code, 0, run.stderr);
    const lockPath = join(run.dir, "p", "sub", "markspec.lock");
    assertEquals(await exists(lockPath), true);
    assertStringIncludes(await Deno.readTextFile(lockPath), "ABC-1");
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("lock: a nested project's own sync mapping replaces the enclosing one for the same system (#860)", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      "p/project.yaml": "name: parent\nversion: 0.1.0\n",
      "p/.markspec/sync/jira.yaml": jiraMapping("summary"),
      "p/sub/project.yaml": "name: nested\nversion: 0.1.0\n",
      "p/sub/.markspec/sync/jira.yaml": jiraMapping("title"),
      "p/sub/a.md": entry("STK_0002", "B", "External-id: jira:ABC-1"),
    },
    cwd: "p/sub",
  });
  try {
    assertEquals(run.stderr.includes("MSL-S020"), false, run.stderr);
    assertEquals(run.stderr.includes("MSL-S021"), false, run.stderr);
    assertEquals(run.code, 0, run.stderr);
    assertEquals(
      await exists(join(run.dir, "p", "sub", "markspec.lock")),
      true,
    );
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("lock: two mappings for one system in the same folder still conflict (#860)", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      "project.yaml": "name: t\nversion: 0.1.0\n",
      ".markspec/sync/jira.yaml": jiraMapping("summary"),
      ".markspec/sync/jira-copy.yaml": jiraMapping("summary"),
      "req.md": entry("STK_0001", "A"),
    },
  });
  try {
    assertEquals(run.code, 1, run.stderr);
    assertStringIncludes(run.stderr, "MSL-S020");
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

for (
  const folder of ["p", "p/group", "p/group/middle", "p/group/middle/deep"]
) {
  for (const existing of [false, true]) {
    Deno.test(`lock: malformed mapping at ${folder} ${existing ? "preserves the existing" : "does not write a"} nested lockfile (#873)`, async () => {
      const run = await markspecPersist(["lock"], {
        files: {
          "p/project.yaml": "name: top\nversion: 0.1.0\n",
          "p/.markspec/sync/jira.yaml": jiraMapping("summary"),
          "p/group/middle/project.yaml": "name: middle\nversion: 0.1.0\n",
          "p/group/middle/deep/project.yaml": "name: deep\nversion: 0.1.0\n",
          "p/group/middle/deep/.markspec/sync/jira.yaml": jiraMapping("title"),
          "p/group/middle/deep/a.md": entry(
            "STK_0001",
            "A",
            "External-id: jira:ABC-1",
          ),
        },
        cwd: "p/group/middle/deep",
      });
      try {
        assertEquals(run.code, 0, run.stderr);
        const root = join(run.dir, "p/group/middle/deep");
        const lockPath = join(root, "markspec.lock");
        const original = await Deno.readTextFile(lockPath);
        if (!existing) await Deno.remove(lockPath);
        const syncDir = join(run.dir, folder, ".markspec", "sync");
        await Deno.mkdir(syncDir, { recursive: true });
        await Deno.writeTextFile(join(syncDir, "jira.yaml"), "schema: [\n");
        for (const args of [["lock"], ["lock", "--check"]]) {
          const result = await markspecInDir(root, args);
          assertEquals(result.code, 1, result.stderr);
          assertStringIncludes(result.stderr, "error: MSL-S001");
          assertEquals(result.stdout, "");
          assertEquals(await exists(lockPath), existing);
          if (existing) {
            assertEquals(await Deno.readTextFile(lockPath), original);
          }
        }
      } finally {
        await Deno.remove(run.dir, { recursive: true });
      }
    });
  }
}

Deno.test("lock: three project levels inherit from the top and the deepest mapping wins (#873)", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      "p/project.yaml": "name: top\nversion: 0.1.0\n",
      "p/.markspec/sync/jira.yaml": jiraMapping("summary").replace(
        "bidirectional",
        "outbound",
      ),
      "p/middle/project.yaml": "name: middle\nversion: 0.1.0\n",
      "p/middle/a.md": entry("STK_0001", "A", "External-id: jira:MIDDLE-1"),
      "p/middle/deep/project.yaml": "name: deep\nversion: 0.1.0\n",
      "p/middle/deep/.markspec/sync/jira.yaml": jiraMapping("title").replace(
        "bidirectional",
        "inbound",
      ),
      "p/middle/deep/a.md": entry("STK_0002", "B", "External-id: jira:DEEP-1"),
    },
    cwd: "p/middle",
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    const middleLock = await Deno.readTextFile(
      join(run.dir, "p/middle/markspec.lock"),
    );
    assertStringIncludes(middleLock, 'direction   = "outbound"');
    assertStringIncludes(middleLock, "MIDDLE-1");
    assertEquals(middleLock.includes("DEEP-1"), false);
    const deep = await markspecInDir(join(run.dir, "p/middle/deep"), ["lock"]);
    assertEquals(deep.code, 0, deep.stderr);
    const deepLock = await Deno.readTextFile(
      join(run.dir, "p/middle/deep/markspec.lock"),
    );
    assertStringIncludes(deepLock, 'direction   = "inbound"');
    assertStringIncludes(deepLock, "DEEP-1");
    assertEquals(deepLock.includes("MIDDLE-1"), false);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("lock: reads a mapping in a non-project intermediate folder (#873)", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      "p/project.yaml": "name: top\nversion: 0.1.0\n",
      "p/.markspec/sync/jira.yaml": jiraMapping("summary").replace(
        "bidirectional",
        "outbound",
      ),
      "p/group/.markspec/sync/jira.yaml": jiraMapping("title").replace(
        "bidirectional",
        "inbound",
      ),
      "p/group/sub/project.yaml": "name: nested\nversion: 0.1.0\n",
      "p/group/sub/a.md": entry("STK_0001", "A", "External-id: jira:ABC-1"),
    },
    cwd: "p/group/sub",
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    const lock = await Deno.readTextFile(
      join(run.dir, "p/group/sub/markspec.lock"),
    );
    assertStringIncludes(lock, 'direction   = "inbound"');
    assertStringIncludes(lock, "ABC-1");
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

for (const folder of ["p", "p/group"]) {
  Deno.test(`sync log: nested project lists inherited systems from ${folder} and reads only its own log (#873)`, async () => {
    const logEntry = {
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
    };
    const line = JSON.stringify(logEntry) + "\n";
    const run = await markspecPersist(["sync", "log", "--format", "json"], {
      files: {
        "p/project.yaml": "name: top\nversion: 0.1.0\n",
        [`${folder}/.markspec/sync/jira.yaml`]: jiraMapping("summary"),
        [`${folder}/.markspec/sync/jira/log.ndjson`]: line.replace(
          "JIRA-1",
          "PARENT-1",
        ),
        "p/group/sub/project.yaml": "name: nested\nversion: 0.1.0\n",
        "p/group/sub/.markspec/sync/jira/log.ndjson": line,
      },
      cwd: "p/group/sub",
    });
    try {
      assertEquals(run.code, 0, run.stderr);
      assertEquals(JSON.parse(run.stdout).entries, [logEntry]);
      // A local override names the same system and must not duplicate its log.
      const localSync = join(run.dir, "p/group/sub/.markspec/sync");
      await Deno.writeTextFile(
        join(localSync, "jira.yaml"),
        jiraMapping("title"),
      );
      const overridden = await markspecInDir(join(run.dir, "p/group/sub"), [
        "sync",
        "log",
        "--format",
        "json",
      ]);
      assertEquals(overridden.code, 0, overridden.stderr);
      assertEquals(JSON.parse(overridden.stdout).entries, [logEntry]);
      await Deno.remove(join(localSync, "jira/log.ndjson"));
      const missing = await markspecInDir(join(run.dir, "p/group/sub"), [
        "sync",
        "log",
        "--format",
        "json",
      ]);
      assertEquals(missing.code, 0, missing.stderr);
      assertEquals(JSON.parse(missing.stdout).entries, []);
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  });
}

Deno.test("sync log: lists the union of parent doors and child jira systems (#873)", async () => {
  const logEntry = {
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
  };
  const doorsEntry = {
    ...logEntry,
    ts: "2026-11-01T09:00:00Z",
    externalId: "DOORS-1",
  };
  const run = await markspecPersist(["sync", "log", "--format", "json"], {
    files: {
      "p/project.yaml": "name: parent\nversion: 0.1.0\n",
      "p/.markspec/sync/doors.yaml": jiraMapping("summary").replaceAll(
        "jira",
        "doors",
      ),
      "p/sub/project.yaml": "name: child\nversion: 0.1.0\n",
      "p/sub/.markspec/sync/jira.yaml": jiraMapping("summary"),
      "p/sub/.markspec/sync/doors/log.ndjson": JSON.stringify(doorsEntry) +
        "\n",
      "p/sub/.markspec/sync/jira/log.ndjson": JSON.stringify(logEntry) + "\n",
    },
    cwd: "p/sub",
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    assertEquals(JSON.parse(run.stdout).entries, [doorsEntry, logEntry]);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

for (const [kind, yaml] of [["empty", ""], ["null", "null\n"]]) {
  Deno.test(`lock: ${kind} nested mapping fails without falling back to the parent (#873)`, async () => {
    const run = await markspecPersist(["lock"], {
      files: {
        "p/project.yaml": "name: top\nversion: 0.1.0\n",
        "p/.markspec/sync/jira.yaml": jiraMapping("summary"),
        "p/sub/project.yaml": "name: nested\nversion: 0.1.0\n",
        "p/sub/.markspec/sync/jira.yaml": yaml,
        "p/sub/a.md": entry("STK_0001", "A", "External-id: jira:ABC-1"),
      },
      cwd: "p/sub",
    });
    try {
      assertEquals(run.code, 1, run.stderr);
      assertStringIncludes(run.stderr, "error: MSL-S001");
      const root = join(run.dir, "p/sub");
      assertEquals(await exists(join(root, "markspec.lock")), false);
      const check = await markspecInDir(root, ["lock", "--check"]);
      assertEquals(check.code, 1, check.stderr);
      assertStringIncludes(check.stderr, "error: MSL-S001");
      assertEquals(await exists(join(root, "markspec.lock")), false);
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  });
}

const runsAsRoot = Deno.build.os !== "windows" &&
  new TextDecoder().decode(
      new Deno.Command("id", { args: ["-u"], stdout: "piped" }).outputSync()
        .stdout,
    ).trim() === "0";

for (const folder of ["p", "p/group", "p/group/sub"]) {
  Deno.test({
    name:
      `lock: an unreadable mapping in ${folder} fails without writes across the inheritance walk (#873)`,
    ignore: Deno.build.os === "windows" || runsAsRoot,
    async fn() {
      const run = await markspecPersist(["lock"], {
        files: {
          "p/project.yaml": "name: parent\nversion: 0.1.0\n",
          "p/.markspec/sync/jira.yaml": jiraMapping("summary"),
          "p/group/.markspec/sync/jira.yaml": jiraMapping("summary"),
          "p/group/sub/project.yaml": "name: nested\nversion: 0.1.0\n",
          "p/group/sub/.markspec/sync/jira.yaml": jiraMapping("title"),
          "p/group/sub/req.md": entry(
            "STK_0001",
            "A",
            "External-id: jira:ABC-1",
          ),
        },
        cwd: "p/group/sub",
      });
      const path = join(run.dir, folder, ".markspec/sync/jira.yaml");
      try {
        assertEquals(run.code, 0, run.stderr);
        const root = join(run.dir, "p/group/sub");
        await Deno.chmod(path, 0o000);
        try {
          const frozen = await markspecInDir(root, [
            "compile",
            "--frozen",
            "req.md",
          ]);
          assertEquals(frozen.code, 0, frozen.stderr);
          assertStringIncludes(frozen.stderr, "error: MSL-S001");
          assertStringIncludes(frozen.stderr, path);
          assertStringIncludes(frozen.stdout, "1 entries");
        } finally {
          await Deno.chmod(path, 0o600);
        }
        for (const existing of [true, false]) {
          if (!existing) await Deno.remove(join(root, "markspec.lock"));
          const before = await snapshotTree(run.dir);
          for (const args of [["lock"], ["lock", "--check"]]) {
            await Deno.chmod(path, 0o000);
            try {
              const result = await markspecInDir(root, args);
              assertEquals(result.code, 1, result.stderr);
              assertStringIncludes(result.stderr, "error: MSL-S001");
              assertStringIncludes(result.stderr, path);
              assertEquals(result.stdout, "");
            } finally {
              await Deno.chmod(path, 0o600);
            }
            assertEquals(await snapshotTree(run.dir), before);
          }
        }
      } finally {
        await Deno.chmod(path, 0o600);
        await Deno.remove(run.dir, { recursive: true });
      }
    },
  });
}

for (const path of [".markspec", ".markspec/sync"]) {
  for (const kind of ["file", "unreadable directory"]) {
    Deno.test({
      name:
        `lock and compile --frozen: ${kind} at ${path} reports MSL-S001 (#873)`,
      ignore: kind === "unreadable directory" &&
        (Deno.build.os === "windows" || runsAsRoot),
      async fn() {
        const run = await markspecPersist(["lock"], {
          "project.yaml": "name: project\nversion: 0.1.0\n",
          ".markspec/sync/placeholder.txt": "",
          "req.md": entry("STK_0001", "A"),
        });
        const blockedPath = join(run.dir, path);
        const syncPath = join(run.dir, ".markspec/sync");
        try {
          assertEquals(run.code, 0, run.stderr);
          if (kind === "file") {
            await Deno.remove(blockedPath, { recursive: true });
            await Deno.writeTextFile(blockedPath, "not a directory\n");
          }
          const before = await snapshotTree(run.dir);
          if (kind === "unreadable directory") {
            await Deno.chmod(blockedPath, 0o000);
          }
          try {
            const frozen = await markspecInDir(run.dir, [
              "compile",
              "--frozen",
              "req.md",
            ]);
            assertEquals(frozen.code, 0, frozen.stderr);
            assertStringIncludes(frozen.stderr, "error: MSL-S001");
            assertStringIncludes(frozen.stderr, syncPath);
            assertStringIncludes(frozen.stdout, "1 entries");
          } finally {
            if (kind === "unreadable directory") {
              await Deno.chmod(blockedPath, 0o700);
            }
          }
          assertEquals(await snapshotTree(run.dir), before);
          for (const existing of [true, false]) {
            if (!existing) await Deno.remove(join(run.dir, "markspec.lock"));
            const lockBefore = await snapshotTree(run.dir);
            for (const args of [["lock"], ["lock", "--check"]]) {
              if (kind === "unreadable directory") {
                await Deno.chmod(blockedPath, 0o000);
              }
              try {
                const result = await markspecInDir(run.dir, args);
                assertEquals(result.code, 1, result.stderr);
                assertStringIncludes(result.stderr, "error: MSL-S001");
                assertStringIncludes(result.stderr, syncPath);
                assertEquals(result.stdout, "");
              } finally {
                if (kind === "unreadable directory") {
                  await Deno.chmod(blockedPath, 0o700);
                }
              }
              assertEquals(await snapshotTree(run.dir), lockBefore);
            }
          }
        } finally {
          if (kind === "unreadable directory") {
            await Deno.chmod(blockedPath, 0o700);
          }
          await Deno.remove(run.dir, { recursive: true });
        }
      },
    });
  }
}

for (const yaml of ["attributes: 5", "attributes: [null]", "cache: {ttl: 5}"]) {
  Deno.test(`lock and compile --frozen: invalid mapping structure ${yaml} reports MSL-S001 (#873)`, async () => {
    const run = await markspecPersist(["lock"], {
      "project.yaml": "name: project\nversion: 0.1.0\n",
      ".markspec/sync/jira.yaml": jiraMapping("summary"),
      "req.md": entry("STK_0001", "A"),
    });
    try {
      assertEquals(run.code, 0, run.stderr);
      await Deno.writeTextFile(
        join(run.dir, ".markspec/sync/jira.yaml"),
        `schema: 1\nsystem: jira\ndirection: bidirectional\nidentity: {external-id-scheme: jira}\n${yaml}\n`,
      );
      const before = await snapshotTree(run.dir);
      const frozen = await markspecInDir(run.dir, [
        "compile",
        "--frozen",
        "req.md",
      ]);
      assertEquals(frozen.code, 0, frozen.stderr);
      assertStringIncludes(frozen.stderr, "error: MSL-S001");
      assertStringIncludes(frozen.stdout, "1 entries");
      assertEquals(await snapshotTree(run.dir), before);
      for (const existing of [true, false]) {
        if (!existing) await Deno.remove(join(run.dir, "markspec.lock"));
        const lockBefore = await snapshotTree(run.dir);
        for (const args of [["lock"], ["lock", "--check"]]) {
          const result = await markspecInDir(run.dir, args);
          assertEquals(result.code, 1, result.stderr);
          assertStringIncludes(result.stderr, "error: MSL-S001");
          assertEquals(result.stdout, "");
          assertEquals(await snapshotTree(run.dir), lockBefore);
        }
      }
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  });
}

Deno.test("compile --frozen: malformed inherited mapping prints diagnostics and continues (#873)", async () => {
  const run = await markspecPersist(["lock"], {
    files: {
      "p/project.yaml": "name: parent\nversion: 0.1.0\n",
      "p/group/.markspec/sync/jira.yaml": jiraMapping("summary"),
      "p/group/sub/project.yaml": "name: nested\nversion: 0.1.0\n",
      "p/group/sub/.markspec/sync/jira.yaml": jiraMapping("title"),
      "p/group/sub/req.md": entry("STK_0001", "A", "External-id: jira:ABC-1"),
    },
    cwd: "p/group/sub",
  });
  try {
    assertEquals(run.code, 0, run.stderr);
    await Deno.writeTextFile(
      join(run.dir, "p/group/.markspec/sync/jira.yaml"),
      "schema: [\n",
    );
    const result = await markspecInDir(join(run.dir, "p/group/sub"), [
      "compile",
      "--frozen",
      "req.md",
    ]);
    assertStringIncludes(result.stderr, "error: MSL-S001");
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "1 entries");
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
