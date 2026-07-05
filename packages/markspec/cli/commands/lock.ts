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
import { dirname, fromFileUrl, join } from "@std/path";
import {
  checkDrift,
  collectProjectEntries,
  compileAcquiredTree,
  defaultAppendFile,
  deriveUpstreamId,
  type Diagnostic,
  discoverProjectRoot,
  ensureCacheGitignored,
  type GitIO,
  loadConfig,
  loadProfileForCommand,
  loadToolConfig,
  type Lockfile,
  LOCKFILE_SCHEMA_VERSION,
  type Mapping,
  parseLockfile,
  parseLsRemote,
  parseMapping,
  resolveProjectDependencies,
  resolveProjectReferences,
  resolveUpstreams,
  serializeLockfile,
  upstreamCacheRoot,
  type UpstreamDependency,
  type UpstreamRegistry,
  validateMappings,
  VERSION,
} from "../../core/mod.ts";
import { denoDiscoveryIO } from "../helpers.ts";

/**
 * Reject a git URL that git could parse as an option rather than a remote.
 * A URL beginning with `-` is read by git as a flag (e.g.
 * `--upload-pack=sh -c '…'` → argument-injection RCE); an empty URL is
 * meaningless. Returns an error string when unsafe, `undefined` when the
 * URL is safe to hand to git. The complementary `ext::`/`fd::`
 * transport-helper RCE class is blocked separately by `GIT_ALLOW_PROTOCOL`
 * in {@linkcode runGit}. Both guards target `dependencies[].url` values
 * that arrive from an untrusted `project.yaml`.
 */
function unsafeGitUrl(url: string): string | undefined {
  if (url === "" || url.startsWith("-")) {
    return "refusing unsafe git URL (leading '-' could be parsed as a git option)";
  }
  return undefined;
}

/** Run a git subprocess, returning stdout or `{ error }`. Never throws. */
async function runGit(
  args: string[],
): Promise<{ stdout: string } | { error: string }> {
  try {
    const cmd = new Deno.Command("git", {
      args,
      stdout: "piped",
      stderr: "piped",
      // Protocol allowlist — git will only speak these transports, blocking
      // the `ext::`/`fd::` transport-helper RCE reachable from a
      // `dependencies[].url` in an untrusted project.yaml. `file` is
      // required: the e2e fixtures acquire from local bare-repo paths (git's
      // `file` transport). Deno.Command defaults `clearEnv:false`, so this
      // key merges on top of the inherited parent env — PATH/HOME preserved.
      env: { GIT_ALLOW_PROTOCOL: "https:ssh:git:file" },
    });
    const out = await cmd.output();
    if (!out.code) return { stdout: new TextDecoder().decode(out.stdout) };
    return {
      error: new TextDecoder().decode(out.stderr).trim() ||
        `git exit ${out.code}`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const denoGitIO: GitIO = {
  async lsRemote(url) {
    const bad = unsafeGitUrl(url);
    if (bad) return { error: bad };
    const r = await runGit(["ls-remote", "--symref", url]);
    return "error" in r ? r : parseLsRemote(r.stdout);
  },
  async acquireTree(url, sha, destDir) {
    const bad = unsafeGitUrl(url);
    if (bad) return { error: bad };
    // Shallow fetch-by-sha, no history, no blobs until needed, then detach.
    // (Requires the remote to allow reachable-sha fetches — GitHub/GitLab do;
    // the e2e bare-repo fixture sets uploadpack.allowReachableSHA1InWant.)
    for (
      const args of [
        ["-C", destDir, "init", "-q"],
        ["-C", destDir, "remote", "add", "origin", url],
        [
          "-C",
          destDir,
          "fetch",
          "-q",
          "--depth",
          "1",
          "--filter=blob:none",
          "origin",
          sha,
        ],
        ["-C", destDir, "checkout", "-q", "FETCH_HEAD"],
      ]
    ) {
      const r = await runGit(args);
      if ("error" in r) return { error: r.error };
    }
    // Drop the .git directory so it never enters discovery or lingers on disk.
    try {
      await Deno.remove(`${destDir}/.git`, { recursive: true });
    } catch { /* best-effort */ }
    return {};
  },
};

/** Compile an acquired tree with Deno-backed IO. */
function denoCompileTree(treeRoot: string) {
  return compileAcquiredTree(treeRoot, {
    readFile: readFileOrUndefined,
    readText: (p) => Deno.readTextFile(p),
    discovery: denoDiscoveryIO(),
  }, VERSION);
}

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

  const toolConfigResult = await loadToolConfig(
    projectRoot,
    readFileOrUndefined,
  );
  const entries = await collectProjectEntries(projectRoot, denoDiscoveryIO(), {
    exclude: toolConfigResult.config.exclude,
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
    cacheRoot: upstreamCacheRoot(projectRoot),
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

  const existingDependencies = (existingLockfile?.upstreams ?? [])
    .filter((u): u is UpstreamDependency => u.kind === "dependency");

  const depResult = await resolveProjectDependencies({
    dependencies: config.dependencies,
    existing: existingDependencies,
    cacheRoot: upstreamCacheRoot(projectRoot),
    update: options.update ?? false,
    io: {
      git: denoGitIO,
      compileTree: denoCompileTree,
      readFile: defaultReadFile,
      writeFile: defaultWriteFile,
      makeTempDir: () => Deno.makeTempDir({ prefix: "markspec-dep-" }),
      removeDir: (p) => Deno.remove(p, { recursive: true }).catch(() => {}),
    },
    lockedAt: resolved.lockedAt,
  });
  for (const d of depResult.diagnostics) {
    console.error(`${d.severity}: ${d.code}: ${d.message}`);
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
      ...depResult.dependencies,
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
          dependencies: { resolved: depResult.dependencies.length },
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
      `wrote markspec.lock (${resolved.references.length} references, ${resolved.profiles.length} profiles, ${refResult.registries.length} registries, ${depResult.dependencies.length} dependencies, ${resolved.boundEntries.length} bound entries, ${resolved.canonicalEdgeCount} edges, ${resolved.edges.length} ledger edges)`,
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
      // Map the file URL to a native path via the std helper so a Windows
      // `file:///C:/…` URL becomes `C:\…` (a plain `file://` strip would
      // leave a leading-slash-before-drive path Deno.readFile can't open).
      const path = fromFileUrl(url);
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
