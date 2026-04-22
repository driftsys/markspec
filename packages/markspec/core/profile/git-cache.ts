/**
 * @module core/profile/git-cache
 *
 * Cache + `git` CLI infrastructure for git-specifier resolution.
 *
 * The cache lives under `<project-root>/.markspec/cache/<sha>/` where `<sha>`
 * is the sha256 of a canonical `(host, repo, subpath, tag)` tuple. Because
 * the spec requires tag-only specifiers and tags are (by convention)
 * immutable, cached content never needs refresh: either the cache directory
 * exists and contains `markspec.yaml`, or we clone afresh.
 */

import { join } from "@std/path";

/** Components of a git specifier that contribute to the cache key. */
export interface GitCacheKeyInput {
  readonly repo: string;
  readonly subpath: string | undefined;
  readonly tag: string;
}

/**
 * Stable sha256 hex digest of the canonical `(repo, subpath, tag)` tuple.
 * Same inputs → same digest, always.
 */
export async function computeCacheKey(
  input: GitCacheKeyInput,
): Promise<string> {
  const canonical = JSON.stringify([
    input.repo,
    input.subpath ?? "",
    input.tag,
  ]);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Resolved paths for a cache-backed specifier. */
export interface CacheLocation {
  /** sha256 hex key for the specifier. */
  readonly key: string;
  /** Absolute cache directory — where the clone lives (top-level repo). */
  readonly dir: string;
  /** Absolute path of the `markspec.yaml` the resolver needs to read. */
  readonly manifestPath: string;
}

/**
 * Compute the cache location for a git specifier relative to a project root.
 */
export async function computeCacheLocation(
  projectRoot: string,
  input: GitCacheKeyInput,
): Promise<CacheLocation> {
  const key = await computeCacheKey(input);
  const dir = join(projectRoot, ".markspec", "cache", key);
  const manifestPath = input.subpath !== undefined
    ? join(dir, input.subpath, "markspec.yaml")
    : join(dir, "markspec.yaml");
  return { key, dir, manifestPath };
}

/** Result of running a git subcommand — captures exit code + output streams. */
export interface RunGitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Inject this into the resolver to stub git invocations in unit tests.
 * Production code uses {@linkcode defaultRunGit}.
 */
export type RunGit = (
  args: readonly string[],
  cwd?: string,
) => Promise<RunGitResult>;

const textDecoder = new TextDecoder();

/**
 * Default implementation backed by `Deno.Command("git", …)`. Captures stdout
 * and stderr; never throws for nonzero exit — callers inspect `result.code`.
 *
 * Requires `--allow-run=git` at the Deno CLI level.
 */
export const defaultRunGit: RunGit = async (args, cwd) => {
  const cmd = new Deno.Command("git", {
    args: [...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  return {
    code,
    stdout: textDecoder.decode(stdout),
    stderr: textDecoder.decode(stderr),
  };
};

/** Injectable appender for {@linkcode ensureCacheGitignored}. */
export type AppendFile = (path: string, content: string) => Promise<void>;

/**
 * Idempotently add `.markspec/cache/` to the project's `.gitignore` if that
 * file exists. No-op when `.gitignore` is absent.
 *
 * Treats `.markspec/`, `.markspec/cache`, and `.markspec/cache/` as already
 * ignored (broadest pattern wins).
 *
 * @param projectRoot - Absolute path containing the `.gitignore`
 * @param readFile - Abstraction matching `core/config/mod.ts` `ReadFile`
 * @param appendFile - Abstraction that appends a string to a file
 */
export async function ensureCacheGitignored(
  projectRoot: string,
  readFile: (path: string) => Promise<string | undefined>,
  appendFile: AppendFile,
): Promise<void> {
  const gitignorePath = join(projectRoot, ".gitignore");
  const current = await readFile(gitignorePath);
  if (current === undefined) {
    return;
  }
  // Treat any of these patterns as "already ignored" and skip.
  const lines = current.split("\n").map((l) => l.trim());
  const ignored = lines.some((l) =>
    l === ".markspec/" ||
    l === ".markspec/cache/" ||
    l === ".markspec/cache"
  );
  if (ignored) {
    return;
  }
  const needsLeadingNewline = current.length > 0 && !current.endsWith("\n");
  const content = (needsLeadingNewline ? "\n" : "") + ".markspec/cache/\n";
  await appendFile(gitignorePath, content);
}

/**
 * Default `AppendFile` backed by `Deno.writeTextFile` with `{ append: true }`.
 * Requires `--allow-write`.
 */
export const defaultAppendFile: AppendFile = async (path, content) => {
  await Deno.writeTextFile(path, content, { append: true });
};
