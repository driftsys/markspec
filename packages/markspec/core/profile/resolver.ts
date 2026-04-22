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
import {
  computeCacheLocation,
  defaultAppendFile,
  defaultRunGit,
  ensureCacheGitignored,
} from "./git-cache.ts";
import type { AppendFile, RunGit } from "./git-cache.ts";

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
  /** Injectable file appender — defaults to {@linkcode defaultAppendFile}. */
  readonly appendFile?: AppendFile;
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
  const runGit = opts.runGit ?? defaultRunGit;

  const location = await computeCacheLocation(projectRoot, {
    repo: specifier.repo,
    subpath: specifier.subpath,
    tag: specifier.tag,
  });

  // Cache hit?
  const cached = await readFile(location.manifestPath);
  if (cached !== undefined) {
    return buildResolvedSource(cached, location, specifier);
  }

  // Cache miss — clone shallow + sparse, then checkout the tag.
  const cloneResult = await runGit([
    "clone",
    "--depth=1",
    `--branch=${specifier.tag}`,
    "--filter=blob:none",
    "--sparse",
    "--no-checkout",
    specifier.repo,
    location.dir,
  ]);
  if (cloneResult.code !== 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-001",
      severity: "error",
      message: `git clone failed for ${specifier.repo}#${specifier.tag}: ` +
        cloneResult.stderr.trim(),
      location: { file: location.dir, line: 1, column: 1 },
    });
    return null;
  }

  // First fetch populated the cache — make sure it's ignored by git.
  await ensureCacheGitignored(
    projectRoot,
    readFile,
    opts.appendFile ?? defaultAppendFile,
  );

  if (specifier.subpath !== undefined) {
    const sparseResult = await runGit(
      ["sparse-checkout", "set", specifier.subpath],
      location.dir,
    );
    if (sparseResult.code !== 0) {
      diagnostics.push({
        code: "PROFILE-LOAD-001",
        severity: "error",
        message:
          `git sparse-checkout failed for ${specifier.repo}#${specifier.tag} ` +
          `subpath '${specifier.subpath}': ${sparseResult.stderr.trim()}`,
        location: { file: location.dir, line: 1, column: 1 },
      });
      return null;
    }
  }

  const checkoutResult = await runGit(
    ["checkout", specifier.tag],
    location.dir,
  );
  if (checkoutResult.code !== 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-001",
      severity: "error",
      message: `git checkout failed for ${specifier.repo}#${specifier.tag}: ` +
        checkoutResult.stderr.trim(),
      location: { file: location.dir, line: 1, column: 1 },
    });
    return null;
  }

  // After clone+checkout, expect the manifest at the computed path.
  const postCloneYaml = await readFile(location.manifestPath);
  if (postCloneYaml === undefined) {
    diagnostics.push({
      code: "PROFILE-LOAD-001",
      severity: "error",
      message:
        `git clone of ${specifier.repo}#${specifier.tag} succeeded but ` +
        `no markspec.yaml at ${location.manifestPath}`,
      location: { file: location.manifestPath, line: 1, column: 1 },
    });
    return null;
  }

  return buildResolvedSource(postCloneYaml, location, specifier);
}

function buildResolvedSource(
  rawYaml: string,
  location: { manifestPath: string; dir: string },
  specifier: Extract<ProfileSpecifier, { kind: "git" }>,
): ResolvedProfileSource {
  const baseDir = specifier.subpath !== undefined
    ? location.manifestPath.slice(0, -"/markspec.yaml".length)
    : location.dir;
  return {
    rawYaml,
    sourcePath: location.manifestPath,
    baseDir,
  };
}
