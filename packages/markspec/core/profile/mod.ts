/**
 * @module core/profile
 *
 * Public API for the profile system: loading, manifest parsing, chain
 * resolution, and merging. Consumed by the validator pipeline and the CLI.
 */

export { parseManifest } from "./manifest.ts";
export type { ParseManifestResult } from "./manifest.ts";

export { resolveLocalSpecifier } from "./resolver.ts";
export type { ResolvedProfileSource } from "./resolver.ts";

export { loadChain } from "./chain.ts";
export type { LoadChainResult } from "./chain.ts";

export { loadProfileForCommand } from "./load.ts";
export type { LoadProfileForCommandResult } from "./load.ts";

export { mergeChain } from "./merge.ts";
export type { MergeResult } from "./merge.ts";
