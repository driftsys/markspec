/**
 * @module core/self_upgrade/target
 *
 * Map (os, arch) → the GitHub release target string used in tarball
 * names. Targets match those produced by the Release workflow:
 *   x86_64-unknown-linux-gnu, aarch64-unknown-linux-gnu,
 *   x86_64-apple-darwin, aarch64-apple-darwin, x86_64-pc-windows-msvc.
 *
 * Pure functions — no I/O, no Deno.* APIs. The CLI passes
 * `Deno.build.os` / `Deno.build.arch` strings to platformFromBuild;
 * this module never reads them itself so tests don't need any
 * environment setup.
 */

export type Os = "linux" | "darwin" | "windows";
export type Arch = "x86_64" | "aarch64";

export interface Platform {
  readonly os: Os;
  readonly arch: Arch;
}

export type Target =
  | "x86_64-unknown-linux-gnu"
  | "aarch64-unknown-linux-gnu"
  | "x86_64-apple-darwin"
  | "aarch64-apple-darwin"
  | "x86_64-pc-windows-msvc";

/** Return the release target for a platform, or undefined if not shipped. */
export function detectTarget(platform: Platform): Target | undefined {
  const { os, arch } = platform;
  if (os === "linux" && arch === "x86_64") return "x86_64-unknown-linux-gnu";
  if (os === "linux" && arch === "aarch64") return "aarch64-unknown-linux-gnu";
  if (os === "darwin" && arch === "x86_64") return "x86_64-apple-darwin";
  if (os === "darwin" && arch === "aarch64") return "aarch64-apple-darwin";
  if (os === "windows" && arch === "x86_64") return "x86_64-pc-windows-msvc";
  return undefined;
}

/** Parse Deno.build.{os,arch} strings into a typed Platform, or undefined. */
export function platformFromBuild(
  os: string,
  arch: string,
): Platform | undefined {
  const okOs = os === "linux" || os === "darwin" || os === "windows";
  const okArch = arch === "x86_64" || arch === "aarch64";
  if (!okOs || !okArch) return undefined;
  return { os, arch } as Platform;
}
