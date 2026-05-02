/**
 * @module core/profile
 *
 * Public API for the profile system: loading, manifest parsing, chain
 * resolution, and merging. Consumed by the validator pipeline and the CLI.
 */

export { parseManifest } from "./manifest.ts";
export type { ParseManifestResult } from "./manifest.ts";

export { resolveGitSpecifier, resolveLocalSpecifier } from "./resolver.ts";
export type { ResolvedProfileSource, ResolveGitOptions } from "./resolver.ts";

export {
  computeCacheKey,
  computeCacheLocation,
  defaultAppendFile,
  defaultRunGit,
  ensureCacheGitignored,
} from "./git-cache.ts";
export type {
  AppendFile,
  CacheLocation,
  GitCacheKeyInput,
  RunGit,
  RunGitResult,
} from "./git-cache.ts";

export { loadChain } from "./chain.ts";
export type { LoadChainOptions, LoadChainResult } from "./chain.ts";

export { loadProfileForCommand } from "./load.ts";
export type { LoadProfileForCommandResult } from "./load.ts";

export { mergeChain } from "./merge.ts";
export type { MergeResult } from "./merge.ts";

export { cacheDir } from "./cache.ts";
export type { CacheEnv } from "./cache.ts";
