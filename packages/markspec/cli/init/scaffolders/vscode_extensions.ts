/**
 * @module cli/init/scaffolders/vscode_extensions
 *
 * Scaffolder for `.vscode/extensions.json`. Adds
 * `driftsys.markspec-ide` to the `recommendations[]` array, creating
 * the file when absent and preserving every other key when merging.
 * Refuses (returns "skip:malformed-json") if the existing file is
 * not valid JSON — repair is the user's responsibility.
 */

import { join } from "@std/path";
import type { MemFs } from "../fake_fs.ts";

export const EXTENSION_ID = "driftsys.markspec-ide";

export type ScaffoldVscodeAction =
  | "create"
  | "merge"
  | "no-op"
  | "skip:malformed-json";

/**
 * Pure merge of an existing extensions.json text with the markspec
 * recommendation. Returns the new file text, or `null` when no change
 * is needed. Throws on malformed JSON — the scaffolder catches and
 * maps to "skip:malformed-json".
 */
export function mergeVscodeExtensions(existingText: string): string | null {
  const parsed = JSON.parse(existingText);
  const recs: string[] = Array.isArray(parsed.recommendations)
    ? [...parsed.recommendations]
    : [];
  if (recs.includes(EXTENSION_ID)) return null;
  recs.push(EXTENSION_ID);
  const next = { ...parsed, recommendations: recs };
  return JSON.stringify(next, null, 2) + "\n";
}

export async function scaffoldVscodeExtensions(
  fs: MemFs,
  targetDir: string,
): Promise<ScaffoldVscodeAction> {
  const path = join(targetDir, ".vscode/extensions.json");
  const existing = await fs.read(path);
  if (existing === undefined) {
    await fs.write(
      path,
      JSON.stringify({ recommendations: [EXTENSION_ID] }, null, 2) + "\n",
    );
    return "create";
  }
  let merged: string | null;
  try {
    merged = mergeVscodeExtensions(existing);
  } catch {
    return "skip:malformed-json";
  }
  if (merged === null) return "no-op";
  await fs.write(path, merged);
  return "merge";
}
