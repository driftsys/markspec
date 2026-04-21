/**
 * @module core/profile
 *
 * Public API for the profile system: loading, manifest parsing, chain
 * resolution, and merging. Consumed by the validator pipeline and the CLI.
 */

export { parseManifest } from "./manifest.ts";
export type { ParseManifestResult } from "./manifest.ts";
