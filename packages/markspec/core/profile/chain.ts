/**
 * @module core/profile/chain
 *
 * Single-profile chain loader. Composes the resolver and `parseManifest` to
 * produce a one-element {@linkcode ProfileChain}.
 *
 * Phase 2 scope: local specifiers only, no `extends:` walking. A manifest's
 * `extends:` field is parsed (by Phase 1's parser) and preserved on the
 * returned {@linkcode LoadedProfile}, but nothing is fetched for it. Phase 3
 * replaces this with full chain walking + merge.
 */

import type { ReadFile } from "../config/mod.ts";
import type {
  Diagnostic,
  LoadedProfile,
  ProfileChain,
  ProfileSpecifier,
} from "../model/mod.ts";
import { parseManifest } from "./manifest.ts";
import { resolveLocalSpecifier } from "./resolver.ts";

/** Result of loading a profile chain. */
export interface LoadChainResult {
  readonly chain: ProfileChain | null;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Load a profile chain from a specifier. In Phase 2 the returned chain always
 * has exactly one tier.
 *
 * @param specifier - The leaf specifier (from `.markspec.yaml`)
 * @param contextDir - Directory the specifier was declared in (for local
 *                     path resolution)
 * @param readFile - File reader abstraction
 */
export async function loadChain(
  specifier: ProfileSpecifier,
  contextDir: string,
  readFile: ReadFile,
): Promise<LoadChainResult> {
  const diagnostics: Diagnostic[] = [];

  if (specifier.kind === "git") {
    diagnostics.push({
      code: "PROFILE-LOAD-001",
      severity: "error",
      message: "git profile specifiers are not supported in v1 Phase 2 " +
        "(landing in Phase 4); use a local './path' specifier for now",
      location: { file: "<specifier>", line: 1, column: 1 },
    });
    return { chain: null, diagnostics };
  }

  const resolved = await resolveLocalSpecifier(
    specifier,
    contextDir,
    readFile,
    diagnostics,
  );
  if (!resolved) {
    return { chain: null, diagnostics };
  }

  const parsed = parseManifest(resolved.rawYaml, resolved.sourcePath);
  diagnostics.push(...parsed.diagnostics);
  if (!parsed.manifest) {
    return { chain: null, diagnostics };
  }

  const tier: LoadedProfile = {
    id: parsed.manifest.id,
    version: parsed.manifest.version,
    specifier,
    manifest: parsed.manifest,
    sourcePath: resolved.sourcePath,
    baseDir: resolved.baseDir,
  };

  return { chain: { tiers: [tier] }, diagnostics };
}
