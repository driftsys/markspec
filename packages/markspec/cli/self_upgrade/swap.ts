/**
 * @module cli/self_upgrade/swap
 *
 * Filesystem helpers for the self-upgrade swap step. Uniform across
 * POSIX and Windows: rename current → .old, move new → current. On
 * POSIX a single atomic rename would suffice (the running process keeps
 * its inode), but Windows can't rename over a running .exe. Using the
 * .old rename-dance everywhere keeps the code path single and tested
 * once. Leftover .old files are cleaned up best-effort on the next
 * self-upgrade run.
 */

import { join } from "@std/path";

/**
 * Probe writability of `dir` by attempting to create + remove a temp
 * file inside it. The probe touches disk; this is intentional —
 * permission bits alone aren't authoritative on every filesystem.
 */
export async function isDirWritable(dir: string): Promise<boolean> {
  const probe = join(dir, `.markspec-write-probe.${Deno.pid}`);
  try {
    await Deno.writeTextFile(probe, "");
    await Deno.remove(probe).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Two-step atomic swap.
 *   1. Rename current → current.old (works on Windows even while running).
 *   2. Rename newPath → current.
 * If step 2 fails, roll back step 1 so the user is left with a working
 * binary.
 */
export async function swapBinary(
  currentPath: string,
  newPath: string,
): Promise<void> {
  const oldPath = `${currentPath}.old`;
  await Deno.remove(oldPath).catch(() => {});
  await Deno.rename(currentPath, oldPath);
  try {
    await Deno.rename(newPath, currentPath);
  } catch (err) {
    // Roll back step 1 so the binary still works.
    await Deno.rename(oldPath, currentPath).catch(() => {});
    throw err;
  }
}

/**
 * Best-effort removal of leftover `<currentPath>.old`. Called at the
 * start of the next self-upgrade run; failures are swallowed silently
 * because on Windows the file can linger while a previous process still
 * holds it open.
 */
export async function cleanupStaleOld(currentPath: string): Promise<void> {
  await Deno.remove(`${currentPath}.old`).catch(() => {});
}
