/**
 * @module cli/install/mcp_orchestrator
 *
 * `markspec mcp install` orchestrator — mirrors `runLspInstall`
 * structurally, with two key differences:
 *
 * 1. The managed block is a JSON-key value (under `mcpServers.markspec`)
 *    edited via `applyJsonBlock` / `removeJsonBlock`, not a Lua fence.
 * 2. `--scope=workspace` is rejected for `--client=claude-desktop` —
 *    Claude Desktop is a per-user app with no workspace config.
 *
 * Boundary contract (kept pure for testability): `runMcpInstall(options)`
 * returns an `OrchestratorResult`. No `process.exit`, no global state.
 * The CLI action wrapper in `mcp_cmd.ts` writes stdout/stderr and
 * exits with the returned `exitCode`.
 */

import { dirname } from "@std/path";
import {
  MCP_CLIENT_IDS,
  type McpAdapter,
  type McpClientId,
  suggestId,
} from "./adapters.ts";
import {
  claudeDesktopDescriptor,
  cursorAdapter,
  vscodeMcpAdapter,
} from "./mcp_adapters.ts";
import { claudeCodeDescriptor } from "./mcp_adapters_claude_code.ts";
import { opencodeDescriptor } from "./mcp_adapters_opencode.ts";
import { applyJsonBlock, removeJsonBlock } from "./managed_block.ts";
import { writeBackup } from "./backup.ts";
import { renderDiff } from "./preview.ts";

