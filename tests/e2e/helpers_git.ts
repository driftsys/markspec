/**
 * @module tests/e2e/helpers_git
 *
 * Set up a local bare git repository with a profile fixture, for e2e tests
 * of git specifier resolution. Uses the real `git` CLI via Deno.Command.
 *
 * Returns a `file://` URL the caller can reference from a `.markspec.yaml`
 * specifier. Caller is responsible for cleaning up the provided workspaceDir.
 */

/** What you get back from `setupGitFixture`. */
export interface GitFixture {
  /** `file:///...` URL pointing at the bare repo. Safe to use in a specifier. */
  readonly url: string;
  /** The tag name you passed in, echoed back for convenience. */
  readonly tag: string;
}

/** Options for setting up a git fixture. */
export interface GitFixtureOptions {
  /** Absolute path to the workspace dir the caller owns. */
  readonly workspaceDir: string;
  /** A logical name used for both the bare repo directory and the tag prefix. */
  readonly name: string;
  /** Files to commit into the repo. Keys are paths relative to the repo root. */
  readonly files: Record<string, string>;
  /** Tag to apply to the single commit. */
  readonly tag: string;
}

/**
 * Initialize a bare repo under `<workspaceDir>/_gitfixtures/<name>.git`, create
 * a scratch worktree next to it, commit `files`, tag the commit with `tag`,
 * and push. Returns the `file://` URL pointing at the bare repo.
 */
export async function setupGitFixture(
  opts: GitFixtureOptions,
): Promise<GitFixture> {
  const bareDir = `${opts.workspaceDir}/_gitfixtures/${opts.name}.git`;
  const workDir = `${opts.workspaceDir}/_gitwork/${opts.name}`;

  await Deno.mkdir(bareDir, { recursive: true });
  // Ensure workDir is truly fresh — uncaught errors from other test files
  // (render/typst WASM NAPI) can corrupt Deno runner state, leaving ghost
  // artifacts. Deleting first guarantees a clean git init.
  await Deno.remove(workDir, { recursive: true }).catch(() => {});
  await Deno.mkdir(workDir, { recursive: true });

  await runOrThrow(["git", "init", "--bare", bareDir]);

  await runOrThrow(["git", "init", "-b", "main", workDir]);
  await runOrThrow(["git", "-C", workDir, "config", "user.email", "t@t.test"]);
  await runOrThrow(["git", "-C", workDir, "config", "user.name", "Test"]);
  await runOrThrow(["git", "-C", workDir, "config", "commit.gpgsign", "false"]);

  for (const [relPath, content] of Object.entries(opts.files)) {
    const abs = `${workDir}/${relPath}`;
    const parts = relPath.split("/");
    if (parts.length > 1) {
      await Deno.mkdir(
        `${workDir}/${parts.slice(0, -1).join("/")}`,
        { recursive: true },
      );
    }
    await Deno.writeTextFile(abs, content);
  }

  await runOrThrow(["git", "-C", workDir, "add", "."]);
  await runOrThrow([
    "git",
    "-C",
    workDir,
    "commit",
    "-m",
    "fixture",
    "--allow-empty",
  ]);
  await runOrThrow(["git", "-C", workDir, "tag", opts.tag]);
  await runOrThrow(["git", "-C", workDir, "remote", "add", "origin", bareDir]);
  await runOrThrow([
    "git",
    "-C",
    workDir,
    "push",
    "--tags",
    "origin",
    "main",
  ]);

  return {
    url: `file://${bareDir}`,
    tag: opts.tag,
  };
}

async function runOrThrow(args: string[]): Promise<void> {
  const [bin, ...rest] = args;
  const cmd = new Deno.Command(bin, {
    args: rest,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  if (code !== 0) {
    throw new Error(
      `${args.join(" ")} failed with code ${code}: ${
        new TextDecoder().decode(stderr)
      }`,
    );
  }
}
