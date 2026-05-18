/**
 * @module cli/install/mcp_adapters
 *
 * MCP install adapters for `markspec mcp install --client=<id>`.
 *
 * Each adapter returns an {@linkcode AdapterResult} with separate stdout
 * and stderr strings. stdout carries the config block; stderr carries
 * status messages and file path hints.
 */

import type { AdapterResult } from "./adapters.ts";

/**
 * Return the JSON config block for Claude Desktop's
 * `claude_desktop_config.json`. The full `mcpServers` wrapper is
 * included so the user can see exactly where to place the entry.
 */
export function claudeDesktopAdapter(): AdapterResult {
  const stdout = `{
  "mcpServers": {
    "markspec": {
      "command": "<BINARY_PATH>",
      "args": ["mcp"]
    }
  }
}`;
  const isMac = Deno.build.os === "darwin";
  const configPath = isMac
    ? "~/Library/Application Support/Claude/claude_desktop_config.json"
    : "~/.config/claude/claude_desktop_config.json";
  const stderr =
    `Merge the "markspec" entry above into the "mcpServers" object in:\n  ${configPath}`;
  return { stdout, stderr, exitCode: 0 };
}

/**
 * Return the full JSON for Cursor's `~/.cursor/mcp.json`.
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

/**
 * VS Code MCP adapter — verify-only.
 * The markspec-ide extension registers the MCP server via
 * `lm.registerMcpServerDefinitionProvider`; no manual config needed.
 */
export async function vscodeMcpAdapter(): Promise<AdapterResult> {
  const extensionId = "driftsys.markspec-ide";
  let installed = false;
  try {
    const cmd = new Deno.Command("code", {
      args: ["--list-extensions"],
      stdout: "piped",
      stderr: "null",
    });
    const result = await cmd.output();
    const output = new TextDecoder().decode(result.stdout);
    installed = output.includes(extensionId);
  } catch {
    // `code` not on PATH
  }

  if (installed) {
    return {
      stdout: "",
      stderr:
        `VS Code extension ${extensionId} is installed. The MCP server is registered automatically by the extension. No additional configuration needed.`,
      exitCode: 0,
    };
  }
  return {
    stdout: "",
    stderr:
      `VS Code extension ${extensionId} is not installed.\nInstall it from the VS Code Marketplace or run:\n  code --install-extension ${extensionId}`,
    exitCode: 0,
  };
}
