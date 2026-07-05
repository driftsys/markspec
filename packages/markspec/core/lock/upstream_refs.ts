/**
 * @module lock/upstream_refs
 *
 * Lock-mediated resolution of org-manifest `references:` projectRefs
 * (design §4.2): fetch a published compile-output snapshot over https or
 * `file://`, cache it under `.markspec/cache/upstreams/<id>/`, and pin it
 * as an extended `[[upstream.registry]]` lockfile row. Three flows:
 * first lock (new declaration → fetch + pin), keep/restore (pin exists →
 * verify cache offline, refetch only to repopulate, never move the pin),
 * update (`--update` → refetch + move the pin).
 *
 * Pure module: network and file access only via {@linkcode UpstreamRefsIO}.
 */

import { join } from "@std/path";
import type { Diagnostic, ProjectRef } from "../model/mod.ts";
import type { UpstreamRegistry } from "./model.ts";
import type { FetchUrl, ReadFile } from "./resolve.ts";
import { sha256Bytes } from "./hash.ts";
import { upstreamNotLockable, writeCacheFiles } from "./upstream_common.ts";
import { checkSnapshotSchema } from "../compiler/deserialize.ts";
import { isUnsafeRelPath } from "../util/paths.ts";

/**
 * Root directory under which every upstream's cached snapshot is stored,
 * one subdirectory per upstream id (`<root>/<id>/manifest.json`, etc.).
 * Shared by `markspec lock` (the writer) and `markspec check` (the
 * offline MSL-L212 prober) so the two commands can never disagree on
 * where the cache lives.
 */
export function upstreamCacheRoot(projectRoot: string): string {
  return join(projectRoot, ".markspec", "cache", "upstreams");
}

/** IO seam — the CLI supplies Deno-backed implementations. */
export interface UpstreamRefsIO {
  readonly fetchUrl: FetchUrl;
  /** Bytes reader used to probe the existing cache (missing → `{error}`). */
  readonly readFile: ReadFile;
  /** Write `bytes` to `path`, creating parent directories. */
  readonly writeFile: (
    path: string,
    bytes: Uint8Array,
  ) => Promise<{ error?: string }>;
}

/** See module doc. */
export interface ResolveProjectReferencesOptions {
  readonly references: readonly ProjectRef[];
  readonly existing: readonly UpstreamRegistry[];
  readonly cacheRoot: string;
  readonly update: boolean | string;
  readonly io: UpstreamRefsIO;
  readonly lockedAt: string;
}

/** Result of {@linkcode resolveProjectReferences}. */
export interface ResolveProjectReferencesResult {
  readonly registries: UpstreamRegistry[];
  readonly diagnostics: Diagnostic[];
}

/** Safe upstream id — a single path segment (also enforced by the config
 * loader on explicit `name:` values). */
const UPSTREAM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Derive the upstream id for a projectRef: the explicit `name`, else the
 * last non-empty path segment of the URL with any `.git` suffix stripped.
 * Returns `undefined` when no safe id can be derived.
 */
export function deriveUpstreamId(ref: ProjectRef): string | undefined {
  if (ref.name !== undefined) {
    return UPSTREAM_ID_RE.test(ref.name) ? ref.name : undefined;
  }
  const trimmed = ref.url.replace(/\/+$/, "");
  const segment = trimmed.split(/[/:]/).filter((s) => s.length > 0).pop();
  if (segment === undefined) return undefined;
  const id = segment.replace(/\.git$/, "");
  return UPSTREAM_ID_RE.test(id) ? id : undefined;
}

interface FetchedSnapshot {
  readonly manifestBytes: Uint8Array;
  readonly manifest: {
    readonly markspecSchemaVersion: number;
    readonly project?: { readonly version?: unknown };
    readonly entries?: {
      readonly format?: string;
      readonly file?: string;
      readonly index?: string;
    };
  };
  readonly files: ReadonlyMap<string, Uint8Array>; // rel path → bytes
  readonly snapshotHash: string; // sha256 of the entries data file
}

