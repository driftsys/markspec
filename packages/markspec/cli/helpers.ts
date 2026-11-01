/**
 * @module cli/helpers
 *
 * Shared helpers for CLI command implementations: file I/O, config
 * loading, profile loading, and project compilation.
 *
 * All helpers use Deno APIs (allowed in CLI entry points) and dynamic
 * imports to preserve lazy loading — each command only loads the
 * modules it needs.
 */

import {
  ConfigError,
  CORE_SCHEMA_VERSION,
  corpusOriginLabel,
  VERSION,
} from "../core/mod.ts";
import type {
  CompileResult,
  DeliveredDocument,
  Diagnostic,
  DiscoveryIO,
  Entry,
  ProfileChain,
  ProjectConfig,
  ProjectRootResolver,
  ReadFile,
} from "../core/mod.ts";
import { dirname, join, relative, resolve } from "@std/path";

export { CORE_SCHEMA_VERSION, VERSION };

/**
 * Refuse to operate on a profile-delivered document (ADR-030). Delivered
 * corpus/docs files are read-only — sourced from a profile package, not the
 * author's own work. A write command (`fmt`, `insert`) given an explicit path
 * that resolves to a delivered document must not overwrite the package's file
 * (#700); machine formats intentionally surface a corpus entry's real absolute
 * path, so it is easy to name one by accident. Compares each target's resolved
 * absolute path to the delivered index of every given chain (a delivered file
 * often lies outside the project whose profile delivers it, so the caller
 * passes every profile relevant to the run); on a match prints an error and
 * exits 1. No-op when no chain has delivered documents.
 */
export function assertNotDeliveredTarget(
  files: readonly string[],
  chains: Iterable<ProfileChain | null | undefined>,
): void {
  const delivers = [...chains].flatMap((chain) =>
    chain?.effective.delivers ?? []
  );
  if (delivers.length === 0) return;
  for (const file of files) {
    const abs = resolve(file);
    const doc = delivers.find((d) => d.absPath === abs);
    if (doc) {
      console.error(
        `error: ${file}: profile-delivered documents are read-only ` +
          `(delivered by ${corpusOriginLabel(doc)}); edit it in its profile ` +
          `package, not here`,
      );
      Deno.exit(1);
    }
  }
}

/** Print "not yet implemented" to stderr and exit 1. */
export function notImplemented(name: string): () => void {
  return () => {
    console.error(`markspec ${name}: not yet implemented`);
    Deno.exit(1);
  };
}

/** Deno-specific file reader for config discovery. */
export const readFile: ReadFile = async (path: string) => {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
};

/**
 * Run a `project.yaml` load; on a {@linkcode ConfigError} (malformed
 * `project.yaml`), print the error and exit 1. Shared by
 * {@linkcode requireProjectConfig} and {@linkcode loadProjectConfigAt}.
 */
async function loadConfigOrExit<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`error: ${err.message}`);
      Deno.exit(1);
    }
    throw err;
  }
}

/**
 * Load project config or exit with an error.
 * Used by commands that require project context.
 */
export async function requireProjectConfig() {
  const { loadConfig } = await import("../core/mod.ts");
  const result = await loadConfigOrExit(() => loadConfig(Deno.cwd(), readFile));
  if (result === undefined) {
    console.error(
      "error: no project.yaml found\n" +
        `  searched from ${Deno.cwd()} to filesystem root\n\n` +
        "  Create a project.yaml in your project root, or use\n" +
        "  markspec fmt <file> / markspec check <file>\n" +
        "  which work without project context.",
    );
    Deno.exit(1);
  }
  return result;
}

/**
 * Load the `project.yaml` of a project root that was already resolved
 * (see {@linkcode resolveScope}). A root without a `project.yaml` (a
 * `.markspec.yaml`-only project) and a `null` root (no project) yield the
 * default config. A malformed `project.yaml` prints an error and exits 1,
 * as in {@linkcode requireProjectConfig}.
 */
async function loadProjectConfigAt(
  projectRoot: string | null,
): Promise<{ config: ProjectConfig; projectRoot: string | undefined }> {
  const { DEFAULT_PROJECT_CONFIG, loadConfig } = await import(
    "../core/mod.ts"
  );
  if (projectRoot === null) {
    return { config: DEFAULT_PROJECT_CONFIG, projectRoot: undefined };
  }
  const result = await loadConfigOrExit(() =>
    loadConfig(projectRoot, readFile)
  );
  return { config: result?.config ?? DEFAULT_PROJECT_CONFIG, projectRoot };
}

