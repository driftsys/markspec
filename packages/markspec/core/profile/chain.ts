/**
 * @module core/profile/chain
 *
 * Profile chain loader. Walks the `extends:` pointer from a leaf specifier
 * up to the root, producing a multi-tier {@linkcode ProfileChain} ordered
 * root → leaf.
 *
 * Supports both local and git specifiers, with cycle + depth detection. Git
 * specifiers route through {@linkcode resolveGitSpecifier} (per-project
 * shallow+sparse clone cache); local specifiers route through
 * {@linkcode resolveLocalSpecifier}. The chain's {@linkcode EffectiveProfile}
 * is produced by {@linkcode mergeChain}.
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
import type { AppendFile, RunGit } from "./git-cache.ts";
import { parseManifest } from "./manifest.ts";
import { mergeChain } from "./merge.ts";
import {
  type ResolvedProfileSource,
  resolveGitSpecifier,
  resolveLocalSpecifier,
} from "./resolver.ts";

/** Maximum number of tiers allowed in an `extends:` chain. */
const MAX_CHAIN_DEPTH = 20;

/** Result of loading a profile chain. */
export interface LoadChainResult {
  readonly chain: ProfileChain | null;
  readonly diagnostics: readonly Diagnostic[];
}

/** Options accepted by {@linkcode loadChain}. */
export interface LoadChainOptions {
  readonly runGit?: RunGit;
  readonly appendFile?: AppendFile;
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
 * @param projectRoot - Absolute path of the project root (used to locate
 *                     the `.markspec/cache/` directory for git specifiers)
 * @param readFile - File reader abstraction
 * @param opts - Injectable runners for git-cache operations (optional)
 */
export async function loadChain(
  specifier: ProfileSpecifier,
  contextDir: string,
  projectRoot: string,
  readFile: ReadFile,
  opts: LoadChainOptions = {},
): Promise<LoadChainResult> {
  const diagnostics: Diagnostic[] = [];

  // Walk extends: chain. Accumulate tiers leaf-first, reverse at the end.
  const tiersLeafFirst: LoadedProfile[] = [];
  const visited = new Set<string>(); // canonical specifier key
  let cursorSpec: ProfileSpecifier | undefined = specifier;
  let cursorDir = contextDir;

  while (cursorSpec !== undefined) {
    const key = specifierKey(cursorSpec, cursorDir);
    if (visited.has(key)) {
      diagnostics.push({
        code: "PROFILE-LOAD-004",
        severity: "error",
        message:
          `profile extends: cycle detected at ${stringifySpec(cursorSpec)} ` +
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

    let resolved: ResolvedProfileSource | null;
    if (cursorSpec.kind === "git") {
      resolved = await resolveGitSpecifier(
        cursorSpec,
        projectRoot,
        readFile,
        diagnostics,
        { runGit: opts.runGit, appendFile: opts.appendFile },
      );
    } else if (cursorSpec.kind === "npm") {
      // npm resolution wired in Task 4
      diagnostics.push({
        code: "PROFILE-LOAD-001",
        severity: "error",
        message: `npm specifier '${
          stringifySpec(cursorSpec)
        }' not yet supported in chain resolution`,
        location: { file: "<specifier>", line: 1, column: 1 },
      });
      resolved = null;
    } else {
      resolved = await resolveLocalSpecifier(
        cursorSpec,
        cursorDir,
        readFile,
        diagnostics,
      );
    }
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
 * Canonical cycle-detection key for a resolved specifier. Two specifiers that
 * resolve to the same tier are canonicalized to the same key:
 *
 * - Local specifiers key on the absolute resolved directory (after
 *   normalization of `.` / `..`).
 * - Git specifiers key on `(repo, tag, subpath)`, which is what the git cache
 *   itself uses — two specifiers that hit the same cache entry are the same
 *   tier.
 *
 * Note: this does NOT canonicalize symlinks for local specifiers. Two
 * different symlinked paths pointing at the same profile will only be caught
 * by MAX_CHAIN_DEPTH, which emits PROFILE-LOAD-005 instead of
 * PROFILE-LOAD-004. Acceptable for v1 since `Deno.realPath` would require an
 * additional I/O round-trip and a filesystem shim for the test mock reader.
 */
function specifierKey(
  spec: ProfileSpecifier,
  contextDir: string,
): string {
  if (spec.kind === "local") {
    return `local:${resolvePath(contextDir, spec.path)}`;
  }
  if (spec.kind === "git") {
    return `git:${spec.repo}#${spec.tag}|${spec.subpath ?? ""}`;
  }
  if (spec.kind === "npm") {
    const pkg = spec.scope ? `${spec.scope}/${spec.name}` : spec.name;
    return `npm:${pkg}@${spec.range}`;
  }
  const _exhaustive: never = spec;
  throw new Error(`Unknown specifier kind`);
}

/** Human-readable one-liner for a specifier (used in diagnostic messages). */
function stringifySpec(spec: ProfileSpecifier): string {
  if (spec.kind === "local") {
    return spec.path;
  }
  if (spec.kind === "git") {
    return `git+${spec.repo}#${spec.tag}`;
  }
  if (spec.kind === "npm") {
    const pkg = spec.scope ? `${spec.scope}/${spec.name}` : spec.name;
    return `npm:${pkg}@${spec.range}`;
  }
  const _exhaustive: never = spec;
  throw new Error(`Unknown specifier kind`);
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
