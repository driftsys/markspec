/**
 * @module core/lock/acquire_compile
 *
 * Deterministic in-process compile of an acquired dependency tree
 * (design §4.3). Produces the same `manifest.json` + `compiled.json` layout
 * a published `references:` site serves, so `loadUpstreamCorpus` /
 * `probeCacheSnapshot` read a dependency snapshot identically to a reference
 * snapshot. The output is byte-reproducible from (tree, markspec version):
 * files are compiled in sorted, tree-relative order with no stat/git IO, so
 * `entry.location.file`, `properties.file.path`, and entry ordering are all
 * stable. Pure — every file touch flows through {@linkcode AcquireCompileIO}.
 */

import { join, relative } from "@std/path";
import { compile } from "../compiler/mod.ts";
import { buildManifest, type ManifestJson } from "../compiler/manifest.ts";
import { serializeCompileResult } from "../compiler/schema.ts";
import { loadConfig } from "../config/mod.ts";
import { loadToolConfig } from "../config/markspec.ts";
import { loadProfileForCommand } from "../profile/load.ts";
import { discoverFiles, type DiscoveryIO } from "../discovery/mod.ts";
import { sha256Bytes } from "./hash.ts";

export interface AcquireCompileIO {
  /** Config/profile reader — returns text or undefined (core `ReadFile`). */
  readonly readFile: (path: string) => Promise<string | undefined>;
  /** Throwing reader compile() consumes (`(path) => Promise<string>`). */
  readonly readText: (path: string) => Promise<string>;
  /** Discovery seam (`{ readDir, readFile }`) — same as `denoDiscoveryIO()`. */
  readonly discovery: DiscoveryIO;
}

export interface CompiledSnapshot {
  readonly manifestJson: ManifestJson;
  readonly compiledBytes: Uint8Array; // exact bytes written to compiled.json
  readonly snapshot: string; // sha256(compiledBytes)
}

export async function compileAcquiredTree(
  treeRoot: string,
  io: AcquireCompileIO,
  release: string,
): Promise<CompiledSnapshot | { error: string }> {
  // Memoize by path: loadConfig, loadProfileForCommand, and loadToolConfig
  // each walk + read the same project.yaml/.markspec.yaml, so cache the
  // in-flight promise per path to read each file exactly once per acquired
  // tree. The tree is immutable (just fetched at a fixed sha), so a
  // per-call cache is sound and deterministic.
  const readCache = new Map<string, Promise<string | undefined>>();
  const readFile = (path: string): Promise<string | undefined> => {
    let pending = readCache.get(path);
    if (pending === undefined) {
      pending = io.readFile(path);
      readCache.set(path, pending);
    }
    return pending;
  };

  const configResult = await loadConfig(treeRoot, readFile);
  if (!configResult) {
    return { error: "dependency tree has no discoverable project.yaml" };
  }
  const profileResult = await loadProfileForCommand(treeRoot, readFile);
  const profile = profileResult.chain?.effective;
  const toolConfig = await loadToolConfig(treeRoot, readFile);

  // Discover → relativize → normalize to POSIX separators → sort. The
  // `\\`→`/` normalization is load-bearing for cross-machine determinism:
  // `relative()` yields OS-native separators, so a Windows host would emit
  // `docs\reqs.md` while POSIX emits `docs/reqs.md`, giving two different
  // `location.file`/`properties.file.path` values → two different snapshot
  // hashes for the same source → spurious MSL-L212 drift between a Windows
  // and a macOS/Linux developer sharing one lockfile. Normalizing before
  // the sort also makes the entry order (hence JSON key order) identical
  // on every platform.
  const abs: string[] = [];
  for await (
    const f of discoverFiles(treeRoot, io.discovery, {
      exclude: toolConfig.config.exclude,
    })
  ) {
    abs.push(f);
  }
  const rel = abs
    .map((p) => relative(treeRoot, p).replaceAll("\\", "/"))
    .sort();

  // Compile with a root-resolving reader and NO stat/git callbacks →
  // deterministic properties (no mtime, no contributors, relative path).
  const result = await compile(rel, {
    readFile: (r) => io.readText(join(treeRoot, r)),
    profile,
  });

  // `root` is cosmetic here — manifest.json is not hashed (only compiled.json
  // is) and lives in the gitignored cache; pass "." so no temp path leaks.
  const manifestJson = buildManifest(
    result,
    configResult.config,
    ".",
    profile,
    release,
    false,
  );
  // Compact (no whitespace) rather than the CLI's pretty-printed form —
  // this cache file is machine-read only (loadUpstreamCorpus /
  // probeCacheSnapshot JSON.parse it), and compact output keeps
  // `entry.location.file`'s tree-relative path adjacent to its `"file":`
  // key with no formatting-introduced variance to reason about.
  const compiled = serializeCompileResult(result);
  const compiledBytes = new TextEncoder().encode(JSON.stringify(compiled));
  return {
    manifestJson,
    compiledBytes,
    snapshot: await sha256Bytes(compiledBytes),
  };
}
