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
import { upstreamNotLockable, writeCacheFiles } from "./upstream_common.ts";
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
  /**
   * Upstream ids already claimed by declared `references:` entries. A
   * dependency whose derived id collides with one is skipped with an
   * MSL-L216 warning (warn-and-write) — the reference snapshot owns that
   * cache namespace, and two rows under one id would clobber each other's
   * cache and double-map the corpus. Defaults to empty (no cross-kind
   * dedup) for callers that resolve dependencies in isolation.
   */
  readonly reservedIds?: ReadonlySet<string>;
}

export interface ResolveProjectDependenciesResult {
  readonly dependencies: UpstreamDependency[];
  readonly diagnostics: Diagnostic[];
}

/** Warn-and-write diagnostic — one dependency could not be locked (decision 1). */
function l213(id: string, detail: string): Diagnostic {
  return upstreamNotLockable("dependency", id, detail);
}

/** Cross-kind id-collision diagnostic — a dependency id is already claimed
 * by a `references:` entry (warn-and-write: the dependency is skipped). */
function l216(id: string): Diagnostic {
  return {
    code: "MSL-L216",
    severity: "warning",
    message:
      `upstream id '${id}' is claimed by both a 'references:' entry and a ` +
      `'dependencies:' entry — skipping the dependency (the reference ` +
      `snapshot owns the cache); set a distinct 'name:' on one of them`,
    location: undefined,
  };
}

/** Acquire the tree at `sha` into a fresh temp dir, compile it, clean up.
 * A temp-dir creation failure is turned into a warn-and-write `{ error }`
 * rather than propagating and aborting the whole lock. */
async function acquireAndCompile(
  url: string,
  sha: string,
  io: UpstreamDepsIO,
): Promise<CompiledSnapshot | { error: string }> {
  let tmp: string;
  try {
    tmp = await io.makeTempDir();
  } catch (err) {
    return {
      error: `temp dir creation failed (${
        err instanceof Error ? err.message : String(err)
      })`,
    };
  }
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

/** Write `manifest.json` + `compiled.json` for a snapshot under `dir`. The
 * clean `id` (not `dir`) is threaded through so a cache-write-failure
 * warning names the upstream, not the raw cache path. */
function writeSnapshotCache(
  id: string,
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
  return writeCacheFiles(writes, "dependency", id, io.writeFile);
}

/**
 * RESTORE — the pin exists but its cache is missing or hash-broken. Re-acquire
 * the *pinned* sha (intent is NOT re-resolved) purely to repopulate the cache;
 * the pin never moves. Returns a warning on any failure (unreachable, markspec
 * version skew, or cache-write error) and `undefined` on a clean repopulate.
 * In every case the caller keeps the existing row.
 */
async function restore(
  id: string,
  existing: UpstreamDependency,
  dir: string,
  io: UpstreamDepsIO,
): Promise<Diagnostic | undefined> {
  const snap = await acquireAndCompile(existing.url, existing.sha, io);
  if ("error" in snap) return l213(id, `restore failed: ${snap.error}`);
  if (snap.snapshot !== existing.snapshot) {
    // Same sha but a different compiled hash → markspec wire-format skew
    // (the source is byte-identical by git's guarantee). Keep the pin, do
    // not clobber the cache; tell the user to re-pin explicitly.
    return l213(
      id,
      `restore recompiled to a different snapshot (markspec version skew?) — run 'markspec lock --update=${id}' to re-pin`,
    );
  }
  return await writeSnapshotCache(id, dir, snap, io);
}

/**
 * FIRST-LOCK or UPDATE — resolve the declared intent to a sha, acquire,
 * compile, and write the cache. Returns the new pinned row, or a warning
 * (ls-remote / intent / acquire / cache-write failure). The caller decides
 * whether to fall back to a prior `existing` row.
 */
async function firstLockOrUpdate(
  ref: ProjectRef,
  id: string,
  dir: string,
  intent: string,
  io: UpstreamDepsIO,
  lockedAt: string,
): Promise<UpstreamDependency | Diagnostic> {
  const refs = await io.git.lsRemote(ref.url);
  if ("error" in refs) return l213(id, `ls-remote failed (${refs.error})`);
  const ri = resolveIntent(intent, refs);
  if ("error" in ri) return l213(id, ri.error);
  const snap = await acquireAndCompile(ref.url, ri.sha, io);
  if ("error" in snap) return l213(id, snap.error);
  const writeErr = await writeSnapshotCache(id, dir, snap, io);
  if (writeErr) return writeErr;
  return {
    kind: "dependency",
    id,
    url: ref.url,
    intent,
    resolved: ri.resolved,
    sha: ri.sha,
    snapshot: snap.snapshot,
    lockedAt,
  };
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
    // Cross-kind collision: a `references:` entry already owns this id.
    // Skip the dependency (warn-and-write) — it must not clobber the cache.
    if (opts.reservedIds?.has(id)) {
      diagnostics.push(l216(id));
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
      const restoreDiag = await restore(id, existing, dir, opts.io);
      if (restoreDiag) diagnostics.push(restoreDiag);
      dependencies.push(existing); // the pin never moves on restore
      continue;
    }

    // FIRST-LOCK or UPDATE.
    const intent = ref.version ?? "auto";
    const outcome = await firstLockOrUpdate(
      ref,
      id,
      dir,
      intent,
      opts.io,
      opts.lockedAt,
    );
    if ("code" in outcome) {
      diagnostics.push(outcome);
      if (existing !== undefined) dependencies.push(existing);
    } else {
      dependencies.push(outcome);
    }
  }

  return { dependencies, diagnostics };
}
