/**
 * @module core/profile/chain
 *
 * Profile chain loader. Walks the `extends:` pointer from a leaf specifier
 * up to the root, producing a multi-tier {@linkcode ProfileChain} ordered
 * root → leaf.
 *
 * Phase 3 scope: local specifiers only, cycle + depth detection. Git
 * specifiers in the chain still emit the Phase-4 stub error. The
 * {@linkcode EffectiveProfile} is still a placeholder — Task 3.8 wires the
 * real merge.
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

  // Effective profile is still a placeholder — Task 3.8 wires real merge.
  const placeholderEffective = buildPlaceholderEffective(tiers);

  return {
    chain: { tiers, effective: placeholderEffective },
    diagnostics,
  };
}

/**
 * Canonical cycle-detection key for a resolved local specifier. Two
 * specifiers that resolve to the same directory are the same tier.
 */
function specifierKey(
  spec: Extract<ProfileSpecifier, { kind: "local" }>,
  contextDir: string,
): string {
  return `local:${resolvePath(contextDir, spec.path)}`;
}

/**
 * Placeholder EffectiveProfile — Task 3.8 replaces with real merge output.
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