/**
 * Load the active profile chain (or null) for the current project and
 * surface any diagnostics. Called by every profile-aware subcommand so
 * `.markspec.yaml` errors are caught uniformly.
 */
export async function loadActiveProfile(projectRoot: string) {
  const { loadProfileForCommand } = await import("../core/mod.ts");
  const result = await loadProfileForCommand(projectRoot, readFile);

  let sawError = false;
  for (const diag of result.diagnostics) {
    const loc = diag.location
      ? `${diag.location.file}:${diag.location.line}`
      : "";
    console.error(`${diag.severity}[${diag.code}]: ${loc} ${diag.message}`);
    if (diag.severity === "error") sawError = true;
  }
  if (sawError) {
    Deno.exit(1);
  }
  return result.chain;
}

/**
 * Load the embedded dprint-markdown formatter, or print a clean CLI error
 * and exit 1. The plugin can fail to load (corrupt/missing WASM, a
 * restricted filesystem); a raw stack trace would be user-hostile. Shared
 * by `fmt` and `check`, which both need the formatter before their
 * write/gate loop — the load happens before any file is written. Lazily
 * imports core so subcommands that never format don't pull the plugin in.
 */
export async function loadMarkdownFormatterOrExit() {
  const { loadMarkdownFormatter } = await import("../core/mod.ts");
  try {
    return await loadMarkdownFormatter();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`error: could not load the Markdown formatter: ${msg}`);
    Deno.exit(1);
  }
}

/**
 * Run `git` with the given args and return non-empty, trimmed stdout
 * lines. Returns `[]` on any failure (non-zero exit, `git` absent,
 * permission denied) so callers degrade gracefully instead of throwing.
 * Keeping git I/O here keeps `core/` Node-safe.
 */
async function gitLines(args: string[]): Promise<string[]> {
  try {
    const { code, stdout } = await new Deno.Command("git", {
      args,
      stdout: "piped",
      stderr: "null",
    }).output();
    if (code !== 0) return [];
    return new TextDecoder()
      .decode(stdout)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  } catch {
    return [];
  }
}

/**
 * Build a `gitFile` callback for {@linkcode compileProject}. Reads a
 * file's git history with `git log --follow`. `createdAt` is the oldest
 * commit's author date, `modifiedAt` the newest, `revision` the short
 * SHA of the most recent commit (git logs newest-first by default).
 * Contributor names are fetched only when `withContributors` is true
 * (PII-adjacent, ADR-006); the compiler deduplicates and sorts them. An
 * untracked file or unavailable `git` yields undefined so
 * `properties.git` stays unset.
 */
export function makeGitFile(withContributors: boolean) {
  return async (path: string) => {
    const dates = await gitLines([
      "log",
      "--follow",
      "--format=%aI",
      "--",
      path,
    ]);
    if (dates.length === 0) return undefined;
    const modifiedAt = dates[0];
    const createdAt = dates[dates.length - 1];
    const revLine = await gitLines([
      "log",
      "--follow",
      "--format=%h",
      "-1",
      "--",
      path,
    ]);
    const revision = revLine[0];
    let contributors: readonly string[] | undefined;
    if (withContributors) {
      const names = await gitLines([
        "log",
        "--follow",
        "--format=%aN",
        "--",
        path,
      ]);
      if (names.length > 0) contributors = names;
    }
    return { createdAt, modifiedAt, revision, contributors };
  };
}

/**
 * Render a diagnostic's location for human-facing output. A location
 * inside a delivered corpus file is mapped to the stable
 * `<profile-id>@<version>:<relative-path>:<line>` form (ADR-030) instead
 * of the raw `.markspec/cache/...` (or local package) absolute path —
 * consumers should never see the cache layout. Locations outside the
 * corpus render as `<file>:<line>`, unchanged from prior behavior.
 */
export function renderDiagnosticLocation(
  diag: { location?: { file: string; line: number } },
  corpusIndex: ReadonlyMap<string, DeliveredDocument>,
): string {
  if (!diag.location) return "";
  const doc = corpusIndex.get(diag.location.file);
  if (doc) {
    return `${corpusOriginLabel(doc)}:${doc.path}:${diag.location.line}`;
  }
  return `${diag.location.file}:${diag.location.line}`;
}

