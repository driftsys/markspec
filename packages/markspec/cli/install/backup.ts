/**
 * @module cli/install/backup
 *
 * Timestamped sidecar backup. Per toolchain-distribution.md §6.3, every
 * apply (not no-op re-runs) writes a `<path>.markspec-bak-<ISO8601>`
 * file alongside the original before mutating. ISO 8601 with `:`
 * replaced by `-` so the filename is portable across all platforms.
 *
 * Pruning is the user's / OS's responsibility (§8 D2 — "no pruning in v1").
 */

/**
 * Compute the sidecar backup path for an original file.
 *
 * @param originalPath - The original file path.
 * @param now - The timestamp to use for the backup suffix.
 * @returns The path of the timestamped backup file.
 */
export function backupPath(originalPath: string, now: Date): string {
  const iso = now.toISOString().replace(/\.\d+Z$/, "Z").replaceAll(":", "-");
  return `${originalPath}.markspec-bak-${iso}`;
}

/**
 * Copy the original file to a timestamped sidecar backup.
 *
 * @param originalPath - The original file path. Caller must verify it exists.
 * @returns The path to the created backup file.
 * @throws If the source file does not exist or cannot be read.
 */
export async function writeBackup(originalPath: string): Promise<string> {
  const target = backupPath(originalPath, new Date());
  await Deno.copyFile(originalPath, target);
  return target;
}
