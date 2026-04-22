/**
 * @module core/profile/load
 *
 * The CLI-facing profile loader. Discovers `.markspec.yaml`, validates it,
 * resolves the active profile specifier, loads the chain, and surfaces any
 * diagnostics. Single entry point consumed by every profile-aware `markspec`
 * subcommand.
 */

import { parseMarkspecYaml, readMarkspecYaml } from "../config/markspec.ts";
import type { ReadFile } from "../config/mod.ts";
import type { Diagnostic, ProfileChain } from "../model/mod.ts";
import { loadChain } from "./chain.ts";

/** Result of `loadProfileForCommand`. */
export interface LoadProfileForCommandResult {
  /** The active profile chain, or `null` when no profile is declared / resolvable. */
  readonly chain: ProfileChain | null;
  /** All diagnostics gathered during loading. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Load the active profile chain for the project at `projectRoot`.
 *
 * Discovery: looks for `.markspec.yaml` at the project root (sibling of
 * `project.yaml`). Absent or empty → `chain: null` (core-only mode).
 *
 * v1 constraint: at most **one** content-bearing profile per project. Two or
 * more entries in `profiles:` produces `PROFILE-LOAD-006` and no chain.
 */
export async function loadProfileForCommand(
  projectRoot: string,
  readFile: ReadFile,
): Promise<LoadProfileForCommandResult> {
  const diagnostics: Diagnostic[] = [];

  const rawYaml = await readMarkspecYaml(projectRoot, readFile);
  if (rawYaml === null) {
    return { chain: null, diagnostics };
  }

  const sourcePath = `${projectRoot}/.markspec.yaml`;
  const parsed = parseMarkspecYaml(rawYaml, sourcePath);
  diagnostics.push(...parsed.diagnostics);
  if (!parsed.config) {
    return { chain: null, diagnostics };
  }

  const { profiles } = parsed.config;
  if (profiles.length === 0) {
    return { chain: null, diagnostics };
  }

  if (profiles.length > 1) {
    diagnostics.push({
      code: "PROFILE-LOAD-006",
      severity: "error",
      message: `.markspec.yaml declares ${profiles.length} profiles; ` +
        "v1 accepts at most one content-bearing profile per project",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { chain: null, diagnostics };
  }

  const chainResult = await loadChain(profiles[0], projectRoot, readFile);
  diagnostics.push(...chainResult.diagnostics);
  return { chain: chainResult.chain, diagnostics };
}
