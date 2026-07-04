/**
 * @module cli/commands/lock
 *
 * `markspec lock` — generate or refresh `markspec.lock`.
 *
 * Flags:
 *   --check              CI mode: read-only, exit 1 on drift
 *   --format json        Machine-readable output (default: human-readable)
 *   --update[=<id>]      Force re-resolve all upstreams, or one by id/slug
 *                        (v1.0: equivalent to a full re-resolve)
 */

import { Command } from "@cliffy/command";
import { dirname, join } from "@std/path";
import {
  checkDrift,
  collectProjectEntries,
  defaultAppendFile,
  deriveUpstreamId,
  type Diagnostic,
  discoverProjectRoot,
  ensureCacheGitignored,
  loadConfig,
  loadProfileForCommand,
  type Lockfile,
  LOCKFILE_SCHEMA_VERSION,
  type Mapping,
  parseLockfile,
  parseMapping,
  resolveProjectReferences,
  resolveUpstreams,
  serializeLockfile,
  type UpstreamRegistry,
  validateMappings,
} from "../../core/mod.ts";
import { denoDiscoveryIO } from "../helpers.ts";

interface LockOptions {
  check?: boolean;
  format?: string;
  update?: string | true;
}

export const lockCmd = new Command()
  .description("Generate or refresh markspec.lock")
  .option("--check", "CI mode: read-only, exit 1 on drift")
  .option("--format <format:string>", "Output format: json")
  .option(
    "--update [id:string]",
    "Force re-resolve all upstreams, or one by id/slug (v1.0: equivalent to a full re-resolve)",
  )
  .action(async (options: LockOptions) => {
    await runLock(options);
  });

async function runLock(options: LockOptions): Promise<void> {
  if (options.update !== undefined) {
    const target = typeof options.update === "string"
      ? options.update
      : "(all upstreams)";
    console.error(`updating: ${target}`);
  }

  const projectRoot =
    (await discoverProjectRoot(Deno.cwd(), readFileOrUndefined)) ?? Deno.cwd();

  const configResult = await loadConfig(projectRoot, readFileOrUndefined);
  if (!configResult) {
    console.error("error: project.yaml not found");
    Deno.exit(1);
  }
  const config = configResult.config;

  const profileResult = await loadProfileForCommand(
    projectRoot,
    readFileOrUndefined,
  );
  const chain = profileResult.chain;

  const entries = await collectProjectEntries(projectRoot, denoDiscoveryIO(), {
    exclude: config.exclude,
  });
  const mappings = await loadAllMappings(projectRoot);

  const mappingDiags = validateMappings(mappings);
  for (const d of mappingDiags) {
    console.error(`${d.severity}: ${d.code}: ${d.message}`);
  }
  if (mappingDiags.some((d) => d.severity === "error")) {
    Deno.exit(1);
  }

  // Parse the existing lockfile up front — missing or malformed becomes
  // an empty registry row set. `--check` (below) still errors on a
  // missing/malformed lockfile (CI gate); the write path below treats
  // either case as "first lock" and regenerates.
  const lockPath = join(projectRoot, "markspec.lock");
  const tomlRaw = await readFileOrUndefined(lockPath);
  let existingLockfile: Lockfile | undefined;
  let existingParseDiagnostics: readonly Diagnostic[] = [];
  if (tomlRaw !== undefined) {
    const parsed = parseLockfile(tomlRaw);
    existingLockfile = parsed.lockfile;
    existingParseDiagnostics = parsed.diagnostics;
  }

  const declaredReferenceIds = config.references
    .map((ref) => deriveUpstreamId(ref))
    .filter((id): id is string => id !== undefined);

  const resolved = await resolveUpstreams({
    entries,
    profileChain: chain ?? [],
    config,
    mappings,
    fetchUrl: defaultFetchUrl,
    readFile: defaultReadFile,
  });

  if (options.check) {
    if (tomlRaw === undefined) {
      console.error(
        "error: MSL-L201: markspec.lock is missing under --check (run `markspec lock` to generate)",
      );
      Deno.exit(1);
    }
    if (!existingLockfile) {
      for (const d of existingParseDiagnostics) {
        console.error(`${d.severity}: ${d.code}: ${d.message}`);
      }
      Deno.exit(1);
    }
    const driftDiags = checkDrift(
      existingLockfile,
      resolved,
      declaredReferenceIds,
    );
    for (const d of driftDiags) {
      console.error(`${d.severity}: ${d.code}: ${d.message}`);
    }
    if (options.format === "json") {
      console.log(JSON.stringify({
        command: "lock-check",
        drift: driftDiags.length > 0,
        diagnostics: driftDiags.map((d) => ({
          code: d.code,
          severity: d.severity,
          message: d.message,
        })),
      }));
    } else if (driftDiags.length === 0) {
      console.error("ok: markspec.lock is in sync with current state");
    }
    Deno.exit(driftDiags.length > 0 ? 1 : 0);
  }

  for (const d of resolved.diagnostics) {
    console.error(`${d.severity}: ${d.code}: ${d.message}`);
  }

  // Git-repository dependencies are declared but not yet acquired — slice
  // 3 lands `dependencies:` resolution. Surface the gap per-entry rather
  // than silently dropping the declaration.
  for (const dep of config.dependencies) {
    const id = deriveUpstreamId(dep) ?? dep.url;
    console.error(
      `dependency '${id}' declared — git dependency acquisition lands in a future release; row not written`,
    );
  }

  // Idempotent — no-op once `.markspec/cache/` is already ignored.
  await ensureCacheGitignored(
    projectRoot,
    readFileOrUndefined,
    defaultAppendFile,
  );

  const existingRegistries = (existingLockfile?.upstreams ?? [])
    .filter((u): u is UpstreamRegistry => u.kind === "registry");

  const refResult = await resolveProjectReferences({
    references: config.references,
    existing: existingRegistries,
    cacheRoot: join(projectRoot, ".markspec", "cache", "upstreams"),
    update: options.update ?? false,
    io: {
      fetchUrl: defaultFetchUrl,
      readFile: defaultReadFile,
      writeFile: defaultWriteFile,
    },
    lockedAt: resolved.lockedAt,
  });

  for (const d of refResult.diagnostics) {
    console.error(`${d.severity}: ${d.code}: ${d.message}`);
  }
  if (refResult.diagnostics.some((d) => d.severity === "error")) {
    // A reference failed to lock — abort before writing so markspec.lock
    // never records a partial/broken pin.
    Deno.exit(1);
  }

  const lockfile: Lockfile = {
    schema: LOCKFILE_SCHEMA_VERSION,
    meta: {
      markspecSchema: LOCKFILE_SCHEMA_VERSION,
      lockedAt: resolved.lockedAt,
    },
    upstreams: [
      ...resolved.references.map((r) => r.upstream),
      ...resolved.profiles.map((p) => p.upstream),
      ...refResult.registries,
    ],
    boundEntries: resolved.boundEntries.map((b) => b.boundEntry),
    edges: resolved.edges,
    generatedCache: {
      edgesHash: resolved.canonicalEdgeHash,
      edgesCount: resolved.canonicalEdgeCount,
    },
  };

  const toml = serializeLockfile(lockfile);
  await Deno.writeTextFile(lockPath, toml);

  if (options.format === "json") {
    // JSON to stdout (machine-readable); diagnostics already emitted to stderr.
    console.log(
      JSON.stringify({
        command: "lock",
        wrote: true,
        lockfile: "markspec.lock",
        summary: {
          references: { resolved: resolved.references.length },
          profiles: { resolved: resolved.profiles.length },
          registries: { resolved: refResult.registries.length },
          "bound-entries": { resolved: resolved.boundEntries.length },
          "canonical-edges": { count: resolved.canonicalEdgeCount },
          "ledger-edges": { count: resolved.edges.length },
        },
        diagnostics: resolved.diagnostics.map((d) => ({
          code: d.code,
          severity: d.severity,
          message: d.message,
        })),
      }),
    );
  } else {
    console.error(
      `wrote markspec.lock (${resolved.references.length} references, ${resolved.profiles.length} profiles, ${refResult.registries.length} registries, ${resolved.boundEntries.length} bound entries, ${resolved.canonicalEdgeCount} edges, ${resolved.edges.length} ledger edges)`,
    );
  }

  Deno.exit(
    resolved.diagnostics.some((d) => d.severity === "error") ? 1 : 0,
  );
}

