/**
 * @module cli/install/workspace
 *
 * Workspace marker discovery for `markspec lsp install` / `mcp install`.
 * Walks up from a starting directory looking for any of three accepted
 * markers per toolchain-distribution.md §4.4: markspec.yaml,
 * .markspec.yaml, project.yaml.
 */

import { dirname, join } from "@std/path";

/** Workspace markers in priority order — §4.4 / §8 Q2 resolution. */
export const WORKSPACE_MARKERS: readonly string[] = [
  "markspec.yaml",
  ".markspec.yaml",
  "project.yaml",
] as const;

/**
 * Walk up from `startDir` looking for any workspace marker. Returns the
 * directory containing the first found marker, or `undefined` when the
 * walk reaches the filesystem root without finding any.
 */
export async function findWorkspaceRoot(
  startDir: string,
): Promise<string | undefined> {
  let dir = startDir;
  // Guard against empty startDir to avoid checking markers in current working dir.
  if (dir === "") return undefined;
  while (true) {
    for (const marker of WORKSPACE_MARKERS) {
      try {
        const stat = await Deno.stat(join(dir, marker));
        if (stat.isFile) return dir;
      } catch {
        // Any Deno.stat failure (not found, permission denied, etc.) is
        // treated as "marker not present" — install falls back to user scope.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined; // reached root
    dir = parent;
  }
}

/** Exact stderr line emitted when no marker found and --scope was workspace. */
export const NO_WORKSPACE_MARKER_STDERR =
  "markspec lsp install: no workspace marker found, using --scope=user";
