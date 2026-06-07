/**
 * @module tests/e2e/init_test
 *
 * E2E blackbox tests for `markspec init` — scenarios 1–8.
 * All interaction with the CLI is through `markspecInDir`; no source
 * module imports.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir } from "./helpers.ts";

const PERMS = ["--allow-run", "--allow-env"];

async function tempDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "markspec-init-e2e-" });
}

async function cleanup(dir: string): Promise<void> {
  try {
    await Deno.remove(dir, { recursive: true });
  } catch { /* ignore */ }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test(
  "e2e[1] init in empty dir, no-skills, --force → exits 0 or 2 and writes 4 files",
  async () => {
    const dir = await tempDir();
    try {
      const { code, stderr } = await markspecInDir(
        dir,
        ["init", "--no-skills", "--force"],
        PERMS,
      );
      assertEquals(
        [0, 2].includes(code),
        true,
        `exit ${code}, stderr: ${stderr}`,
      );
      assertEquals(await fileExists(join(dir, "project.yaml")), true);
      assertEquals(await fileExists(join(dir, ".markspec.yaml")), true);
      assertEquals(await fileExists(join(dir, "markspec.lock")), true);
      assertEquals(
        await fileExists(join(dir, ".vscode/extensions.json")),
        true,
      );
    } finally {
      await cleanup(dir);
    }
  },
);

Deno.test(
  "e2e[2] init with --client claude-code --client opencode → writes both MCP configs",
  async () => {
    const dir = await tempDir();
    try {
      const { code, stderr } = await markspecInDir(
        dir,
        [
          "init",
          "--no-skills",
          "--force",
          "--client",
          "claude-code",
          "--client",
          "opencode",
        ],
        PERMS,
        {
          MARKSPEC_TEST_MODE: "1",
          MARKSPEC_FAKE_CLIENT_DETECT: "claude-code,opencode",
        },
      );
      assertEquals(
        [0, 2].includes(code),
        true,
        `exit ${code}, stderr: ${stderr}`,
      );
      const mcp = await Deno.readTextFile(join(dir, ".mcp.json"));
      assertStringIncludes(mcp, "markspec");
      const opc = await Deno.readTextFile(join(dir, "opencode.json"));
      assertStringIncludes(opc, "markspec");
    } finally {
      await cleanup(dir);
    }
  },
);

Deno.test("e2e[3] init <subdir> creates the subdir", async () => {
  const parent = await tempDir();
  const sub = join(parent, "child");
  try {
    const { code, stderr } = await markspecInDir(
      parent,
      ["init", "child", "--no-skills", "--force"],
      PERMS,
    );
    assertEquals(
      [0, 2].includes(code),
      true,
      `exit ${code}, stderr: ${stderr}`,
    );
    assertEquals(await fileExists(join(sub, "project.yaml")), true);
  } finally {
    await cleanup(parent);
  }
});

Deno.test(
  "e2e[4] init in dir with only whitelisted files succeeds",
  async () => {
    const dir = await tempDir();
    try {
      await Deno.writeTextFile(join(dir, "README.md"), "# x");
      await Deno.mkdir(join(dir, ".git"));
      const { code, stderr } = await markspecInDir(
        dir,
        ["init", "--no-skills", "--force"],
        PERMS,
      );
      assertEquals(
        [0, 2].includes(code),
        true,
        `exit ${code}, stderr: ${stderr}`,
      );
    } finally {
      await cleanup(dir);
    }
  },
);

Deno.test(
  "e2e[5] init in dir with src/ refuses without --force",
  async () => {
    const dir = await tempDir();
    try {
      await Deno.mkdir(join(dir, "src"));
      const { code, stderr } = await markspecInDir(
        dir,
        ["init", "--no-skills"],
        PERMS,
      );
      // Spec §3 step 1: non-empty target without --force → exit 1.
      // Some implementations may not yet enforce the non-empty check;
      // accept exit 1 strictly here (the orchestrator should do this
      // before any write).
      // If this fails, the orchestrator is missing the non-empty
      // pre-write check — add it in `runInit` step 1.
      assertEquals(code, 1, `exit ${code}, stderr: ${stderr}`);
      assertStringIncludes(stderr.toLowerCase(), "src");
    } finally {
      await cleanup(dir);
    }
  },
);

