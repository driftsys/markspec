/**
 * @module cli/install/mcp_adapters
 *
 * MCP install adapters for `markspec mcp install --client=<id>`.
 *
 * Two new shapes:
 * - `claudeDesktopDescriptor: McpAdapter` — full managed-block path
 *   (resolves to platform-specific Claude Desktop config, returns
 *   `{ command, args }` for the `mcpServers.markspec` JSON key).
 * - `vscodeMcpAdapter(options)` — verify-only, mirrors Slice B's
 *   vscodeAdapter (checks the markspec-ide extension is installed).
 *
 * Legacy print-only `cursorAdapter()` is preserved unchanged —
 * Cursor remains in the print-only tier per spec §5.2.
 */

import { join } from "@std/path";
import type {
  AdapterResult,
  McpAdapter,
  RenderBlockInput,
} from "./adapters.ts";

/** Marketplace extension ID shared with the LSP path. */
const VSCODE_EXTENSION_ID = "driftsys.markspec-ide";

/** Marketplace listing URL printed when the extension is missing. */
const VSCODE_MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=driftsys.markspec-ide";

// ---------------------------------------------------------------------------
// claudeDesktopDescriptor — full managed-block flow (spec §5.2 / §6.1)
// ---------------------------------------------------------------------------

/**
 * Claude Desktop is a per-user app — no workspace scope.
 * - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
 * - Windows: `%APPDATA%/Claude/claude_desktop_config.json`
 * - Linux: `~/.config/Claude/claude_desktop_config.json`
 *
 * The orchestrator rejects `--scope=workspace` for this client before
 * calling `resolveConfigPath`; the implementation throws as a
 * defensive guard.
 */
export const claudeDesktopDescriptor: McpAdapter = {
  id: "claude-desktop",
  jsonPath: ["mcpServers", "markspec"],
  resolveConfigPath(scope, _cwd, home, appData, _workspaceRoot) {
    if (scope === "workspace") {
      throw new Error(
        "claude-desktop does not support workspace scope (per-user app)",
      );
    }
    if (Deno.build.os === "darwin") {
      return join(
        home,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      );
    }
    if (Deno.build.os === "windows") {
      const base = appData ?? join(home, "AppData", "Roaming");
      return join(base, "Claude", "claude_desktop_config.json");
    }
    return join(home, ".config", "Claude", "claude_desktop_config.json");
  },
  renderBlock(input: RenderBlockInput): Record<string, unknown> {
    return { command: input.binaryPath, args: ["mcp"] };
  },
};

// ---------------------------------------------------------------------------
// cursorAdapter — preserved legacy print-only (spec §5.2 — `--print` only)
// ---------------------------------------------------------------------------

/**
 * Return the full JSON for Cursor's `~/.cursor/mcp.json`. Remains a
 * legacy print-only adapter — Cursor has not been promoted to a
 * first-class managed-block adapter in v1.
 */
export function cursorAdapter(): AdapterResult {
  const stdout = `{
  "mcpServers": {
    "markspec": {
      "command": "<BINARY_PATH>",
      "args": ["mcp"]
    }
  }
}`;
  const stderr = "Place the JSON above in ~/.cursor/mcp.json.";
  return { stdout, stderr, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// vscodeMcpAdapter — verify-only, parallel to Slice B's vscodeAdapter
// ---------------------------------------------------------------------------

/**
 * Injectable seams for {@linkcode vscodeMcpAdapter}. Production callers
 * omit `env` and let the adapter dispatch through
 * {@linkcode defaultVscodeMcpEnv}, which shells out to
 * `code --list-extensions`. Tests pass a fully fake env so no host I/O
 * occurs.
 */
export interface VscodeMcpAdapterEnv {
  /**
   * List installed VS Code extension IDs. Resolve to `undefined` when
   * the `code` CLI is absent on `$PATH` — that's "extension status
   * unknown", not "extension absent".
   */
  readonly listExtensions: () => Promise<readonly string[] | undefined>;
}

/** Inputs accepted by {@linkcode vscodeMcpAdapter}. */
export interface VscodeMcpAdapterOptions {
  /** Test-only seam — defaults to {@linkcode defaultVscodeMcpEnv}. */
  readonly env?: VscodeMcpAdapterEnv;
}

/**
 * Default env wired to real Deno APIs. Spawns `code --list-extensions`
 * for detection.
 */
export function defaultVscodeMcpEnv(): VscodeMcpAdapterEnv {
  return {
    listExtensions: async () => {
      try {
        const cmd = new Deno.Command("code", {
          args: ["--list-extensions"],
          stdout: "piped",
          stderr: "null",
        });
        const out = await cmd.output();
        if (!out.success) return undefined;
        return new TextDecoder().decode(out.stdout)
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * VS Code MCP adapter — verify-only. Per spec §5.3 the markspec-ide
 * extension registers the MCP server via
 * `lm.registerMcpServerDefinitionProvider`; no manual config write is
 * required.
 *
 * Per spec §8 Q5 (applied here by parity with the LSP path), this
 * adapter MUST NOT suggest `code --install-extension`. When the
 * extension is absent the only call-to-action is the marketplace URL.
 */
export async function vscodeMcpAdapter(
  options: VscodeMcpAdapterOptions = {},
): Promise<AdapterResult> {
  const env = options.env ?? defaultVscodeMcpEnv();
  const extensions = await env.listExtensions();
  const installed = extensions !== undefined &&
    extensions.includes(VSCODE_EXTENSION_ID);

  if (!installed) {
    const reason = extensions === undefined
      ? `VS Code 'code' CLI not found on PATH; cannot verify extension. ` +
        `Install the markspec-ide extension from:`
      : `VS Code extension ${VSCODE_EXTENSION_ID} is not installed. ` +
        `Install it from:`;
    return {
      stdout: "",
      stderr: `${reason}\n  ${VSCODE_MARKETPLACE_URL}`,
      exitCode: 0,
    };
  }

  return {
    stdout: "",
    stderr:
      `VS Code extension ${VSCODE_EXTENSION_ID} is installed. The MCP server is registered automatically by the extension via lm.registerMcpServerDefinitionProvider. No additional configuration needed.`,
    exitCode: 0,
  };
}
