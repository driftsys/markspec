/**
 * @module tests/e2e/helpers
 *
 * Shared E2E test helper. Provides the markspec() function that runs
 * the CLI binary via Deno.Command in a temporary directory.
 */

import { fromFileUrl } from "@std/path";

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
        await Deno.mkdir(`${dir}/${parts.slice(0, -1).join("/")}`, {
          recursive: true,
        }).catch(() => {});
      }
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }

    const cwd = opts.cwd ? `${dir}/${opts.cwd}` : dir;
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
