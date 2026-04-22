/**
 * @module core/profile/resolver
 *
 * Resolve a {@linkcode ProfileSpecifier} into the raw `markspec.yaml`
 * contents + resolved paths, ready for the chain loader to parse.
 *
 * Phase 2 supports local specifiers only. Git specifiers land in Phase 4.
 */

import { join, resolve } from "@std/path";
import type { ReadFile } from "../config/mod.ts";
import type { Diagnostic, ProfileSpecifier } from "../model/mod.ts";

/**
 * A profile that has been located on disk (or in a cache) and read.
 * Ready for the chain loader to hand to `parseManifest`.
 */
export interface ResolvedProfileSource {
  /** Raw `markspec.yaml` contents. */
  readonly rawYaml: string;
  /** Absolute path of `<baseDir>/markspec.yaml`. */
  readonly sourcePath: string;
  /** Absolute directory the profile lives in (used for future extends resolution). */
  readonly baseDir: string;
}

/**
 * Resolve a local specifier. The specifier's `path` is joined to `contextDir`
 * and the `markspec.yaml` inside that directory is read.
 *
 * @param specifier - The local-kind specifier
 * @param contextDir - Absolute path of the directory that declared the specifier
 *                      (the `.markspec.yaml` parent dir for top-level specifiers)
 * @param readFile - File reader abstraction
 * @param diagnostics - Accumulator for emit errors (PROFILE-LOAD-001)
 */
export async function resolveLocalSpecifier(
  specifier: Extract<ProfileSpecifier, { kind: "local" }>,
  contextDir: string,
  readFile: ReadFile,
  diagnostics: Diagnostic[],
): Promise<ResolvedProfileSource | null> {
  const baseDir = resolve(contextDir, specifier.path);
  const sourcePath = join(baseDir, "markspec.yaml");
  const rawYaml = await readFile(sourcePath);
  if (rawYaml === undefined) {
    diagnostics.push({
      code: "PROFILE-LOAD-001",
      severity: "error",
      message: `profile specifier '${specifier.path}' cannot be resolved: ` +
        `no markspec.yaml at ${sourcePath}`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return null;
  }
  return { rawYaml, sourcePath, baseDir };
}
