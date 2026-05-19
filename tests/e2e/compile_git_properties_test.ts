/**
 * @module tests/e2e/compile_git_properties_test
 *
 * E2E tests for `properties.git.*` population on compiled entries.
 *
 * Two axes:
 *   - Graceful degradation: outside a git repo (or without run
 *     permission) the CLI must still exit 0 and simply omit
 *     `properties.git` — never crash.
 *   - Present case: inside a real git repo the four git fields are
 *     populated, and contributor names appear only with
 *     `--with-contributors`.
 */

import { assertEquals, assertMatch } from "@std/assert";
import { markspec } from "./helpers.ts";

const CLI_ENTRY = new URL(
  "../../packages/markspec/main.ts",
  import.meta.url,
).pathname;

const PROJECT_YAML = `name: test-project\nversion: 0.1.0\n`;

const SAMPLE_MD = `- [STK_0001] The system shall be fast

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

/** Parent env with GIT_* stripped — keeps spawned git out of any hook env. */
function safeEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(Deno.env.toObject())) {
    if (!k.startsWith("GIT_")) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Graceful degradation — temp dir is not a git repository
// ---------------------------------------------------------------------------

Deno.test("compile: properties.git absent outside a git repo (no run perm)", async () => {
  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "req.md"],
    { files: { "project.yaml": PROJECT_YAML, "req.md": SAMPLE_MD } },
  );
  assertEquals(code, 0);
  const entry = JSON.parse(stdout).entries["STK_0001"];
  assertEquals(typeof entry.properties?.file?.path, "string");
  assertEquals(entry.properties?.git, undefined);
});

Deno.test("compile: properties.git absent outside a git repo (with run perm)", async () => {
  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "req.md"],
    {
      files: { "project.yaml": PROJECT_YAML, "req.md": SAMPLE_MD },
      permissions: ["--allow-run"],
    },
  );
  assertEquals(code, 0);
  const entry = JSON.parse(stdout).entries["STK_0001"];
  assertEquals(entry.properties?.git, undefined);
});

Deno.test("compile --output: compiled.json git absent outside a git repo", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/project.yaml`, PROJECT_YAML);
    await Deno.writeTextFile(`${dir}/req.md`, SAMPLE_MD);
    const { code } = await new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-run",
        CLI_ENTRY,
        "compile",
        "--output",
        "out",
        "req.md",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
      clearEnv: true,
      env: safeEnv(),
    }).output();
    assertEquals(code, 0);
    const compiled = JSON.parse(
      await Deno.readTextFile(`${dir}/out/compiled.json`),
    );
    const entry = compiled.entries["STK_0001"];
    assertEquals(typeof entry.properties?.file?.path, "string");
    assertEquals(entry.properties?.git, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Present case — a real git repository with one committed file
// ---------------------------------------------------------------------------

/** git init a fresh repo in `dir` and commit project.yaml + req.md. */
async function initRepo(dir: string): Promise<void> {
  const run = async (args: string[]) => {
    const { code, stderr } = await new Deno.Command(args[0], {
      args: args.slice(1),
      cwd: dir,
      stdout: "null",
      stderr: "piped",
      clearEnv: true,
      env: safeEnv(),
    }).output();
    if (code !== 0) {
      throw new Error(
        `${args.join(" ")} → ${code}: ${new TextDecoder().decode(stderr)}`,
      );
    }
  };
  await Deno.writeTextFile(`${dir}/project.yaml`, PROJECT_YAML);
  await Deno.writeTextFile(`${dir}/req.md`, SAMPLE_MD);
  await run(["git", "init", "-b", "main", dir]);
  await run(["git", "-C", dir, "config", "user.email", "t@t.test"]);
  await run(["git", "-C", dir, "config", "user.name", "Test Author"]);
  await run(["git", "-C", dir, "config", "commit.gpgsign", "false"]);
  await run(["git", "-C", dir, "add", "."]);
  await run(["git", "-C", dir, "commit", "-m", "initial"]);
}

/** Run `markspec compile` inside `dir` with run permission. */
async function compileIn(
  dir: string,
  extraArgs: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const r = await new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      CLI_ENTRY,
      "compile",
      "--format",
      "json",
      ...extraArgs,
      "req.md",
    ],
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
    clearEnv: true,
    env: safeEnv(),
  }).output();
  return {
    code: r.code,
    stdout: new TextDecoder().decode(r.stdout),
    stderr: new TextDecoder().decode(r.stderr),
  };
}

Deno.test("compile: properties.git populated inside a git repo", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await initRepo(dir);
    const { code, stdout } = await compileIn(dir, []);
    assertEquals(code, 0);
    const git = JSON.parse(stdout).entries["STK_0001"].properties?.git;
    assertMatch(git.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assertMatch(git.modifiedAt, /^\d{4}-\d{2}-\d{2}T/);
    assertMatch(git.revision, /^[0-9a-f]{7,}$/);
    // contributors are PII-adjacent (ADR-006) — off without the flag.
    assertEquals(git.contributors, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("compile --with-contributors: contributor names included", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await initRepo(dir);
    const { code, stdout } = await compileIn(dir, ["--with-contributors"]);
    assertEquals(code, 0);
    const git = JSON.parse(stdout).entries["STK_0001"].properties?.git;
    assertEquals(git.contributors, ["Test Author"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("compile --output: compiled.json carries git fields in a repo", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await initRepo(dir);
    const { code } = await new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-run",
        CLI_ENTRY,
        "compile",
        "--output",
        "out",
        "req.md",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
      clearEnv: true,
      env: safeEnv(),
    }).output();
    assertEquals(code, 0);
    const compiled = JSON.parse(
      await Deno.readTextFile(`${dir}/out/compiled.json`),
    );
    const git = compiled.entries["STK_0001"].properties?.git;
    assertMatch(git.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assertMatch(git.revision, /^[0-9a-f]{7,}$/);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
