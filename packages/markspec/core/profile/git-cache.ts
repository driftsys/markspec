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