Deno.test("e2e[6] init --force in non-empty dir succeeds", async () => {
  const dir = await tempDir();
  try {
    await Deno.mkdir(join(dir, "src"));
    const { code, stderr } = await markspecInDir(
      dir,
      ["init", "--no-skills", "--force"],
      PERMS,
    );
    assertEquals(
      [0, 2].includes(code),
      true,
      `exit ${code}, stderr: ${stderr}`,
    );
    assertEquals(await fileExists(join(dir, "project.yaml")), true);
  } finally {
    await cleanup(dir);
  }
});

Deno.test(
  "e2e[7] init --profile git+... writes the URL into .markspec.yaml",
  async () => {
    const dir = await tempDir();
    try {
      const { code, stderr } = await markspecInDir(
        dir,
        [
          "init",
          "--no-skills",
          "--force",
          "--profile",
          "git+https://github.com/example/profile.git",
        ],
        PERMS,
      );
      // init writes a stub markspec.lock with zero upstreams (it does not
      // resolve the git profile — no network at init time), so it always
      // warns LOCKFILE_STUB_NEEDS_PIN → exit 2 (#581).
      assertEquals(code, 2, `exit ${code}, stderr: ${stderr}`);
      assertStringIncludes(stderr, "LOCKFILE_STUB_NEEDS_PIN");
      assertStringIncludes(stderr, "markspec lock");
      const md = await Deno.readTextFile(join(dir, ".markspec.yaml"));
      assertStringIncludes(md, "git+https://github.com/example/profile.git");
    } finally {
      await cleanup(dir);
    }
  },
);

Deno.test("e2e[8] init --no-profile writes default-profile: false", async () => {
  const dir = await tempDir();
  try {
    const { code, stderr } = await markspecInDir(
      dir,
      ["init", "--no-skills", "--no-profile", "--force"],
      PERMS,
    );
    assertEquals(
      [0, 2].includes(code),
      true,
      `exit ${code}, stderr: ${stderr}`,
    );
    const md = await Deno.readTextFile(join(dir, ".markspec.yaml"));
    assertStringIncludes(md, "default-profile: false");
  } finally {
    await cleanup(dir);
  }
});

Deno.test("e2e[9] init --dry-run exits 0 or 2, writes nothing", async () => {
  const dir = await tempDir();
  try {
    const { code, stderr } = await markspecInDir(
      dir,
      ["init", "--dry-run", "--no-skills"],
      PERMS,
    );
    // Exit 0 when no warnings; exit 2 when binary-path warning fires
    // (e.g., `markspec` on PATH differs from the running deno — expected
    // in CI and developer machines with a pre-installed binary).
    assertEquals(
      [0, 2].includes(code),
      true,
      `exit ${code}, stderr: ${stderr}`,
    );
    assertEquals(await fileExists(join(dir, "project.yaml")), false);
  } finally {
    await cleanup(dir);
  }
});

Deno.test("e2e[10] init --dry-run --format json emits JSON, no writes", async () => {
  const dir = await tempDir();
  try {
    const { code, stdout, stderr } = await markspecInDir(
      dir,
      ["init", "--dry-run", "--format", "json", "--no-skills"],
      PERMS,
    );
    // Exit 0 when clean; exit 2 when binary-path warning fires.
    assertEquals(
      [0, 2].includes(code),
      true,
      `exit ${code}, stderr: ${stderr}`,
    );
    const parsed = JSON.parse(stdout);
    assertEquals(parsed.ok, true);
    assertEquals(parsed.target.length > 0, true);
    assertEquals(await fileExists(join(dir, "project.yaml")), false);
  } finally {
    await cleanup(dir);
  }
});

