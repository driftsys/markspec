/**
 * @module core/profile/cache
 *
 * XDG-compliant cache directory resolution for profile storage.
 * Profiles fetched from git or npm are cached globally so they can
 * be shared across projects.
 */

import { join } from "@std/path";

/**
 * Environment variables consulted for cache directory resolution.
 * Injectable for testing — production code passes `Deno.env.toObject()`.
 */
export interface CacheEnv {
  readonly XDG_CACHE_HOME?: string;
  readonly HOME?: string;
  readonly LOCALAPPDATA?: string;
}

/**
 * Resolve the global markspec cache directory (XDG-compliant).
 *
 * - `$XDG_CACHE_HOME/markspec` if set (any platform)
 * - macOS: `~/Library/Caches/markspec`
 * - Windows: `%LOCALAPPDATA%/markspec/cache`
 * - Linux/other: `~/.cache/markspec`
 *
 * @param env - Environment variables (injectable for tests)
 * @param platform - OS platform string (injectable for tests; defaults to `Deno.build.os`)
 */
export function cacheDir(
  env?: CacheEnv,
  platform?: string,
): string {
  const e = env ?? envFromDeno();
  const os = platform ?? Deno.build.os;

  if (e.XDG_CACHE_HOME) {
    return join(e.XDG_CACHE_HOME, "markspec");
  }

  if (os === "darwin") {
    const home = e.HOME ?? "/tmp";
    return join(home, "Library", "Caches", "markspec");
  }

  if (os === "windows") {
    const localAppData = e.LOCALAPPDATA ??
      join(e.HOME ?? "C:\\Users\\default", "AppData", "Local");
    return join(localAppData, "markspec", "cache");
  }

  // Linux and others — XDG default
  const home = e.HOME ?? "/tmp";
  return join(home, ".cache", "markspec");
}

function envFromDeno(): CacheEnv {
  return {
    XDG_CACHE_HOME: Deno.env.get("XDG_CACHE_HOME"),
    HOME: Deno.env.get("HOME"),
    LOCALAPPDATA: Deno.env.get("LOCALAPPDATA"),
  };
}
