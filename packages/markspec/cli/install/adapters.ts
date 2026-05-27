/**
 * @module cli/install/adapters
 *
 * Adapter registry for `markspec lsp install` and `markspec mcp install`.
 * Single source of truth for known editor and client IDs, plus a
 * Levenshtein-based typo suggestion helper.
 */

/** Result returned by every install adapter. */
export interface AdapterResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type LspEditorId = "vscode" | "neovim" | "zed";
export type McpClientId =
  | "claude-desktop"
  | "claude-code"
  | "cursor"
  | "opencode"
  | "vscode";

export const LSP_EDITOR_IDS: readonly LspEditorId[] = [
  "vscode",
  "neovim",
  "zed",
];
export const MCP_CLIENT_IDS: readonly McpClientId[] = [
  "claude-desktop",
  "claude-code",
  "cursor",
  "opencode",
  "vscode",
];

/** Max Levenshtein distance to emit a "did you mean" suggestion. */
const MAX_SUGGESTION_DISTANCE = 3;

/**
 * Return the closest known ID within {@linkcode MAX_SUGGESTION_DISTANCE},
 * or `undefined` when nothing is close enough.
 */
export function suggestId(
  input: string,
  knownIds: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestDist = MAX_SUGGESTION_DISTANCE + 1;
  for (const id of knownIds) {
    const d = levenshtein(input, id);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return bestDist <= MAX_SUGGESTION_DISTANCE ? best : undefined;
}

/** Input passed to an adapter's `renderBlock` function. */
export interface RenderBlockInput {
  /** Binary path to embed in the block — invoked name or absolute path. */
  readonly binaryPath: string;
}

/**
 * Adapter descriptor consumed by the install orchestrator. Each adapter
 * exposes pure functions (no I/O) for path resolution and block rendering;
 * the orchestrator handles file reads, diff/preview, backup, and writes.
 */
export interface LspAdapter {
  readonly id: LspEditorId;
  /**
   * Resolve the config file path for the given scope.
   * - `home` is `Deno.env.get("HOME")` (POSIX) or the Windows equivalent.
   * - `workspaceRoot` is the directory containing the workspace marker;
   *   required when `scope === "workspace"`, ignored otherwise.
   */
  resolveConfigPath(
    scope: "user" | "workspace",
    cwd: string,
    home: string,
    workspaceRoot?: string,
  ): string;
  /** Render the managed-block content (lines between the fence sentinels). */
  renderBlock(input: RenderBlockInput): string;
}

/** Result of an adapter's detection check. */
export interface DetectResult {
  /** True when at least one detection signal fired. */
  readonly detected: boolean;
  /** Human-readable signals that fired (for `--format json` and debug). */
  readonly signals: readonly string[];
}

/**
 * Test seam for detection — production wires real Deno APIs. Adapters'
 * `detect()` consumes this env so unit tests inject fakes for zero
 * filesystem / process I/O.
 */
export interface DetectEnv {
  /** Resolve a command name to a path; undefined when not on PATH. */
  readonly whichCommand: (name: string) => Promise<string | undefined>;
  /** Test whether an absolute or repo-relative path exists. */
  readonly pathExists: (path: string) => Promise<boolean>;
  /** Absolute project root, for repo-relative checks. */
  readonly projectRoot: string;
  /** Home directory, for `~/.claude/` etc. */
  readonly homeDir: string;
}

/**
 * Adapter descriptor consumed by the MCP install orchestrator. Each
 * adapter exposes pure functions (no I/O) for path resolution and block
 * rendering; the orchestrator handles file reads, diff/preview, backup,
 * and writes.
 *
 * The `renderBlock` return type is `Record<string, unknown>` — the JSON
 * object placed under `mcpServers.<name>` in the target config file.
 */
export interface McpAdapter {
  readonly id: McpClientId;
  /**
   * JSON path of the managed entry under the target config file's root.
   * For claude-desktop / claude-code this is `["mcpServers", "markspec"]`.
   * For opencode it differs — see `mcp_adapters_opencode.ts`.
   */
  readonly jsonPath: readonly (string | number)[];
  /**
   * Resolve the config file path for the given scope.
   * - `home` is `Deno.env.get("HOME")` (POSIX) or equivalent.
   * - `appData` is `Deno.env.get("APPDATA")` on Windows (undefined on POSIX).
   * - `workspaceRoot` is the directory containing the workspace marker;
   *   required when `scope === "workspace"`, ignored otherwise.
   *
   * MAY throw when `scope === "workspace"` is meaningless for the
   * client (e.g. Claude Desktop is per-user only). The orchestrator
   * rejects unsupported scopes before calling this, so a throw here
   * is a defensive guard, not a documented surface.
   */
  resolveConfigPath(
    scope: "user" | "workspace",
    cwd: string,
    home: string,
    appData?: string,
    workspaceRoot?: string,
  ): string;
  /** Render the JSON object for the `mcpServers.<name>` key. */
  renderBlock(input: RenderBlockInput): Record<string, unknown>;
  /**
   * Optional detection — returns whether the client is in use (machine
   * CLI on PATH OR repo marker OR user-home marker). Consumed by
   * `markspec init` in slice G1. Not surfaced via CLI in G0.
   */
  readonly detect?: (env: DetectEnv) => Promise<DetectResult>;
}

/** Iterative O(n·m) Levenshtein distance with a single row buffer. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr.slice();
  }
  return prev[b.length];
}