/** The delivered corpus of an active profile chain, paired with the
 * path→document index CLI surfaces use to recognise corpus locations. */
export interface ProjectCorpus {
  readonly entries: readonly Entry[];
  readonly diagnostics: readonly Diagnostic[];
  readonly corpusIndex: ReadonlyMap<string, DeliveredDocument>;
}

/**
 * Load the active profile's delivered corpus (ADR-030) and build its
 * path→document index in a single pass. The one corpus-load site shared by
 * {@linkcode compileProject} and the `check` command's composite gate, so the
 * two never diverge on how the corpus is loaded or indexed. A `null` chain (no
 * active profile) yields an empty corpus and index.
 */
export async function loadProjectCorpus(
  chain: ProfileChain | null,
): Promise<ProjectCorpus> {
  const { loadDeliveredCorpus, buildCorpusIndex } = await import(
    "../core/mod.ts"
  );
  const delivers = chain?.effective.delivers ?? [];
  const corpus = chain
    ? await loadDeliveredCorpus(delivers, readFile, (p) => Deno.realPath(p))
    : { entries: [], diagnostics: [] };
  return {
    entries: corpus.entries,
    diagnostics: corpus.diagnostics,
    corpusIndex: buildCorpusIndex(delivers),
  };
}

/**
 * Compile project files and return the result alongside the loaded profile
 * chain and the delivered-corpus index.
 * Shared helper for commands that need the compiled graph.
 *
 * Loads the active profile's delivered corpus (ADR-030) and injects it into
 * `compile()` so every graph-consuming command (`show`, `context`,
 * `dependents`, `report`, `export`) resolves trace targets that live in a
 * profile-delivered document. A corpus-load error (e.g. a declared corpus
 * file missing from the profile package) is fatal — silently compiling with
 * a partial corpus would hide a broken profile package. The returned
 * `corpusIndex` lets callers render corpus locations without rebuilding it.
 *
 * Also loads locked upstream snapshots (federated upstream, slice 4) via
 * the shared core `loadProjectUpstreams` (#771) and injects them into the same
 * `corpusEntries` bucket passed to `compile()` — both delivered-profile
 * corpus and hydrated upstream entries are origin-carrying, read-only, and
 * injected ahead of project entries, so `compile()`'s Phase-5 corpus
 * post-pass (gated on a non-empty `corpusEntries`) covers both without a
 * compiler signature change. Unlike the corpus load, a failed upstream load
 * is soft-fail: a stale or missing `.markspec/cache/upstreams/` must not
 * abort `show`/`compile`/etc., so its diagnostics are surfaced but never
 * trigger `Deno.exit`.
 *
 * The returned `config` is the `project.yaml` this compile already loaded —
 * callers that need org-schema fields (e.g. `report`'s `dependencies:`) use
 * it instead of re-loading the file. Without `opts.projectRoot` it is the
 * `project.yaml` found from the current directory
 * ({@linkcode requireProjectConfig}, which exits 1 when there is none). With
 * `opts.projectRoot` it is the `project.yaml` of that root, or the default
 * config when that root has none or `opts.projectRoot` is `null`.
 */
