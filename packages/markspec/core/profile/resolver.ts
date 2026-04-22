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
import { computeCacheLocation, defaultRunGit } from "./git-cache.ts";
import type { RunGit } from "./git-cache.ts";

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

/** Options accepted by {@linkcode resolveGitSpecifier}. */
export interface ResolveGitOptions {
  /** Injectable git runner — defaults to {@linkcode defaultRunGit}. */
  readonly runGit?: RunGit;
}

/**
 * Resolve a git specifier via a per-project shallow+sparse clone cache.
 *
 * On cache hit: reads `markspec.yaml` from the cached location.
 * On cache miss: Task 4.4 implements the clone; for now emits
 * `PROFILE-LOAD-001`.
 *
 * @param specifier - The git-kind specifier
 * @param projectRoot - Absolute path of the project root (holds `.markspec/cache/`)
 * @param readFile - File reader abstraction
 * @param diagnostics - Accumulator for errors
 * @param opts - Injectable runner (optional, defaults to real `git`)
 */
export async function resolveGitSpecifier(
  specifier: Extract<ProfileSpecifier, { kind: "git" }>,
  projectRoot: string,
  readFile: ReadFile,
  diagnostics: Diagnostic[],
  opts: ResolveGitOptions = {},
): Promise<ResolvedProfileSource | null> {
  // Silence the "runGit is unused" lint — Task 4.4 wires it in.
  const _runGit = opts.runGit ?? defaultRunGit;
  void _runGit;

  const location = await computeCacheLocation(projectRoot, {
    repo: specifier.repo,
    subpath: specifier.subpath,
    tag: specifier.tag,
  });

  const rawYaml = await readFile(location.manifestPath);
  if (rawYaml !== undefined) {
    return {
      rawYaml,
      sourcePath: location.manifestPath,
      baseDir: specifier.subpath !== undefined
        // baseDir is the directory containing the manifest (subpath-relative
        // when subpath is set so the profile's own extends: resolves against
        // the profile's directory, not the repo root).
        ? location.manifestPath.slice(0, -"/markspec.yaml".length)
        : location.dir,
    };
  }

  diagnostics.push({
    code: "PROFILE-LOAD-001",
    severity: "error",
    message: `git profile cache miss at ${location.dir} ` +
      `(Phase 4 Task 4.4 will replace this with a clone on miss)`,
    location: { file: location.dir, line: 1, column: 1 },
  });
  return null;
}
