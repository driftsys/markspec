/**
 * @module core/self_upgrade/pm_detect
 *
 * Classify the realpath of the running binary into one of five
 * install-source buckets so the self-upgrade orchestrator can refuse
 * with a per-manager hint instead of fighting the package manager.
 *
 * The check is heuristic and order-sensitive — Homebrew first (because
 * brew's bin paths live under /opt/homebrew or /usr/local), npm second,
 * cargo third, user-local fourth, system fifth. Anything that falls
 * through is "unknown" and the orchestrator proceeds with a warning.
 *
 * Path matching is whole-segment (path separator on both sides) to
 * avoid matching e.g. `/foo/.localfish/markspec` against the user-local
 * `.local` rule.
 *
 * Pure — no I/O. Callers must pass the realpath (symlinks resolved) so
 * brew's `/opt/homebrew/bin/markspec` -> `/opt/homebrew/Cellar/.../bin/markspec`
 * is classified correctly.
 */

export type InstallSource =
  | "user-local"
  | "homebrew"
  | "npm"
  | "cargo"
  | "system"
  | "unknown";

export interface ClassifyResult {
  readonly source: InstallSource;
  readonly hintCommand?: string;
}

export function classifyInstallPath(
  realPath: string,
  home: string,
): ClassifyResult {
  // Normalise to forward slashes for matching. Windows paths use '\';
  // we accept both by replacing.
  const p = realPath.replace(/\\/g, "/");
  const h = home.replace(/\\/g, "/");

  // 1. Homebrew. The Cellar segment is the canonical real-path marker;
  //    /opt/homebrew/ on its own catches symlink-without-realpath.
  if (
    p.includes("/Cellar/") ||
    p.startsWith("/opt/homebrew/")
  ) {
    return { source: "homebrew", hintCommand: "brew upgrade markspec" };
  }

  // 2. npm. node_modules, .npm/, .nvm/.
  if (
    p.includes("/node_modules/") ||
    p.includes("/.nvm/") ||
    p.includes("/.npm/")
  ) {
    return { source: "npm", hintCommand: "npm update -g markspec" };
  }

  // 3. Cargo (`~/.cargo/bin`). A package-manager location like Homebrew/npm,
  //    so it is refused rather than overwritten — self-upgrade's rename-swap
  //    would leave cargo's own metadata stale (#575). Checked before the
  //    user-local rule, which would otherwise claim `.cargo/bin/`.
  if (h && p.startsWith(`${h}/.cargo/bin/`)) {
    return { source: "cargo", hintCommand: "cargo install markspec --force" };
  }

  // 4. user-local paths under $HOME.
  if (h && p.startsWith(`${h}/`)) {
    const tail = p.slice(h.length + 1);
    if (
      tail.startsWith(".local/") ||
      tail.startsWith("bin/") ||
      tail.startsWith("Library/")
    ) {
      return { source: "user-local" };
    }
  }

  // 5. system bins.
  if (
    p.startsWith("/usr/") ||
    p.startsWith("/opt/") ||
    p.startsWith("/snap/")
  ) {
    return { source: "system" };
  }

  return { source: "unknown" };
}