/** Options accepted by {@linkcode runMcpInstall}. */
export interface McpInstallOptions {
  readonly client: string;
  readonly scope?: string;
  readonly binaryPath: string;
  readonly print?: boolean;
  readonly force?: boolean;
  /** Reserved; no color output is emitted yet. */
  readonly noColor?: boolean;
  readonly remove?: boolean;
  /**
   * Test-only seam: lets unit tests inject a known cwd, HOME,
   * APPDATA, and TTY verdict without touching the host environment.
   */
  readonly env?: {
    readonly cwd?: string;
    readonly home?: string;
    readonly appData?: string;
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
 * Run `markspec mcp install` with the supplied options. Pure boundary:
 * returns the stdout/stderr/exitCode triple the CLI action will surface.
 * Performs file I/O internally.
 */
export async function runMcpInstall(
  options: McpInstallOptions,
): Promise<OrchestratorResult> {
  // 1. Validate --client.
  if (!MCP_CLIENT_IDS.includes(options.client as McpClientId)) {
    const suggestion = suggestId(options.client, MCP_CLIENT_IDS);
    const hint = suggestion ? `\n  did you mean: ${suggestion}` : "";
    return {
      stdout: "",
      stderr: `error: unknown client '${options.client}' (known: ${
        MCP_CLIENT_IDS.join(", ")
      })${hint}\n`,
      exitCode: 1,
    };
  }
  const clientId = options.client as McpClientId;

  // 2. Cursor — legacy print-only. Spec §5.2 keeps Cursor in the
  //    print-only tier; the orchestrator just delegates.
  if (clientId === "cursor") {
    const r = cursorAdapter();
    return {
      stdout: r.stdout ? `${r.stdout}\n` : "",
      stderr: r.stderr ? `${r.stderr}\n` : "",
      exitCode: r.exitCode,
    };
  }

  // 3. VS Code — verify-only.
  if (clientId === "vscode") {
    const r = await vscodeMcpAdapter();
    return {
      stdout: r.stdout ? `${r.stdout}\n` : "",
      stderr: r.stderr ? `${r.stderr}\n` : "",
      exitCode: r.exitCode,
    };
  }

  // 4. Managed-block flow — claude-desktop, claude-code, or opencode.
  if (
    clientId === "claude-desktop" ||
    clientId === "claude-code" ||
    clientId === "opencode"
  ) {
    const adapter: McpAdapter = clientId === "claude-desktop"
      ? claudeDesktopDescriptor
      : clientId === "claude-code"
      ? claudeCodeDescriptor
      : opencodeDescriptor;
    return await runManagedBlockFlow(adapter, options);
  }

  // Defensive: clientId is fully covered above, but TypeScript can't
  // narrow `MCP_CLIENT_IDS.includes(...)` to the union.
  return {
    stdout: "",
    stderr: `error: client '${clientId}' has no registered adapter\n`,
    exitCode: 1,
  };
}

/**
 * Shared managed-block flow used by claude-desktop, claude-code, and opencode.
 * Reads current content, computes next via `applyJsonBlock` /
 * `removeJsonBlock`, handles --print / --force / atomic write /
 * sidecar backup.
 */
async function runManagedBlockFlow(
  adapter: McpAdapter,
  options: McpInstallOptions,
): Promise<OrchestratorResult> {
  const isClaudeDesktop = adapter.id === "claude-desktop";
  const isProjectScoped = adapter.id === "claude-code" ||
    adapter.id === "opencode";

  if (isClaudeDesktop && options.scope === "workspace") {
    return {
      stdout: "",
      stderr:
        `error: --scope=workspace is not supported for --client=claude-desktop (per-user app); use --scope=user or omit\n`,
      exitCode: 1,
    };
  }
  if (isProjectScoped && options.scope === "user") {
    return {
      stdout: "",
      stderr:
        `error: --scope=user is not supported for --client=${adapter.id} (project-scoped only); use --scope=workspace or omit\n`,
      exitCode: 1,
    };
  }
  if (
    options.scope !== undefined &&
    options.scope !== "user" &&
    options.scope !== "workspace"
  ) {
    return {
      stdout: "",
      stderr:
        `error: unknown scope '${options.scope}' (known: user, workspace)\n`,
      exitCode: 1,
    };
  }

  const cwd = options.env?.cwd ?? Deno.cwd();
  const readHome = (): string => {
    if (options.env?.home !== undefined) return options.env.home;
    try {
      return Deno.env.get(
        Deno.build.os === "windows" ? "USERPROFILE" : "HOME",
      ) ?? "";
    } catch {
      return "";
    }
  };
  const readAppData = (): string | undefined => {
    if (options.env?.appData !== undefined) return options.env.appData;
    try {
      return Deno.env.get("APPDATA") ?? undefined;
    } catch {
      return undefined;
    }
  };
  const isTty = options.env?.isTty ?? Deno.stdin.isTerminal();

  // Resolve the target config path. claude-desktop uses "user" (default
  // when scope is omitted); claude-code and opencode use "workspace" with
  // workspaceRoot=cwd.
  const scope: "user" | "workspace" = isProjectScoped ? "workspace" : "user";
  const configPath = adapter.resolveConfigPath(
    scope,
    cwd,
    readHome(),
    readAppData(),
    isProjectScoped ? cwd : undefined,
  );

  // 5. Read current content. Missing file → empty string.
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
        stderr: `error: cannot read ${configPath}: ${(err as Error).message}\n`,
        exitCode: 1,
      };
    }
  }

  // 6. Compute next content.
  const next = options.remove
    ? removeJsonBlock(current, adapter.jsonPath)
    : applyJsonBlock(
      current,
      adapter.jsonPath,
      adapter.renderBlock({ binaryPath: options.binaryPath }),
    );

  // 7. Idempotence check.
  if (next === current) {
    const msg = options.remove
      ? `markspec mcp install: already removed (no managed entry in ${configPath})\n`
      : `markspec mcp install: already up to date (${configPath})\n`;
    return { stdout: "", stderr: msg, exitCode: 0 };
  }

  // 8. --print path.
  if (options.print) {
    return {
      stdout: next,
      stderr: `would write to ${configPath}\n`,
      exitCode: 0,
    };
  }

  // 9. TTY / non-TTY handling.
  if (!options.force) {
    const diff = renderDiff(current, next, configPath);
    if (!isTty) {
      return {
        stdout: "",
        stderr: `${diff}` +
          `error: non-interactive context (stdin is not a TTY); pass --force to apply or --print to skip writing\n`,
        exitCode: 1,
      };
    }
    return {
      stdout: "",
      stderr: `${diff}` +
        `aborted: re-run with --force to apply\n`,
      exitCode: 0,
    };
  }

  // 10. Write path. Backup only when the original file existed.
  let backupNote = "";
  if (fileExists) {
    try {
      const backupAt = await writeBackup(configPath);
      backupNote = `backup: ${backupAt}\n`;
    } catch (err) {
      return {
        stdout: "",
        stderr: `error: backup failed for ${configPath}: ${
          (err as Error).message
        }\n`,
        exitCode: 1,
      };
    }
  }

  try {
    await Deno.mkdir(dirname(configPath), { recursive: true });
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) {
      return {
        stdout: "",
        stderr:
          `${backupNote}error: cannot create parent directory for ${configPath}: ${
            (err as Error).message
          }\n`,
        exitCode: 1,
      };
    }
  }

  const tmpPath = `${configPath}.tmp`;
  try {
    await Deno.writeTextFile(tmpPath, next);
    await Deno.rename(tmpPath, configPath);
  } catch (err) {
    try {
      await Deno.remove(tmpPath);
    } catch { /* ignore */ }
    return {
      stdout: "",
      stderr: `${backupNote}error: write failed for ${configPath}: ${
        (err as Error).message
      }\n`,
      exitCode: 1,
    };
  }

  return {
    stdout: "",
    stderr: `${backupNote}wrote ${configPath}\n`,
    exitCode: 0,
  };
}
