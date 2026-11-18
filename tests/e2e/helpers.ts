/**
 * @module tests/e2e/helpers
 *
 * Shared E2E test helper. Provides the markspec() function that runs
 * the CLI binary via Deno.Command in a temporary directory.
 */

import { fromFileUrl, join } from "@std/path";

let cachedDenoDir: string | undefined;

/**
 * The real Deno cache directory. A test that overrides `HOME` for a child
 * `deno run` must also pass this as `DENO_DIR`: on macOS and Linux the
 * default cache path is under `HOME`, so a temporary `HOME` gives the child
 * an empty cache and it downloads every dependency again. Computed once.
 */
export function realDenoDir(): string {
  if (cachedDenoDir !== undefined) return cachedDenoDir;
  const fromEnv = Deno.env.get("DENO_DIR");
  if (fromEnv) return cachedDenoDir = fromEnv;
  const out = new Deno.Command(Deno.execPath(), {
    args: ["info", "--json"],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!out.success) {
    throw new Error(
      `deno info --json failed: ${new TextDecoder().decode(out.stderr)}`,
    );
  }
  const denoDir = JSON.parse(new TextDecoder().decode(out.stdout)).denoDir;
  if (typeof denoDir !== "string") {
    throw new Error("deno info --json reported no denoDir");
  }
  return cachedDenoDir = denoDir;
}

const CLI_ENTRY = fromFileUrl(
  new URL("../../packages/markspec/main.ts", import.meta.url),
);

/** Options for the markspec test helper. */
export interface MarkspecOptions {
  /** Files to write before running the command. */
  files?: Record<string, string>;
  /** Working directory relative to the temp root (e.g., `"a/b/c"`). */
  cwd?: string;
  /** Additional Deno permission flags for the subprocess. */
  permissions?: string[];
}

/** Run the markspec CLI with the given args and optional input files. */
export async function markspec(
  args: string[],
  filesOrOptions: Record<string, string> | MarkspecOptions = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const opts: MarkspecOptions = isMarkspecOptions(filesOrOptions)
    ? filesOrOptions
    : { files: filesOrOptions };

  const dir = await Deno.makeTempDir();
  try {
    for (const [name, content] of Object.entries(opts.files ?? {})) {
      const parts = name.split("/");
      if (parts.length > 1) {
        await Deno.mkdir(join(dir, ...parts.slice(0, -1)), {
          recursive: true,
        }).catch(() => {});
      }
      await Deno.writeTextFile(join(dir, ...parts), content);
    }

    const cwd = opts.cwd ? join(dir, ...opts.cwd.split("/")) : dir;
    if (opts.cwd) {
      await Deno.mkdir(cwd, { recursive: true }).catch(() => {});
    }

    const permissions = [
      "--allow-read",
      "--allow-write",
      ...(opts.permissions ?? []),
    ];
    // Strip GIT_* variables so that git commands spawned by the CLI (e.g.
    // `git clone` in the profile resolver) are not polluted by the hook
    // environment (GIT_DIR, GIT_WORK_TREE, etc.) when tests run inside a
    // git pre-push hook from a bare-with-worktree repository.
    const parentEnv = Deno.env.toObject();
    const safeEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(parentEnv)) {
      if (!k.startsWith("GIT_")) {
        safeEnv[k] = v;
      }
    }
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        // --quiet suppresses Deno's own `Download`/`Check` progress lines.
        // On a cold module cache they otherwise leak into the captured
        // subprocess stderr and corrupt stderr-snapshot assertions — a flake
        // that only surfaces on CI runners with an unwarmed cache.
        "--quiet",
        ...permissions,
        CLI_ENTRY,
        ...args,
      ],
      cwd,
      stdout: "piped",
      stderr: "piped",
      clearEnv: true,
      env: safeEnv,
    });
    const result = await cmd.output();
    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function isMarkspecOptions(
  v: Record<string, string> | MarkspecOptions,
): v is MarkspecOptions {
  return "files" in v || "cwd" in v || "permissions" in v;
}

/** Result returned by {@linkcode markspecPersist}, including the temp dir. */
export interface MarkspecPersistRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Persisted temp dir — caller must remove it in try/finally. */
  readonly dir: string;
}

/**
 * Like {@linkcode markspec} but returns the temp dir and DOES NOT clean
 * it up. Useful for multi-step E2E tests that write files, run
 * `markspec`, edit the output, and re-run.
 *
 * Caller is responsible for `Deno.remove(dir, { recursive: true })` in a
 * try/finally.
 */
export async function markspecPersist(
  args: string[],
  filesOrOptions: Record<string, string> | MarkspecOptions = {},
): Promise<MarkspecPersistRun> {
  const opts: MarkspecOptions = isMarkspecOptions(filesOrOptions)
    ? filesOrOptions
    : { files: filesOrOptions };

  const dir = await Deno.makeTempDir();
  for (const [name, content] of Object.entries(opts.files ?? {})) {
    const parts = name.split("/");
    if (parts.length > 1) {
      await Deno.mkdir(join(dir, ...parts.slice(0, -1)), { recursive: true })
        .catch(() => {});
    }
    await Deno.writeTextFile(join(dir, ...parts), content);
  }

  const cwd = opts.cwd ? join(dir, ...opts.cwd.split("/")) : dir;
  if (opts.cwd) {
    await Deno.mkdir(cwd, { recursive: true }).catch(() => {});
  }

  const permissions = [
    "--allow-read",
    "--allow-write",
    ...(opts.permissions ?? []),
  ];
  // Same GIT_* stripping as markspec() — see comment there.
  const parentEnv = Deno.env.toObject();
  const safeEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(parentEnv)) {
    if (!k.startsWith("GIT_")) safeEnv[k] = v;
  }
  const cmd = new Deno.Command("deno", {
    // --quiet: strip Deno's Download/Check progress from captured stderr —
    // see markspec() above.
    args: ["run", "--quiet", ...permissions, CLI_ENTRY, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
    clearEnv: true,
    env: safeEnv,
  });
  const result = await cmd.output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    dir,
  };
}

/**
 * Run the markspec CLI inside a pre-existing directory (e.g., one
 * created by {@linkcode markspecPersist}). Same flag set, same env
 * scrubbing — just no temp-dir creation or cleanup.
 *
 * `permissions` extends the default `--allow-read --allow-write` list
 * (e.g. pass `["--allow-run", "--allow-env"]` for tests that need them).
 * `envOverrides` adds/replaces env vars in the subprocess, useful for
 * test-only seams like MARKSPEC_FAKE_CLIENT_DETECT.
 */
export async function markspecInDir(
  dir: string,
  args: string[],
  permissions: string[] = [],
  envOverrides: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const allowList = ["--allow-read", "--allow-write", ...permissions];
  const parentEnv = Deno.env.toObject();
  const safeEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(parentEnv)) {
    if (!k.startsWith("GIT_")) safeEnv[k] = v;
  }
  // A HOME override would otherwise move the Deno cache with it. Set
  // before the overrides, so a caller's own DENO_DIR still wins.
  if ("HOME" in envOverrides) safeEnv.DENO_DIR = realDenoDir();
  // Apply caller-supplied env overrides last so they win.
  for (const [k, v] of Object.entries(envOverrides)) {
    safeEnv[k] = v;
  }
  const cmd = new Deno.Command("deno", {
    // --quiet: strip Deno's Download/Check progress from captured stderr —
    // see markspec() above.
    args: ["run", "--quiet", ...allowList, CLI_ENTRY, ...args],
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
    clearEnv: true,
    env: safeEnv,
  });
  const result = await cmd.output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}
