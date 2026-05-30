/**
 * @module installToPath
 *
 * Pure planning + filesystem copy for the "Install CLI to PATH" command.
 * Deliberately imports NO `vscode` — the command handler in extension.ts
 * supplies the notifications. Pure functions are unit-tested directly.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** A resolved copy plan: where the bundled binary is and where it goes. */
export interface InstallPlan {
  readonly source: string;
  readonly targetDir: string;
  readonly target: string;
  readonly binaryName: string;
  readonly chmod: boolean;
}

/** Resolve the copy plan for the current platform. Pure. */
export function planInstall(input: {
  platform: NodeJS.Platform;
  homedir: string;
  extensionPath: string;
}): InstallPlan {
  const binaryName = input.platform === "win32" ? "markspec.exe" : "markspec";
  const targetDir = path.join(input.homedir, ".local", "bin");
  return {
    binaryName,
    source: path.join(input.extensionPath, "bin", binaryName),
    targetDir,
    target: path.join(targetDir, binaryName),
    chmod: input.platform !== "win32",
  };
}

/** Whether `targetDir` is a member of the PATH-style `pathEnv`. Pure. */
export function isDirOnPath(
  targetDir: string,
  pathEnv: string | undefined,
  delimiter: string,
  platform: NodeJS.Platform,
): boolean {
  if (!pathEnv) return false;
  const norm = (s: string) =>
    platform === "win32" ? s.trim().toLowerCase() : s.trim();
  const needle = norm(targetDir);
  return pathEnv.split(delimiter).map(norm).includes(needle);
}

/** The shell command that adds `targetDir` to PATH. Pure. */
export function pathHint(
  targetDir: string,
  platform: NodeJS.Platform,
): string {
  return platform === "win32"
    ? `setx PATH "${targetDir};%PATH%"`
    : `export PATH="${targetDir}:$PATH"`;
}

/** mkdir -p, copy (overwrite), and chmod 0o755 on Unix. */
export async function performCopy(plan: InstallPlan): Promise<void> {
  await fs.mkdir(plan.targetDir, { recursive: true });
  await fs.copyFile(plan.source, plan.target);
  if (plan.chmod) await fs.chmod(plan.target, 0o755);
}

/** Convenience for the handler: build the plan for this process. */
export function planForHost(extensionPath: string): InstallPlan {
  return planInstall({
    platform: process.platform,
    homedir: os.homedir(),
    extensionPath,
  });
}
