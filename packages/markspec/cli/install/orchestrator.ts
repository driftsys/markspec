/**
 * @module cli/install/orchestrator
 *
 * `markspec lsp install` orchestrator — wires Tasks 1-5 (workspace
 * discovery, managed-block writer, backup, preview, adapter descriptors)
 * into the full user-facing flow described in
 * `docs/spec/internal/markspec-toolchain-distribution.md` §4, §6, §7.
 *
 * Boundary contract (kept pure for testability): `runLspInstall(options)`
 * returns an `OrchestratorResult`. No `process.exit`, no global state.
 * The CLI action wrapper in `lsp_cmd.ts` writes stdout/stderr and exits
 * with the returned `exitCode`.
 *
 * Slice A scope:
 *   - Full Neovim flow (workspace marker, managed-block, backup, diff,
 *     non-TTY safety, --print, --force, --remove).
 *   - VS Code / Zed remain print-only (legacy adapter wrappers); Slice B/C
 *     migrate them onto this same orchestrator.
 *
 * The TTY confirmation path is intentionally simplified for Slice A:
 * `--force` is the only way to apply. TTY-but-no-`--force` prints the
 * diff and aborts with a remediation hint; live interactive `confirm()`
 * integration is deferred.
 */

import { dirname } from "@std/path";
import { LSP_EDITOR_IDS, type LspEditorId, suggestId } from "./adapters.ts";
import { neovimDescriptor, vscodeAdapter, zedAdapter } from "./lsp_adapters.ts";
import { findWorkspaceRoot, NO_WORKSPACE_MARKER_STDERR } from "./workspace.ts";
import { applyLuaBlock, removeLuaBlock } from "./managed_block.ts";
import { writeBackup } from "./backup.ts";
import { renderDiff } from "./preview.ts";

/** Options accepted by {@linkcode runLspInstall}. */
export interface LspInstallOptions {
  readonly editor: string;
  readonly scope?: string;
  readonly binaryPath: string;
  readonly print?: boolean;
  readonly force?: boolean;
  /** Reserved; no color output is emitted yet. */
  readonly noColor?: boolean;
  readonly remove?: boolean;
  /**
   * Test-only seam: lets unit tests inject a known cwd, HOME, and TTY
   * verdict without touching the host environment. Production callers
   * (the CLI action) omit this — the orchestrator falls back to Deno.cwd(),
   * Deno.env.get("HOME"), and Deno.stdin.isTerminal().
   */
  readonly env?: {
    readonly cwd?: string;
    readonly home?: string;
    readonly isTty?: boolean;
  };
}

/** Result shape returned by the orchestrator. */
export interface OrchestratorResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Run `markspec lsp install` with the supplied options. Pure boundary:
 * returns the stdout/stderr/exitCode triple the CLI action will surface.
 * Performs file I/O internally — that's a CLI internal, not a library
 * concern.
 */
