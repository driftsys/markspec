/**
 * @module core/lock/upstream_deps
 *
 * Lock-mediated acquisition of org-manifest `dependencies:` git repositories
 * (design §4.3), the sibling of `upstream_refs.ts`. Unlike a `references:`
 * published site (fetched as ready JSON), a dependency is a git tree we
 * resolve, acquire at one sha, and compile in-process into the same cache
 * layout. Three flows: first-lock (resolve intent → acquire → compile → pin),
 * keep/restore (pin exists → verify cache offline, re-acquire the *pinned* sha
 * only to repopulate), update (`--update` → re-resolve + move the pin).
 *
 * Warn-and-write policy (design §4.2, decision 1): an unreachable dependency
 * yields a warning and the resolvable pins still lock. Pure — git, fs, and
 * temp-dir access flow through {@linkcode UpstreamDepsIO}.
 */

import { join } from "@std/path";
import type { Diagnostic, ProjectRef } from "../model/mod.ts";
import type { UpstreamDependency } from "./model.ts";
import type { ReadFile } from "./resolve.ts";
import { deriveUpstreamId, probeCacheSnapshot } from "./upstream_refs.ts";
import { type RefList, resolveIntent } from "./git_intent.ts";
import type { CompiledSnapshot } from "./acquire_compile.ts";

export interface GitIO {
  lsRemote(url: string): Promise<RefList | { error: string }>;
  acquireTree(
    url: string,
    sha: string,
    destDir: string,
  ): Promise<{ error?: string }>;
}

export interface UpstreamDepsIO {
  readonly git: GitIO;
  readonly compileTree: (
    treeRoot: string,
  ) => Promise<CompiledSnapshot | { error: string }>;
  readonly readFile: ReadFile;
  readonly writeFile: (
    path: string,
    bytes: Uint8Array,
  ) => Promise<{ error?: string }>;
  readonly makeTempDir: () => Promise<string>;
  readonly removeDir: (path: string) => Promise<void>;
}

export interface ResolveProjectDependenciesOptions {
  readonly dependencies: readonly ProjectRef[];
  readonly existing: readonly UpstreamDependency[];
  readonly cacheRoot: string;
  readonly update: boolean | string;
  readonly io: UpstreamDepsIO;
  readonly lockedAt: string;
}

export interface ResolveProjectDependenciesResult {
  readonly dependencies: UpstreamDependency[];
  readonly diagnostics: Diagnostic[];
}

/** Warn-and-write diagnostic — one dependency could not be locked (decision 1). */
function l213(id: string, detail: string): Diagnostic {
  return {
    code: "MSL-L213",
    severity: "warning",
    message: `upstream dependency '${id}' could not be locked: ${detail}`,
    location: undefined,
  };
}

/** Acquire the tree at `sha` into a fresh temp dir, compile it, clean up. */
async function acquireAndCompile(
  url: string,
  sha: string,
  io: UpstreamDepsIO,
): Promise<CompiledSnapshot | { error: string }> {
  const tmp = await io.makeTempDir();
  try {
    const acq = await io.git.acquireTree(url, sha, tmp);
    if (acq.error !== undefined) {
      return { error: `acquire ${sha.slice(0, 12)} failed (${acq.error})` };
    }
    return await io.compileTree(tmp);
  } finally {
    await io.removeDir(tmp);
  }
}

/** Write `manifest.json` + `compiled.json` for a snapshot under `dir`. */
async function writeSnapshotCache(
  dir: string,
  snap: CompiledSnapshot,
  io: UpstreamDepsIO,
): Promise<Diagnostic | undefined> {
  const writes: Array<[string, Uint8Array]> = [
    [
      join(dir, "manifest.json"),
      new TextEncoder().encode(JSON.stringify(snap.manifestJson, null, 2)),
    ],
    [join(dir, "compiled.json"), snap.compiledBytes],
  ];
  for (const [path, bytes] of writes) {
    const res = await io.writeFile(path, bytes);
    if (res.error !== undefined) {
      return l213(dir, `cache write of '${path}' failed (${res.error})`);
    }
  }
  return undefined;
}

export async function resolveProjectDependencies(
  opts: ResolveProjectDependenciesOptions,
): Promise<ResolveProjectDependenciesResult> {
  const dependencies: UpstreamDependency[] = [];
  const diagnostics: Diagnostic[] = [];
  const byId = new Map(opts.existing.map((row) => [row.id, row]));
  const seen = new Set<string>();

  for (const ref of opts.dependencies) {
    const id = deriveUpstreamId(ref);
    if (id === undefined) {
      diagnostics.push(l213(
        ref.name ?? ref.url,
        "no safe upstream id could be derived — set an explicit 'name:'",
      ));
      continue;
    }
    if (seen.has(id)) {
      diagnostics.push(
        l213(id, "duplicate upstream id — set distinct 'name:'"),
      );
      continue;
    }
    seen.add(id);
    const dir = join(opts.cacheRoot, id);
    const existing = byId.get(id);
    const selectedForUpdate = opts.update === true || opts.update === id;

    // KEEP / RESTORE
    if (existing !== undefined && !selectedForUpdate) {
      if (await probeCacheSnapshot(dir, existing.snapshot, opts.io.readFile)) {
        dependencies.push(existing); // idempotent — no git
        continue;
      }
      // Restore: re-acquire the *pinned* sha (intent is NOT re-resolved).
      const snap = await acquireAndCompile(existing.url, existing.sha, opts.io);
      if ("error" in snap) {
        diagnostics.push(l213(id, `restore failed: ${snap.error}`));
        dependencies.push(existing);
        continue;
      }
      if (snap.snapshot !== existing.snapshot) {
        // Same sha but a different compiled hash → markspec wire-format skew
        // (the source is byte-identical by git's guarantee). Keep the pin,
        // do not clobber the cache; tell the user to re-pin explicitly.
        diagnostics.push(l213(
          id,
          `restore recompiled to a different snapshot (markspec version skew?) — run 'markspec lock --update=${id}' to re-pin`,
        ));
        dependencies.push(existing);
        continue;
      }
      const writeErr = await writeSnapshotCache(dir, snap, opts.io);
      if (writeErr) {
        diagnostics.push(writeErr);
        dependencies.push(existing);
        continue;
      }
      dependencies.push(existing);
      continue;
    }

    // FIRST-LOCK or UPDATE — resolve the declared intent → sha.
    const intent = ref.version ?? "auto";
    const refs = await opts.io.git.lsRemote(ref.url);
    if ("error" in refs) {
      diagnostics.push(l213(id, `ls-remote failed (${refs.error})`));
      if (existing !== undefined) dependencies.push(existing);
      continue;
    }
    const ri = resolveIntent(intent, refs);
    if ("error" in ri) {
      diagnostics.push(l213(id, ri.error));
      if (existing !== undefined) dependencies.push(existing);
      continue;
    }
    const snap = await acquireAndCompile(ref.url, ri.sha, opts.io);
    if ("error" in snap) {
      diagnostics.push(l213(id, snap.error));
      if (existing !== undefined) dependencies.push(existing);
      continue;
    }
    const writeErr = await writeSnapshotCache(dir, snap, opts.io);
    if (writeErr) {
      diagnostics.push(writeErr);
      if (existing !== undefined) dependencies.push(existing);
      continue;
    }
    dependencies.push({
      kind: "dependency",
      id,
      url: ref.url,
      intent,
      resolved: ri.resolved,
      sha: ri.sha,
      snapshot: snap.snapshot,
      lockedAt: opts.lockedAt,
    });
  }

  return { dependencies, diagnostics };
}
