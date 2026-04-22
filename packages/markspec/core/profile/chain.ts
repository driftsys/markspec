/**
 * @module core/profile/chain
 *
 * Profile chain loader. Walks the `extends:` pointer from a leaf specifier
 * up to the root, producing a multi-tier {@linkcode ProfileChain} ordered
 * root → leaf.
 *
 * Phase 3 scope: local specifiers only, cycle + depth detection. Git
 * specifiers in the chain still emit the Phase-4 stub error. The chain's
 * {@linkcode EffectiveProfile} is produced by {@linkcode mergeChain}.
 */

import { resolve as resolvePath } from "@std/path";
import type { ReadFile } from "../config/mod.ts";
import type {
  Diagnostic,
  EffectiveProfile,
  LoadedProfile,
  ProfileChain,
  ProfileSpecifier,
} from "../model/mod.ts";
import { parseManifest } from "./manifest.ts";
import { mergeChain } from "./merge.ts";
import { resolveLocalSpecifier } from "./resolver.ts";

/** Maximum number of tiers allowed in an `extends:` chain. */
const MAX_CHAIN_DEPTH = 20;

/** Result of loading a profile chain. */
export interface LoadChainResult {
  readonly chain: ProfileChain | null;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Load a profile chain from a specifier, walking the `extends:` pointer up
 * to the root. The returned chain's tiers are ordered root → leaf, so
 * `tiers[0]` is the ultimate ancestor and `tiers[last]` is the leaf
 * specified by the caller.
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

  // Walk extends: chain. Accumulate tiers leaf-first, reverse at the end.
  const tiersLeafFirst: LoadedProfile[] = [];
  const visited = new Set<string>(); // canonical specifier key
  let cursorSpec: ProfileSpecifier | undefined = specifier;
  let cursorDir = contextDir;

  while (cursorSpec !== undefined) {
    if (cursorSpec.kind === "git") {
      diagnostics.push({
        code: "PROFILE-LOAD-001",
        severity: "error",
        message:
          "git profile specifiers in extends: chain are not supported yet " +
          "(landing in Phase 4)",
        location: { file: "<specifier>", line: 1, column: 1 },
      });
      return { chain: null, diagnostics };
    }

    const key = specifierKey(cursorSpec, cursorDir);
    if (visited.has(key)) {
      diagnostics.push({
        code: "PROFILE-LOAD-004",
        severity: "error",
        message: `profile extends: cycle detected at ${cursorSpec.path} ` +
          `(already visited in this chain)`,
        location: { file: "<specifier>", line: 1, column: 1 },
      });
      return { chain: null, diagnostics };
    }
    visited.add(key);

    if (tiersLeafFirst.length >= MAX_CHAIN_DEPTH) {
      diagnostics.push({
        code: "PROFILE-LOAD-005",
        severity: "error",
        message:
          `profile extends: chain exceeds maximum depth (${MAX_CHAIN_DEPTH})`,
        location: { file: "<specifier>", line: 1, column: 1 },
      });
      return { chain: null, diagnostics };
    }

    const resolved = await resolveLocalSpecifier(
      cursorSpec,
      cursorDir,
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
      specifier: cursorSpec,
      manifest: parsed.manifest,
      sourcePath: resolved.sourcePath,
      baseDir: resolved.baseDir,
    };
    tiersLeafFirst.push(tier);

    // Advance cursor to the parent, if any.
    if (parsed.manifest.extends !== undefined) {
      cursorSpec = parsed.manifest.extends;
      cursorDir = resolved.baseDir;
    } else {
      cursorSpec = undefined;
    }
  }

  // Reverse so tiers[0] = root parent, tiers[last] = leaf child.
  const tiers = tiersLeafFirst.reverse();

  // Build a temporary chain shape to feed into mergeChain. It reads only
  // .tiers; the placeholder effective is ignored by merge.
  const stubChain: ProfileChain = {
    tiers,
    effective: buildPlaceholderEffective(tiers),
  };
  const mergeResult = mergeChain(stubChain);
  diagnostics.push(...mergeResult.diagnostics);
  if (!mergeResult.effective) {
    return { chain: null, diagnostics };
  }

  return {
    chain: { tiers, effective: mergeResult.effective },
    diagnostics,
  };
}

/**
 * Canonical cycle-detection key for a resolved local specifier. Two specifiers
 * that resolve to the same directory (after path normalization: `.`, `..`)
 * are the same tier.
 *
 * Note: this does NOT canonicalize symlinks. Two different symlinked paths
 * pointing at the same profile will only be caught by MAX_CHAIN_DEPTH, which
 * emits PROFILE-LOAD-005 instead of PROFILE-LOAD-004. Acceptable for v1 since
 * Deno.realPath would require an additional I/O round-trip and a filesystem
 * shim for the test mock reader. Revisit when git cache paths (Phase 4) make
 * symlink resolution more likely in practice.
 */
function specifierKey(
  spec: Extract<ProfileSpecifier, { kind: "local" }>,
  contextDir: string,
): string {
  return `local:${resolvePath(contextDir, spec.path)}`;
}

/**
 * Build a placeholder EffectiveProfile used only as a stub input when
 * constructing the {@linkcode ProfileChain} shape we hand to
 * {@linkcode mergeChain}. `mergeChain` reads only `.tiers`, so the stub
 * contents are irrelevant.
 */
function buildPlaceholderEffective(
  tiers: readonly LoadedProfile[],
): EffectiveProfile {
  const leafOrigin = tiers[tiers.length - 1]?.id ?? "<unknown>";
  return {
    required: { value: [], origin: leafOrigin },
    attributes: new Map(),
    labels: { value: [], origin: leafOrigin },
    identified: {
      required: { value: [], origin: leafOrigin },
      attributes: new Map(),
      traceability: new Map(),
    },
    referenced: {
      required: { value: [], origin: leafOrigin },
      attributes: new Map(),
      traceability: new Map(),
    },
    types: new Map(),
    documents: { types: new Map(), frontMatter: new Map() },
  };
}
