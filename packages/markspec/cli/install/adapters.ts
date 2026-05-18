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
export type McpClientId = "claude-desktop" | "cursor" | "vscode";

export const LSP_EDITOR_IDS: readonly LspEditorId[] = [
  "vscode",
  "neovim",
  "zed",
];
export const MCP_CLIENT_IDS: readonly McpClientId[] = [
  "claude-desktop",
  "cursor",
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