function l213(id: string, detail: string): Diagnostic {
  return upstreamNotLockable("reference", id, detail);
}

async function fetchSnapshot(
  id: string,
  baseUrl: string,
  fetchUrl: FetchUrl,
): Promise<FetchedSnapshot | Diagnostic> {
  const manifestUrl = `${baseUrl}/manifest.json`;
  const manifestBytes = await fetchUrl(manifestUrl);
  if ("error" in manifestBytes) {
    return l213(id, `fetch of ${manifestUrl} failed (${manifestBytes.error})`);
  }
  let manifest: FetchedSnapshot["manifest"];
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch (err) {
    return l213(
      id,
      `manifest.json is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const skew = checkSnapshotSchema(manifest, manifestUrl);
  if (skew) return l213(id, skew.message);
  const entriesFile = manifest.entries?.file;
  if (entriesFile === undefined || isUnsafeRelPath(entriesFile)) {
    return l213(id, "manifest entries block missing or names an unsafe path");
  }
  const files = new Map<string, Uint8Array>();
  const dataBytes = await fetchUrl(`${baseUrl}/${entriesFile}`);
  if ("error" in dataBytes) {
    return l213(id, `fetch of '${entriesFile}' failed (${dataBytes.error})`);
  }
  files.set(entriesFile, dataBytes);
  const indexFile = manifest.entries?.index;
  if (manifest.entries?.format === "ndjson" && indexFile !== undefined) {
    if (isUnsafeRelPath(indexFile)) {
      return l213(id, "manifest entries index names an unsafe path");
    }
    const indexBytes = await fetchUrl(`${baseUrl}/${indexFile}`);
    if ("error" in indexBytes) {
      return l213(id, `fetch of '${indexFile}' failed (${indexBytes.error})`);
    }
    files.set(indexFile, indexBytes);
  }
  return {
    manifestBytes,
    manifest,
    files,
    snapshotHash: await sha256Bytes(dataBytes),
  };
}

function writeCache(
  id: string,
  dir: string,
  fetched: FetchedSnapshot,
  io: UpstreamRefsIO,
): Promise<Diagnostic | undefined> {
  const writes: Array<[string, Uint8Array]> = [
    [join(dir, "manifest.json"), fetched.manifestBytes],
    ...[...fetched.files].map(([rel, bytes]) =>
      [join(dir, rel), bytes] as [string, Uint8Array]
    ),
  ];
  return writeCacheFiles(writes, "reference", id, io.writeFile);
}

/**
 * Probe whether the cached snapshot under `dir` is present and hash-intact
 * against `snapshot`: `manifest.json` must exist and parse, its
 * `entries.file` must name a safe relative path, and the hashed bytes of
 * that file must equal `snapshot`.
 *
 * Shared by {@linkcode cacheIntact} (this module's keep/restore flow) and
 * `verifyUpstreamCache` (`cache_check.ts`'s MSL-L212 offline cache-drift
 * gate) so the two never disagree on what "cache intact" means — the
 * single probe implementation, not a duplicate.
 */
export async function probeCacheSnapshot(
  dir: string,
  snapshot: string,
  readFile: ReadFile,
): Promise<boolean> {
  const manifestBytes = await readFile(join(dir, "manifest.json"));
  if ("error" in manifestBytes) return false;
  let entriesFile: string | undefined;
  try {
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      entries?: { file?: string };
    };
    entriesFile = manifest.entries?.file;
  } catch {
    return false;
  }
  if (entriesFile === undefined || isUnsafeRelPath(entriesFile)) return false;
  const dataBytes = await readFile(join(dir, entriesFile));
  if ("error" in dataBytes) return false;
  return await sha256Bytes(dataBytes) === snapshot;
}

/** Is the cached snapshot for `row` present and hash-intact? */
async function cacheIntact(
  row: UpstreamRegistry,
  dir: string,
  readFile: ReadFile,
): Promise<boolean> {
  if (row.snapshot === undefined) return false;
  return await probeCacheSnapshot(dir, row.snapshot, readFile);
}

function buildRow(
  id: string,
  baseUrl: string,
  fetched: FetchedSnapshot,
  manifestHash: string,
  lockedAt: string,
): UpstreamRegistry {
  const version = fetched.manifest.project?.version;
  return {
    kind: "registry",
    id,
    api: baseUrl,
    resolvedManifestHash: manifestHash,
    markspecSchema: fetched.manifest.markspecSchemaVersion,
    ...(typeof version === "string" ? { version } : {}),
    snapshot: fetched.snapshotHash,
    lockedAt,
  };
}

/** See module doc for the flow table. */
export async function resolveProjectReferences(
  opts: ResolveProjectReferencesOptions,
): Promise<ResolveProjectReferencesResult> {
  const registries: UpstreamRegistry[] = [];
  const diagnostics: Diagnostic[] = [];
  const byId = new Map(opts.existing.map((row) => [row.id, row]));
  const seen = new Set<string>();
  for (const ref of opts.references) {
    const id = deriveUpstreamId(ref);
    if (id === undefined) {
      diagnostics.push(l213(
        ref.name ?? ref.url,
        "no safe upstream id could be derived — set an explicit 'name:'",
      ));
      continue;
    }
    if (seen.has(id)) {
      diagnostics.push(l213(
        id,
        `duplicate upstream id (also derived for an earlier entry) — set distinct 'name:' values`,
      ));
      continue;
    }
    seen.add(id);
    const baseUrl = ref.url.replace(/\/+$/, "");
    const dir = `${opts.cacheRoot}/${id}`;
    const existing = byId.get(id);
    const selectedForUpdate = opts.update === true || opts.update === id;

    if (existing !== undefined && !selectedForUpdate) {
      // Keep — verify offline; restore only when the cache is broken.
      if (await cacheIntact(existing, dir, opts.io.readFile)) {
        registries.push(existing);
        continue;
      }
      const fetched = await fetchSnapshot(id, baseUrl, opts.io.fetchUrl);
      if ("code" in fetched) {
        diagnostics.push(fetched);
        registries.push(existing); // keep the pin; cache stays broken
        continue;
      }
      // A snapshot-less existing row (representable — e.g. a hand-edited
      // or pre-existing lockfile entry) has no pin to verify the fetch
      // against; comparing against `undefined` would always "mismatch".
      // Treat it as a first-lock/re-pin instead of MSL-L214.
      if (
        existing.snapshot !== undefined &&
        fetched.snapshotHash !== existing.snapshot
      ) {
        diagnostics.push({
          code: "MSL-L214",
          severity: "warning",
          message:
            `upstream reference '${id}' restore mismatch: fetched snapshot ` +
            `${fetched.snapshotHash} does not match locked ${existing.snapshot} — ` +
            `the published site moved; run 'markspec lock --update=${id}' to move the pin`,
          location: undefined,
        });
        registries.push(existing);
        continue;
      }
      const writeError = await writeCache(id, dir, fetched, opts.io);
      if (writeError) {
        diagnostics.push(writeError);
        registries.push(existing);
        continue;
      }
      if (existing.snapshot === undefined) {
        const manifestHash = await sha256Bytes(fetched.manifestBytes);
        registries.push(
          buildRow(id, baseUrl, fetched, manifestHash, opts.lockedAt),
        );
      } else {
        registries.push(existing);
      }
      continue;
    }

    // First lock, or explicitly selected for update.
    const fetched = await fetchSnapshot(id, baseUrl, opts.io.fetchUrl);
    if ("code" in fetched) {
      diagnostics.push(fetched);
      if (existing !== undefined) registries.push(existing);
      continue;
    }
    const writeError = await writeCache(id, dir, fetched, opts.io);
    if (writeError) {
      diagnostics.push(writeError);
      if (existing !== undefined) registries.push(existing);
      continue;
    }
    const manifestHash = await sha256Bytes(fetched.manifestBytes);
    registries.push(
      buildRow(id, baseUrl, fetched, manifestHash, opts.lockedAt),
    );
  }
  return { registries, diagnostics };
}