async function readFileOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
}

async function loadAllMappings(root: string): Promise<Mapping[]> {
  const out: Mapping[] = [];
  const dir = join(root, ".markspec", "sync");
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !e.name.endsWith(".yaml")) continue;
      const path = join(dir, e.name);
      const yaml = await Deno.readTextFile(path);
      const r = parseMapping(yaml, path);
      if (r.mapping) out.push(r.mapping);
      for (const d of r.diagnostics) {
        console.error(`${d.severity}: ${d.code}: ${d.message}`);
      }
    }
  } catch { /* no .markspec/sync/ directory */ }
  return out;
}

/**
 * Default fetcher: file:// → Deno.readFile; everything else → fetch().
 * Never throws — every recoverable failure returns `{ error }`.
 */
async function defaultFetchUrl(
  url: string,
): Promise<Uint8Array | { error: string }> {
  try {
    if (url.startsWith("file://")) {
      const path = url.replace(/^file:\/\//, "");
      return await Deno.readFile(path);
    }
    const res = await fetch(url);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Default profile-manifest reader: direct filesystem read.
 * Never throws — failures return `{ error }`.
 */
async function defaultReadFile(
  path: string,
): Promise<Uint8Array | { error: string }> {
  try {
    return await Deno.readFile(path);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Default cache writer: creates parent directories, then writes bytes.
 * Never throws — every recoverable failure returns `{ error }`.
 */
export async function defaultWriteFile(
  path: string,
  bytes: Uint8Array,
): Promise<{ error?: string }> {
  try {
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeFile(path, bytes);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Exported helpers — re-used by compile.ts --frozen path
// ---------------------------------------------------------------------------

export {
  defaultFetchUrl,
  defaultReadFile,
  loadAllMappings,
  readFileOrUndefined,
};