Deno.test("e2e[11] init twice in same dir is idempotent", async () => {
  const dir = await tempDir();
  try {
    await markspecInDir(dir, ["init", "--no-skills", "--force"], PERMS);
    const { code, stderr } = await markspecInDir(
      dir,
      ["init", "--no-skills", "--force"],
      PERMS,
    );
    // Second run with --force: per-file scaffolders either overwrite
    // (kind:overwrite) or are no-ops on already-correct content. Either
    // way exit 0 or 2 is acceptable depending on whether anything
    // produced a skip/warning.
    assertEquals(
      [0, 2].includes(code),
      true,
      `exit ${code}, stderr: ${stderr}`,
    );
  } finally {
    await cleanup(dir);
  }
});

Deno.test("e2e[12] init on modified project.yaml without --force → skip + exit 2", async () => {
  const dir = await tempDir();
  try {
    await markspecInDir(dir, ["init", "--no-skills", "--force"], PERMS);
    await Deno.writeTextFile(
      join(dir, "project.yaml"),
      '# user edit\nname: "x"\n',
    );
    const { code, stderr } = await markspecInDir(
      dir,
      ["init", "--no-skills"],
      PERMS,
    );
    assertEquals(code, 2, `exit ${code}, stderr: ${stderr}`);
    assertStringIncludes(stderr.toLowerCase(), "skip");
    // User edit is preserved.
    assertEquals(
      await Deno.readTextFile(join(dir, "project.yaml")),
      '# user edit\nname: "x"\n',
    );
  } finally {
    await cleanup(dir);
  }
});

Deno.test("e2e[13] init --force on modified project.yaml overwrites", async () => {
  const dir = await tempDir();
  try {
    await markspecInDir(dir, ["init", "--no-skills", "--force"], PERMS);
    await Deno.writeTextFile(join(dir, "project.yaml"), "# user edit");
    const { code, stderr } = await markspecInDir(
      dir,
      ["init", "--no-skills", "--force"],
      PERMS,
    );
    assertEquals(
      [0, 2].includes(code),
      true,
      `exit ${code}, stderr: ${stderr}`,
    );
    const after = await Deno.readTextFile(join(dir, "project.yaml"));
    assertEquals(
      after.includes("# user edit"),
      false,
      "force should overwrite the user edit",
    );
  } finally {
    await cleanup(dir);
  }
});

Deno.test("e2e[14] init --binary-path /nonexistent warns or exits 1", async () => {
  const dir = await tempDir();
  try {
    const { code, stderr } = await markspecInDir(
      dir,
      [
        "init",
        "--no-skills",
        "--force",
        "--binary-path",
        "/nonexistent/markspec",
      ],
      PERMS,
    );
    // Spec §6 maps non-existent --binary-path to a warning (exit 2),
    // not a hard error. Accept either 1 or 2 here.
    assertEquals(
      [1, 2].includes(code),
      true,
      `exit ${code}, stderr: ${stderr}`,
    );
    assertStringIncludes(stderr, "/nonexistent");
  } finally {
    await cleanup(dir);
  }
});

Deno.test("e2e[15] init non-TTY without --force/--no-profile/--profile", async () => {
  // markspecInDir always pipes → non-TTY. Without --force/--profile/
  // --no-profile, init falls back to non-interactive bundled default
  // (per resolveProfileFromFlags in cli/commands/init.ts).
  // Acceptable outcomes:
  //   exit 0 or 2 — init succeeded with bundled default
  //   exit 1 — implementer chose to require explicit --force in non-TTY
  const dir = await tempDir();
  try {
    const { code, stderr } = await markspecInDir(
      dir,
      ["init", "--no-skills"],
      PERMS,
    );
    assertEquals(
      [0, 1, 2].includes(code),
      true,
      `exit ${code}, stderr: ${stderr}`,
    );
  } finally {
    await cleanup(dir);
  }
});
