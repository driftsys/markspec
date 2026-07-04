/**
 * @module upstream
 *
 * Upstream corpus loader — hydrates the cached compiled-JSON snapshots
 * that `markspec lock` writes under `.markspec/cache/upstreams/<id>/`
 * into read-only graph citizens carrying an `upstream` origin.
 *
 * Design: docs/wip/2026-07-04-federated-upstream-resolution-design.md §4.5.
 * Sibling of `core/profile/delivered.ts` (`loadDeliveredCorpus`), same
 * purity rules: no I/O of its own — file access via the injected
 * {@linkcode ReadFile}.
 */

import { join } from "@std/path";
import type { Diagnostic, Entry } from "../model/mod.ts";
import {
  checkSnapshotSchema,
  deserializeEntry,
  extractSerializedEntries,
} from "../compiler/deserialize.ts";
import type { ReadFile } from "../config/mod.ts";
import { isUnsafeRelPath } from "../util/paths.ts";

/** One locked upstream's cached snapshot (dir written by `markspec lock`). */
export interface UpstreamSnapshotRef {
  /** projectRef `name` — cache directory, lockfile rows, origin badges. */
  readonly id: string;
  /** Resolved version label recorded by the lockfile (e.g. `v2.1.0`). */
  readonly version: string;
  /** Absolute path to `.markspec/cache/upstreams/<id>`. */
  readonly dir: string;
}

/** Result of {@linkcode loadUpstreamCorpus}. */
export interface LoadUpstreamCorpusResult {
  readonly entries: Entry[];
  readonly diagnostics: Diagnostic[];
}

/** File reader injected by the caller (CLI/LSP own the I/O). */
export type { ReadFile };

/**
 * Hydrate every locked upstream's cached snapshot into `Entry[]`.
 *
 * Per upstream: read `<dir>/manifest.json`, reject schema skew
 * (UPSTREAM-SNAPSHOT-001), extract the serialized entries, and stamp each
 * with `origin = { kind: "upstream", upstreamId, version }`.
 *
 * Authoritative-source rule (design §4.5): a snapshot entry that already
 * carries an `origin` is a re-export of some other source's entry (the
 * upstream's own corpus or its upstreams) and is skipped — every entry
 * joins an aggregate only from its authoring project. A failing upstream
 * contributes diagnostics but never aborts the others.
 */
export async function loadUpstreamCorpus(
  upstreams: readonly UpstreamSnapshotRef[],
  readFile: ReadFile,
): Promise<LoadUpstreamCorpusResult> {
  const entries: Entry[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const up of upstreams) {
    const manifestPath = join(up.dir, "manifest.json");
    const manifestRaw = await readFile(manifestPath);
    if (manifestRaw === undefined) {
      diagnostics.push({
        code: "UPSTREAM-SNAPSHOT-002",
        severity: "error",
        message:
          `upstream '${up.id}' snapshot manifest is missing or unreadable; ` +
          `run 'markspec lock' to restore the cache`,
        location: { file: manifestPath, line: 1, column: 1 },
      });
      continue;
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch (err) {
      diagnostics.push({
        code: "UPSTREAM-SNAPSHOT-003",
        severity: "error",
        message: `malformed upstream snapshot: manifest is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
        location: { file: manifestPath, line: 1, column: 1 },
      });
      continue;
    }
    const skew = checkSnapshotSchema(manifest, manifestPath);
    if (skew) {
      diagnostics.push(skew);
      continue;
    }
    // Snapshot files are read relative to the upstream's cache dir. The
    // extractor is sync; pre-read the single file the manifest points at.
    const block = (manifest as { entries?: { file?: string } }).entries;
    const relFile = block?.file;
    // The manifest is untrusted input (a hostile or corrupted upstream) —
    // reject a data-file path that could escape the cache directory
    // before ever joining it into a read. Latent today (fixtures only);
    // becomes live once slice 2 populates caches from remote sites (repo
    // precedent #699 treated the analogous symlink case as a security
    // blocker).
    if (relFile !== undefined && isUnsafeRelPath(relFile)) {
      diagnostics.push({
        code: "UPSTREAM-SNAPSHOT-003",
        severity: "error",
        message:
          "malformed upstream snapshot: snapshot data-file path escapes the cache directory",
        location: { file: manifestPath, line: 1, column: 1 },
      });
      continue;
    }
    const snapshotContent = relFile !== undefined
      ? await readFile(join(up.dir, relFile))
      : undefined;
    const extracted = extractSerializedEntries(
      manifest,
      (rel) => (rel === relFile ? snapshotContent : undefined),
      manifestPath,
    );
    diagnostics.push(...extracted.diagnostics);
    for (const s of extracted.entries) {
      if (s.origin !== undefined) continue; // authoritative-source rule
      const entry = deserializeEntry(s);
      entries.push({
        ...entry,
        origin: { kind: "upstream", upstreamId: up.id, version: up.version },
      });
    }
  }
  return { entries, diagnostics };
}
