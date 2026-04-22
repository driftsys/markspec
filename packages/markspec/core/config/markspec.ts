/**
 * @module core/config/markspec
 *
 * Load and validate `.markspec.yaml` — the consumer-project binding that
 * declares which profiles the project uses.
 *
 * Emits diagnostics (MARKSPEC-YAML-*) on parse or schema errors. See
 * [spec §7.6](../../../../docs/superpowers/specs/2026-04-21-adr-008-profile-system-v1-design.md).
 */

import { join } from "@std/path";
import type { ReadFile } from "./mod.ts";

/** The consumer-binding config filename, placed next to `project.yaml`. */
export const MARKSPEC_YAML_FILENAME = ".markspec.yaml";

/**
 * Read a `.markspec.yaml` file at the given project root.
 *
 * @param projectRoot - Absolute path to the directory containing `project.yaml`
 * @param readFile - File reader (returns `undefined` when missing)
 * @returns Raw file contents, or `null` when the file is absent
 */
export async function readMarkspecYaml(
  projectRoot: string,
  readFile: ReadFile,
): Promise<string | null> {
  const path = join(projectRoot, MARKSPEC_YAML_FILENAME);
  const content = await readFile(path);
  return content ?? null;
}
