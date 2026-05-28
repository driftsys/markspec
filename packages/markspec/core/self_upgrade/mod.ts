/**
 * @module core/self_upgrade
 *
 * Pure helpers for `markspec self-upgrade`. No I/O — see
 * `cli/self_upgrade/` and `cli/commands/self_upgrade.ts` for the
 * orchestrator and helpers that wire these into HTTP + filesystem.
 */

export { compareVersions, type Comparison } from "./compare.ts";
export {
  classifyInstallPath,
  type ClassifyResult,
  type InstallSource,
} from "./pm_detect.ts";
export {
  parseSha256Line,
  type ReleaseAssets,
  releaseAssets,
} from "./manifest.ts";
export {
  type Arch,
  detectTarget,
  type Os,
  type Platform,
  platformFromBuild,
  type Target,
} from "./target.ts";
