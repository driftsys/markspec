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
  await Deno.mkdir(workDir, { recursive: true });

  await runOrThrow(["git", "init", "--bare", bareDir]);

  await runOrThrow(["git", "init", workDir]);
  await runOrThrow(["git", "-C", workDir, "config", "user.email", "t@t.test"]);
  await runOrThrow(["git", "-C", workDir, "config", "user.name", "Test"]);
  await runOrThrow(["git", "-C", workDir, "config", "commit.gpgsign", "false"]);
  await runOrThrow(["git", "-C", workDir, "checkout", "-b", "main"]);

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
  // Deno.Command env merges with the parent process environment. When this
  // function runs inside a git hook (e.g. pre-push), git has already set
  // GIT_DIR and GIT_WORK_TREE, which causes `git init --bare` to fail with
  //   "GIT_WORK_TREE not allowed without specifying GIT_DIR"
  // Use clearEnv + an explicit allowlist to guarantee a clean git environment.
  const parentEnv = Deno.env.toObject();
  const safeEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(parentEnv)) {
    if (!k.startsWith("GIT_")) {
      safeEnv[k] = v;
    }
  }
  const cmd = new Deno.Command(bin, {
    args: rest,
    stdout: "piped",
    stderr: "piped",
    clearEnv: true,
    env: safeEnv,
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