export async function compileProject(
  paths: string[],
  opts: {
    withContributors?: boolean;
    /**
     * The project root to compile against. Omitted: the `project.yaml`
     * found from the current directory, which must exist. A string: that
     * root (its `project.yaml` is optional, as in a `.markspec.yaml`-only
     * project). `null`: no project — no profile, no upstreams, default
     * config (#845).
     */
    projectRoot?: string | null;
  } = {},
): Promise<{
  result: CompileResult;
  chain: ProfileChain | null;
  corpusIndex: ReadonlyMap<string, DeliveredDocument>;
  config: ProjectConfig;
}> {
  const configResult = opts.projectRoot === undefined
    ? await requireProjectConfig()
    : await loadProjectConfigAt(opts.projectRoot);
  const projectRoot = configResult.projectRoot;
  const chain = projectRoot !== undefined
    ? await loadActiveProfile(projectRoot)
    : null;
  const { compile, loadProjectUpstreams, parseLockfile } = await import(
    "../core/mod.ts"
  );
  const corpus = await loadProjectCorpus(chain);
  const corpusIndex = corpus.corpusIndex;
  let corpusError = false;
  for (const diag of corpus.diagnostics) {
    console.error(
      `${diag.severity}[${diag.code}]: ` +
        `${renderDiagnosticLocation(diag, corpusIndex)} ${diag.message}`,
    );
    if (diag.severity === "error") corpusError = true;
  }
  if (corpusError) Deno.exit(1);

  // Federated upstream (slice 4): read markspec.lock and hydrate its
  // locked upstream snapshots. Soft-fail — no corpusError-style guard;
  // a missing/malformed lockfile or a cold/stale upstream cache must
  // never abort `show`/`compile`/etc.
  const lockRaw = projectRoot !== undefined
    ? await readFile(join(projectRoot, "markspec.lock"))
    : undefined;
  const lockfile = lockRaw !== undefined
    ? parseLockfile(lockRaw).lockfile
    : undefined;
  const upstreams = projectRoot !== undefined
    ? await loadProjectUpstreams(projectRoot, lockfile, readFile)
    : { entries: [], diagnostics: [] };
  for (const diag of upstreams.diagnostics) {
    console.error(
      `${diag.severity}[${diag.code}]: ` +
        `${renderDiagnosticLocation(diag, corpusIndex)} ${diag.message}`,
    );
  }

  const withContributors = opts.withContributors ?? false;
  const result = await compile(paths, {
    readFile: (p) => Deno.readTextFile(p),
    profile: chain?.effective ?? undefined,
    statFile: (p) =>
      Deno.stat(p).then((s) => ({ mtime: s.mtime })).catch(() => undefined),
    gitFile: makeGitFile(withContributors),
    withContributors,
    corpusEntries: [...corpus.entries, ...upstreams.entries],
  });

  for (const diag of result.diagnostics) {
    console.error(
      `${diag.severity}[${diag.code}]: ${
        renderDiagnosticLocation(diag, corpusIndex)
      } ${diag.message}`,
    );
  }

  // Merge the corpus-load and upstream-load diagnostics into the returned
  // result so serialized artifacts (`export`/`compile --format json`)
  // surface them too — otherwise a machine consumer parsing the JSON would
  // believe the corpus/upstream state is healthy while other surfaces
  // (`check`, MCP) flag it (#674 f4). Only warning/info corpus diagnostics
  // reach here: error-severity ones already exited above; upstream
  // diagnostics reach here regardless of severity (soft-fail). Prepended so
  // they read as load-time findings, ahead of the compiler's own
  // diagnostics. All three sets were already printed to stderr above, so
  // this changes serialization only, never the console.
  const merged: CompileResult = {
    ...result,
    diagnostics: [
      ...corpus.diagnostics,
      ...upstreams.diagnostics,
      ...result.diagnostics,
    ],
  };

  return { result: merged, chain, corpusIndex, config: configResult.config };
}

/**
 * RFC-4180 quoting: surround with double quotes when the value contains
 * a comma, a double quote, a carriage return, or a newline; double any
 * embedded quotes inside.
 */