export async function runLspInstall(
  options: LspInstallOptions,
): Promise<OrchestratorResult> {
  // 1. Validate --editor.
  if (!LSP_EDITOR_IDS.includes(options.editor as LspEditorId)) {
    const suggestion = suggestId(options.editor, LSP_EDITOR_IDS);
    const hint = suggestion ? `\n  did you mean: ${suggestion}` : "";
    return {
      stdout: "",
      stderr: `error: unknown editor '${options.editor}' (known: ${
        LSP_EDITOR_IDS.join(", ")
      })${hint}\n`,
      exitCode: 1,
    };
  }
  const editorId = options.editor as LspEditorId;

  // 2. VS Code — verify-and-report (Slice B). Reads the user settings.json
  //    and compares `markspec.server.path` against the supplied binary path.
  if (editorId === "vscode") {
    const r = await vscodeAdapter({ binaryPath: options.binaryPath });
    return {
      stdout: r.stdout ? `${r.stdout}\n` : "",
      stderr: r.stderr ? `${r.stderr}\n` : "",
      exitCode: r.exitCode,
    };
  }
  // Legacy print-only fallback for zed (Slice C migrates it).
  if (editorId === "zed") {
    const r = zedAdapter();
    return {
      stdout: r.stdout ? `${r.stdout}\n` : "",
      stderr: r.stderr ? `${r.stderr}\n` : "",
      exitCode: r.exitCode,
    };
  }

  // 3. Neovim full path.
  const cwd = options.env?.cwd ?? Deno.cwd();
  // HOME is read lazily so workspace-scope invocations don't require
  // `--allow-env` (resolveConfigPath only consults `home` for user scope).
  const readHome = (): string => {
    if (options.env?.home !== undefined) return options.env.home;
    try {
      return Deno.env.get("HOME") ?? "";
    } catch {
      return "";
    }
  };
  const isTty = options.env?.isTty ?? Deno.stdin.isTerminal();

  // Resolve scope per §4.4: explicit user → user, explicit workspace → walk
  // up + fallback to user with a preamble warning, auto-detect when no flag.
  let stderrPreamble = "";
  let resolvedScope: "user" | "workspace";
  let workspaceRoot: string | undefined;

  if (options.scope === "user") {
    resolvedScope = "user";
  } else if (options.scope === "workspace") {
    workspaceRoot = await findWorkspaceRoot(cwd);
    if (workspaceRoot) {
      resolvedScope = "workspace";
    } else {
      stderrPreamble += `${NO_WORKSPACE_MARKER_STDERR}\n`;
      resolvedScope = "user";
    }
  } else if (options.scope === undefined) {
    workspaceRoot = await findWorkspaceRoot(cwd);
    resolvedScope = workspaceRoot ? "workspace" : "user";
  } else {
    return {
      stdout: "",
      stderr:
        `error: unknown scope '${options.scope}' (known: user, workspace)\n`,
      exitCode: 1,
    };
  }

  const configPath = neovimDescriptor.resolveConfigPath(
    resolvedScope,
    cwd,
    resolvedScope === "user" ? readHome() : "",
    workspaceRoot,
  );

  // 4. Read current file content. Missing file → empty string.
  let current = "";
  let fileExists = true;
  try {
    current = await Deno.readTextFile(configPath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      current = "";
      fileExists = false;
    } else {
      return {
        stdout: "",
        stderr: `${stderrPreamble}error: cannot read ${configPath}: ${
          (err as Error).message
        }\n`,
        exitCode: 1,
      };
    }
  }

  // 5. Compute next content. Block rendering is only needed for the
  // apply path — the remove path has no use for blockContent.
  const next = options.remove ? removeLuaBlock(current) : applyLuaBlock(
    current,
    neovimDescriptor.renderBlock({
      binaryPath: options.binaryPath,
    }),
  );

  // 6. Idempotence check.
  if (next === current) {
    const msg = options.remove
      ? `markspec lsp install: already removed (no managed block at ${configPath})\n`
      : `markspec lsp install: already up to date (${configPath})\n`;
    return {
      stdout: "",
      stderr: `${stderrPreamble}${msg}`,
      exitCode: 0,
    };
  }

  // 7. --print path: emit `next` to stdout, "would write" hint to stderr.
  if (options.print) {
    return {
      stdout: next,
      stderr: `${stderrPreamble}would write to ${configPath}\n`,
      exitCode: 0,
    };
  }

  // 8. TTY / non-TTY handling.
  if (!options.force) {
    const diff = renderDiff(current, next, configPath);
    if (!isTty) {
      return {
        stdout: "",
        stderr: `${stderrPreamble}${diff}` +
          `error: non-interactive context (stdin is not a TTY); pass --force to apply or --print to skip writing\n`,
        exitCode: 1,
      };
    }
    // Slice A: TTY-but-no-`--force` aborts with a remediation hint.
    // Live `confirm()` integration is deferred to a follow-up.
    return {
      stdout: "",
      stderr: `${stderrPreamble}${diff}` +
        `aborted: re-run with --force to apply\n`,
      exitCode: 0,
    };
  }

  // 9. Write path. Backup is taken whenever the original file existed —
  // even an empty placeholder file is intentional user content (§6.3).
  let backupNote = "";
  if (fileExists) {
    try {
      const backupAt = await writeBackup(configPath);
      backupNote = `backup: ${backupAt}\n`;
    } catch (err) {
      return {
        stdout: "",
        stderr: `${stderrPreamble}error: backup failed for ${configPath}: ${
          (err as Error).message
        }\n`,
        exitCode: 1,
      };
    }
  }

  // Ensure parent directory exists (e.g. .nvim/ or ~/.config/nvim/lsp/).
  try {
    await Deno.mkdir(dirname(configPath), { recursive: true });
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) {
      return {
        stdout: "",
        stderr:
          `${stderrPreamble}${backupNote}error: cannot create parent directory for ${configPath}: ${
            (err as Error).message
          }\n`,
        exitCode: 1,
      };
    }
  }

  // Atomic write: stage to `<path>.tmp`, then rename. Prevents partial
  // files on crash mid-write.
  const tmpPath = `${configPath}.tmp`;
  try {
    await Deno.writeTextFile(tmpPath, next);
    await Deno.rename(tmpPath, configPath);
  } catch (err) {
    // Best-effort cleanup of the staged tmp file.
    try {
      await Deno.remove(tmpPath);
    } catch { /* ignore */ }
    return {
      stdout: "",
      stderr:
        `${stderrPreamble}${backupNote}error: write failed for ${configPath}: ${
          (err as Error).message
        }\n`,
      exitCode: 1,
    };
  }

  return {
    stdout: "",
    stderr: `${stderrPreamble}${backupNote}wrote ${configPath}\n`,
    exitCode: 0,
  };
}
