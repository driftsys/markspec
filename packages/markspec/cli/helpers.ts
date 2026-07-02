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
  ReadFile,
} from "../core/mod.ts";

export { CORE_SCHEMA_VERSION, VERSION };

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
 * Load project config or exit with an error.
 * Used by commands that require project context.
 */
export async function requireProjectConfig() {
  const { loadConfig } = await import("../core/mod.ts");
  try {
    const result = await loadConfig(Deno.cwd(), readFile);
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
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`error: ${err.message}`);
      Deno.exit(1);
    }
    throw err;
  }
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
    ? await loadDeliveredCorpus(delivers, readFile)
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
 */
export async function compileProject(
  paths: string[],
  opts: { withContributors?: boolean } = {},
): Promise<{
  result: CompileResult;
  chain: ProfileChain | null;
  corpusIndex: ReadonlyMap<string, DeliveredDocument>;
}> {
  const configResult = await requireProjectConfig();
  const chain = await loadActiveProfile(configResult.projectRoot);
  const { compile } = await import("../core/mod.ts");
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

  const withContributors = opts.withContributors ?? false;
  const result = await compile(paths, {
    readFile: (p) => Deno.readTextFile(p),
    profile: chain?.effective ?? undefined,
    statFile: (p) =>
      Deno.stat(p).then((s) => ({ mtime: s.mtime })).catch(() => undefined),
    gitFile: makeGitFile(withContributors),
    withContributors,
    corpusEntries: corpus.entries,
  });

  for (const diag of result.diagnostics) {
    console.error(
      `${diag.severity}[${diag.code}]: ${
        renderDiagnosticLocation(diag, corpusIndex)
      } ${diag.message}`,
    );
  }

  // Merge the corpus-load diagnostics into the returned result so
  // serialized artifacts (`export`/`compile --format json`) surface them
  // too — otherwise a machine consumer parsing the JSON would believe the
  // corpus is healthy while other surfaces (`check`, MCP) flag it (#674 f4).
  // Only warning/info corpus diagnostics reach here: error-severity ones
  // already exited above. Prepended so they read as load-time findings,
  // ahead of the compiler's own diagnostics. Both sets were already printed
  // to stderr above, so this changes serialization only, never the console.
  const merged: CompileResult = {
    ...result,
    diagnostics: [...corpus.diagnostics, ...result.diagnostics],
  };

  return { result: merged, chain, corpusIndex };
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

/** Resolved invocation scope for a file-consuming verb. */
export interface ResolvedScope {
  /** Files to operate on (absolute for discovered, verbatim for explicit). */
  readonly files: string[];
  /** Discovered project root, if any (needed by profile/config loaders). */
  readonly projectRoot: string | undefined;
  /** True when no args were given — the whole-project case. Drives
   * project-wide-only gates (MSL-L006, lockfile drift). */
  readonly projectWide: boolean;
}

/**
 * Shared scope resolution for `check` / `lint` / `fmt`:
 *
 *   - no args  → whole project via gitignore-aware discovery (requires a
 *     discoverable project root; honors project.yaml `exclude:`), with a
 *     one-line scope header on stderr;
 *   - explicit args → files verbatim; directories expand recursively
 *     through the discovery filter. Exact scope, no surprises.
 *
 * Exits 1 (with a hint) when no args are given and no project root is
 * found, when project.yaml is malformed, or when an explicit path does
 * not exist.
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
    discoverProjectRoot,
    loadConfig,
    RELEVANT_EXTENSIONS,
  } = await import("../core/mod.ts");
  const extensions = opts.extensions ?? RELEVANT_EXTENSIONS;
  const io = denoDiscoveryIO();
  const projectRoot = await discoverProjectRoot(Deno.cwd(), readFile);

  if (args.length === 0) {
    if (projectRoot === undefined) {
      // project.yaml is the project-root marker (it carries name / version /
      // exclude). A `.markspec.yaml` only activates a profile (ADR-008) and
      // does not, on its own, mark a root — so the message must not imply it
      // does (#666).
      console.error("error: no project root found (project.yaml required)");
      console.error(`  searched from ${Deno.cwd()} to filesystem root`);
      console.error(
        "  a .markspec.yaml activates a profile but does not mark a project root",
      );
      console.error(
        "  run 'markspec init' to create one, or pass explicit files",
      );
      Deno.exit(1);
    }
    let exclude: readonly string[] = [];
    try {
      const configResult = await loadConfig(projectRoot, readFile);
      if (configResult) exclude = configResult.config.exclude;
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error(`error: ${err.message}`);
        Deno.exit(1);
      }
      // Other errors: discovery proceeds without exclude patterns.
    }
    const files: string[] = [];
    for await (
      const f of discoverFiles(projectRoot, io, { extensions, exclude })
    ) {
      files.push(f);
    }
    if (!opts.quiet) {
      console.error(
        `${opts.verb} ${files.length} file(s) under ${projectRoot}`,
      );
    }
    return { files, projectRoot, projectWide: true };
  }

  const files: string[] = [];
  for (const arg of args) {
    let info: Deno.FileInfo;
    try {
      info = await Deno.stat(arg);
    } catch {
      console.error(`error: ${arg}: no such file or directory`);
      Deno.exit(1);
    }
    if (info.isDirectory) {
      for await (const f of discoverFiles(arg, io, { extensions })) {
        files.push(f);
      }
    } else {
      files.push(arg);
    }
  }
  return { files, projectRoot, projectWide: false };
}
