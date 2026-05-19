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

import { ConfigError, CORE_SCHEMA_VERSION, VERSION } from "../core/mod.ts";
import type { CompileResult, ProfileChain, ReadFile } from "../core/mod.ts";

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
          "  markspec format <file> / markspec validate <file>\n" +
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
 * Compile project files and return the result alongside the loaded profile chain.
 * Shared helper for commands that need the compiled graph.
 */
export async function compileProject(
  paths: string[],
  opts: { withContributors?: boolean } = {},
): Promise<{ result: CompileResult; chain: ProfileChain | null }> {
  const configResult = await requireProjectConfig();
  const chain = await loadActiveProfile(configResult.projectRoot);
  const { compile } = await import("../core/mod.ts");
  const withContributors = opts.withContributors ?? false;
  const result = await compile(paths, {
    readFile: (p) => Deno.readTextFile(p),
    profile: chain?.effective ?? undefined,
    statFile: (p) =>
      Deno.stat(p).then((s) => ({ mtime: s.mtime })).catch(() => undefined),
    gitFile: makeGitFile(withContributors),
    withContributors,
  });

  for (const diag of result.diagnostics) {
    const loc = diag.location
      ? `${diag.location.file}:${diag.location.line}`
      : "";
    console.error(`${diag.severity}[${diag.code}]: ${loc} ${diag.message}`);
  }

  return { result, chain };
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