export function csvQuote(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/** Deno-backed I/O implementation for `core/discovery`. CLI entry
 * points are allowed to use `Deno.*` APIs. */
export function denoDiscoveryIO(): DiscoveryIO {
  return {
    readDir: (path: string) => Deno.readDir(path),
    readFile: async (path: string) => {
      try {
        return await Deno.readTextFile(path);
      } catch {
        return undefined;
      }
    },
  };
}

/** Files of one invocation that belong to the same project. */
export interface ScopeGroup {
  /** The project root of these files, as the LSP resolves it (see
   * {@linkcode resolveScope}), or `undefined` when no config file is above
   * them. */
  readonly projectRoot: string | undefined;
  /** Files to operate on (absolute for discovered, verbatim for explicit). */
  readonly files: string[];
  /**
   * Bare invocation only: every file the walk of this project root finds
   * with its own `exclude:` list, including the files of projects nested
   * below it. This is the file set `markspec lock` pins for this root, so
   * the lockfile drift gate (MSL-L212) compares against it, not against
   * `files`.
   */
  readonly treeFiles?: readonly string[];
}

/** Resolved invocation scope for a file-consuming verb. */
export interface ResolvedScope {
  /**
   * The files grouped by project root. Explicit arguments: in the order the
   * first file of each group appeared, at least one group. Bare invocation:
   * the project root of the current directory first, then each project
   * nested below it, sorted by path. Each group is validated with its own
   * profile and tool config (#845).
   */
  readonly groups: readonly ScopeGroup[];
  /** True when no args were given — the whole-project case. Drives
   * project-wide-only gates (MSL-L006, lockfile drift). */
  readonly projectWide: boolean;
}

/** Load the `.markspec.yaml` `exclude:` list of `root`; on a malformed
 * `.markspec.yaml`, print its errors and exit 1. */
async function loadExcludeOrExit(root: string): Promise<readonly string[]> {
  const { loadToolConfig } = await import("../core/mod.ts");
  // A malformed .markspec.yaml IS surfaced — silently falling back to "no
  // excludes" would widen file discovery in a way the author never
  // intended, matching the prior ConfigError-is-fatal posture.
  const toolConfigResult = await loadToolConfig(root, readFile);
  const toolConfigErrors = toolConfigResult.diagnostics.filter(
    (d) => d.severity === "error",
  );
  if (toolConfigErrors.length > 0) {
    for (const d of toolConfigErrors) {
      console.error(`error: ${d.message}`);
    }
    Deno.exit(1);
  }
  return toolConfigResult.config.exclude;
}

/** The user's home folder, or `undefined` when it is unknown or the
 * environment cannot be read (no `--allow-env`). */
function homeDir(): string | undefined {
  try {
    return Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  } catch {
    return undefined;
  }
}

/** The {@linkcode ProjectRootResolver} the CLI uses: real file system, and
 * the user's home folder as the upper limit of the walk up. */
export async function cliProjectRootResolver(): Promise<ProjectRootResolver> {
  const { createProjectRootResolver } = await import("../core/mod.ts");
  return createProjectRootResolver(denoDiscoveryIO(), { homeDir: homeDir() });
}

/**
 * Walk `root` and every project nested below it the way the LSP indexes a
 * workspace opened at `root`: each project root is walked with its own
 * `.markspec.yaml` `exclude:` list, and a file belongs to the nearest
 * project root above it. Returns one group per project root, `root` first,
 * then the nested roots sorted by path; each group carries the unfiltered
 * walk of its root as `treeFiles`.
 */
async function walkProjects(
  root: string,
  resolver: ProjectRootResolver,
  extensions: ReadonlySet<string>,
): Promise<Required<ScopeGroup>[]> {
  const { discoverFiles, nearestRoot } = await import("../core/mod.ts");
  const io = denoDiscoveryIO();
  const roots = [root, ...await resolver.nestedRoots(root)];
  const groups: Required<ScopeGroup>[] = [];
  for (const projectRoot of roots) {
    const exclude = await loadExcludeOrExit(projectRoot);
    const treeFiles: string[] = [];
    // A nested project's walk also applies the `.gitignore` files between
    // the outermost root and its own root (not the enclosing `exclude:`
    // lists), so it skips the files those `.gitignore` files ignore.
    const inheritGitignoreFrom = projectRoot === root ? undefined : root;
    for await (
      const f of discoverFiles(projectRoot, io, {
        extensions,
        exclude,
        inheritGitignoreFrom,
      })
    ) {
      treeFiles.push(f);
    }
    const files = treeFiles.filter((f) =>
      nearestRoot(dirname(f), roots) === projectRoot
    );
    groups.push({ projectRoot, files, treeFiles });
  }
  return groups;
}

/**
 * Shared scope resolution for `check` / `lint` / `fmt`. Project roots are
 * resolved the way the LSP and the MCP server resolve them (#845), so the
 * same file is checked with the same project, profile and `markspec.lock`
 * on every surface:
 *
 *   - no args  → whole project via gitignore-aware discovery, with a
 *     one-line scope header on stderr. The project root is the owner of the
 *     current directory, found the same way as for explicit arguments
 *     ({@linkcode createProjectRootResolver}). Projects nested below it (found as the LSP finds them:
 *     configs in hidden, gitignored or excluded folders do not count) form
 *     their own groups; each project's `.markspec.yaml` `exclude:` list
 *     applies to its own walk;
 *   - explicit args → files verbatim; a directory expands to the files of
 *     the bare walk of its project that lie below it (so `check .` at a
 *     project root checks the bare file set), or to every relevant file
 *     below it when no project is above it. Each file's project root is
 *     resolved from the file's own directory, not from the current
 *     directory: the nearest config root, unless an enclosing project
 *     hides that config, in which case the enclosing project owns the file
 *     ({@linkcode createProjectRootResolver}). Files are grouped by that
 *     root.
 *
 * Exits 1 (with a hint) when no args are given and no project root is
 * found, when a `.markspec.yaml` is malformed, or when an explicit path
 * does not exist.
 */
export async function resolveScope(
  args: string[],
  opts: {
    /** Header verb, e.g. "checking" / "formatting" / "linting". */
    verb: string;
    /** Extension filter; defaults to RELEVANT_EXTENSIONS. */
    extensions?: ReadonlySet<string>;
    /** Suppress the scope header (set for -q and --format json). */
    quiet?: boolean;
  },
): Promise<ResolvedScope> {
  const {
    discoverFiles,
    isWithin,
    RELEVANT_EXTENSIONS,
  } = await import("../core/mod.ts");
  const extensions = opts.extensions ?? RELEVANT_EXTENSIONS;
  const io = denoDiscoveryIO();
  const resolver = await cliProjectRootResolver();

  if (args.length === 0) {
    const projectRoot = await resolver.ownerOf(Deno.cwd());
    if (projectRoot === undefined) {
      console.error("error: no project root found");
      console.error(`  searched from ${Deno.cwd()} to filesystem root`);
      console.error(
        "  a project.yaml or .markspec.yaml marks a project root",
      );
      console.error(
        "  run 'markspec init' to create one, or pass explicit files",
      );
      Deno.exit(1);
    }
    const groups = await walkProjects(projectRoot, resolver, extensions);
    if (!opts.quiet) {
      const total = groups.reduce((n, g) => n + g.files.length, 0);
      const projects = groups.length > 1 ? ` (${groups.length} projects)` : "";
      console.error(
        `${opts.verb} ${total} file(s) under ${projectRoot}${projects}`,
      );
    }
    return { groups, projectWide: true };
  }

  const files: string[] = [];
  // The bare walk of each project, reused by every directory argument of
  // that project.
  const walks = new Map<string, string[]>();
  let firstArgDir: string | undefined;
  for (const arg of args) {
    let info: Deno.FileInfo;
    try {
      info = await Deno.stat(arg);
    } catch {
      console.error(`error: ${arg}: no such file or directory`);
      Deno.exit(1);
    }
    const argDir = info.isDirectory ? resolve(arg) : dirname(resolve(arg));
    firstArgDir ??= argDir;
    if (!info.isDirectory) {
      files.push(arg);
      continue;
    }
    const owner = await resolver.ownerOf(argDir);
    if (owner === undefined) {
      for await (const f of discoverFiles(arg, io, { extensions })) {
        files.push(f);
      }
      continue;
    }
    let walked = walks.get(owner);
    if (walked === undefined) {
      walked = (await walkProjects(owner, resolver, extensions))
        .flatMap((g) => g.files);
      walks.set(owner, walked);
    }
    // Keep the path form of the argument (relative stays relative), as the
    // plain directory walk does.
    for (const f of walked) {
      if (isWithin(argDir, f)) files.push(join(arg, relative(argDir, f)));
    }
  }

  // No file to operate on: keep one group rooted at the project of the
  // first argument, so the command still loads (and reports on) the
  // profile of the folder it was asked about.
  if (files.length === 0) {
    const projectRoot = firstArgDir === undefined
      ? undefined
      : await resolver.ownerOf(firstArgDir);
    return { groups: [{ projectRoot, files }], projectWide: false };
  }

  // Group the files by the project root that owns each file. The resolver
  // caches its answer per directory: files of one folder share one lookup.
  const groups = new Map<string | undefined, string[]>();
  for (const file of files) {
    const root = await resolver.ownerOf(dirname(resolve(file)));
    const group = groups.get(root);
    if (group) group.push(file);
    else groups.set(root, [file]);
  }
  return {
    groups: [...groups].map(([projectRoot, groupFiles]) => ({
      projectRoot,
      files: groupFiles,
    })),
    projectWide: false,
  };
}
