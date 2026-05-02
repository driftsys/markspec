/**
 * @module core/profile/npm
 *
 * Resolve an npm profile specifier by downloading the package tarball
 * via `npm pack` and extracting `markspec.yaml` from it. Results are
 * cached under the global XDG cache directory.
 */

import { join } from "@std/path";
import type { Diagnostic, ProfileSpecifier } from "../model/mod.ts";
import type { ResolvedProfileSource } from "./resolver.ts";

/** Result of running an npm command. Same shape as {@linkcode RunGit}. */
export type RunNpm = (
  args: readonly string[],
  cwd?: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Options for {@linkcode resolveNpmSpecifier}. */
export interface ResolveNpmOptions {
  /** Injectable npm runner — defaults to {@linkcode defaultRunNpm}. */
  readonly runNpm?: RunNpm;
  /** Global cache root (from {@linkcode cacheDir}). */
  readonly cacheRoot: string;
  /** File reader — returns contents or undefined if missing. */
  readonly readFile: (path: string) => Promise<string | undefined>;
  /** Pre-resolved version for cache lookup (testing only). */
  readonly resolvedVersion?: string;
  /** Injectable temp dir creator — defaults to `Deno.makeTempDir`. */
  readonly makeTempDir?: () => Promise<string>;
  /** Injectable temp dir remover — defaults to `Deno.remove`. */
  readonly removeTempDir?: (path: string) => Promise<void>;
}

/** Default npm runner using `Deno.Command`. */
export async function defaultRunNpm(
  args: readonly string[],
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command("npm", {
    args: [...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await cmd.output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

/**
 * Build the cache directory path for an npm package.
 * Layout: `<cacheRoot>/npm/@scope/name/<version>/` or `<cacheRoot>/npm/name/<version>/`
 */
function npmCacheDir(
  cacheRoot: string,
  spec: Extract<ProfileSpecifier, { kind: "npm" }>,
  version: string,
): string {
  return spec.scope
    ? join(cacheRoot, "npm", spec.scope, spec.name, version)
    : join(cacheRoot, "npm", spec.name, version);
}

/** Extract semver from a tarball filename like `profile-default-1.0.0.tgz`. */
export function extractVersionFromTarball(filename: string): string | null {
  const match = filename.match(
    /(\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?)\.tgz$/,
  );
  return match ? match[1] : null;
}

/**
 * Resolve an npm specifier into a {@linkcode ResolvedProfileSource}.
 *
 * 1. Check the cache for an existing resolution
 * 2. On miss, run `npm pack <pkg>@<range> --pack-destination <tmpdir>`
 * 3. Extract `markspec.yaml` from the tarball
 * 4. Cache to `<cacheRoot>/npm/<pkg>/<version>/`
 * 5. Return the resolved source
 */
export async function resolveNpmSpecifier(
  specifier: Extract<ProfileSpecifier, { kind: "npm" }>,
  diagnostics: Diagnostic[],
  opts: ResolveNpmOptions,
): Promise<ResolvedProfileSource | null> {
  const runNpm = opts.runNpm ?? defaultRunNpm;
  const pkgName = specifier.scope
    ? `${specifier.scope}/${specifier.name}`
    : specifier.name;
  const pkgWithRange = `${pkgName}@${specifier.range}`;

  // Cache hit — if we know the version, check for cached manifest.
  if (opts.resolvedVersion) {
    const cachedDir = npmCacheDir(
      opts.cacheRoot,
      specifier,
      opts.resolvedVersion,
    );
    const cachedManifest = join(cachedDir, "markspec.yaml");
    const cached = await opts.readFile(cachedManifest);
    if (cached !== undefined) {
      return {
        rawYaml: cached,
        sourcePath: cachedManifest,
        baseDir: cachedDir,
      };
    }
  }

  // Run npm pack to download the tarball.
  let tmpDir: string | undefined;
  const mkTmp = opts.makeTempDir ??
    (() => Deno.makeTempDir({ prefix: "markspec-npm-" }));
  const rmTmp = opts.removeTempDir ??
    ((p: string) => Deno.remove(p, { recursive: true }));
  try {
    tmpDir = await mkTmp();
    const packResult = await runNpm([
      "pack",
      pkgWithRange,
      "--pack-destination",
      tmpDir,
    ]);

    if (packResult.code !== 0) {
      // Distinguish npm-not-found from package-not-found.
      const stderr = packResult.stderr.toLowerCase();
      if (
        packResult.code === 127 ||
        stderr.includes("command not found") ||
        stderr.includes("not recognized")
      ) {
        diagnostics.push({
          code: "PROFILE-ADD-004",
          severity: "error",
          message:
            `npm is not installed or not in PATH; cannot resolve '${pkgWithRange}'`,
          location: { file: "<specifier>", line: 1, column: 1 },
        });
      } else {
        diagnostics.push({
          code: "PROFILE-LOAD-001",
          severity: "error",
          message:
            `npm pack failed for '${pkgWithRange}': ${packResult.stderr.trim()}`,
          location: { file: "<specifier>", line: 1, column: 1 },
        });
      }
      return null;
    }

    // Find the tarball in tmpDir.
    const stdout = packResult.stdout.trim();
    const tarballName = stdout.split("\n").pop()?.trim();
    if (!tarballName) {
      diagnostics.push({
        code: "PROFILE-LOAD-001",
        severity: "error",
        message: `npm pack for '${pkgWithRange}' produced no output`,
        location: { file: "<specifier>", line: 1, column: 1 },
      });
      return null;
    }

    const version = extractVersionFromTarball(tarballName);
    if (!version) {
      diagnostics.push({
        code: "PROFILE-LOAD-001",
        severity: "error",
        message: `cannot extract version from tarball '${tarballName}'`,
        location: { file: "<specifier>", line: 1, column: 1 },
      });
      return null;
    }

    // Check cache again with the resolved version.
    const cacheTargetDir = npmCacheDir(opts.cacheRoot, specifier, version);
    const cacheManifestPath = join(cacheTargetDir, "markspec.yaml");
    const existingCached = await opts.readFile(cacheManifestPath);
    if (existingCached !== undefined) {
      return {
        rawYaml: existingCached,
        sourcePath: cacheManifestPath,
        baseDir: cacheTargetDir,
      };
    }

    // Extract tarball into cache directory.
    await Deno.mkdir(cacheTargetDir, { recursive: true });
    const tgzPath = join(tmpDir, tarballName);
    const tarResult = await runTar(tgzPath, cacheTargetDir);
    if (tarResult.code !== 0) {
      diagnostics.push({
        code: "PROFILE-LOAD-001",
        severity: "error",
        message:
          `tar extraction failed for '${tarballName}': ${tarResult.stderr.trim()}`,
        location: { file: tgzPath, line: 1, column: 1 },
      });
      return null;
    }

    // Read the manifest from extracted contents.
    const rawYaml = await opts.readFile(cacheManifestPath);
    if (rawYaml === undefined) {
      diagnostics.push({
        code: "PROFILE-LOAD-001",
        severity: "error",
        message: `npm package '${pkgWithRange}' does not contain markspec.yaml`,
        location: { file: cacheManifestPath, line: 1, column: 1 },
      });
      return null;
    }

    return { rawYaml, sourcePath: cacheManifestPath, baseDir: cacheTargetDir };
  } finally {
    if (tmpDir) {
      try {
        await rmTmp(tmpDir);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

/** Extract a .tgz tarball, stripping the top-level `package/` directory. */
async function runTar(
  tgzPath: string,
  targetDir: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command("tar", {
    args: ["xzf", tgzPath, "--strip-components=1", "-C", targetDir],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await cmd.output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}
