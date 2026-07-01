/**
 * @module cli/install/mcp_adapters_copilot
 *
 * `copilot` MCP install adapter — the first dual-scope managed-block
 * client (#635). GitHub Copilot's config sources, in the Copilot CLI's
 * own precedence order (verified against `GitHub Copilot CLI 1.0.66`):
 *
 * | Scope     | Path                          |
 * | --------- | ----------------------------- |
 * | user      | `~/.copilot/mcp-config.json`  |
 * | workspace | `.github/mcp.json`            |
 *
 * `--scope=workspace` writes `.github/mcp.json` (distinct from the
 * `claude-code` client's `.mcp.json`, which Copilot CLI 1.0.66 also
 * reads — targeting `.github/mcp.json` keeps the two clients from
 * fighting over one file). `--scope=user` writes
 * `~/.copilot/mcp-config.json`. The orchestrator defaults an omitted
 * scope to `workspace`, matching the per-repo model of `markspec init`.
 *
 * The local-server schema differs from `claude-code`: it adds `type`
 * and `tools`. Both scopes nest the entry under `mcpServers.<name>`.
 *
 * Scope covers Copilot's *CLI* surfaces only. The Copilot editor /
 * agent-mode surface reads `.vscode/mcp.json` — a VS-Code-owned file
 * already covered by the `vscode` client's extension auto-registration,
 * not a Copilot-specific write. See docs/guide/ai-agents.md and #637 for
 * the sanctioned-surfaces policy.
 */

import { join } from "@std/path";
import type { McpAdapter, RenderBlockInput } from "./adapters.ts";

export const copilotDescriptor: McpAdapter = {
  id: "copilot",
  // Both scopes nest under `mcpServers.<name>`, like claude-desktop /
  // claude-code — only the local-server shape and file path differ.
  jsonPath: ["mcpServers", "markspec"],
  resolveConfigPath(scope, cwd, home, _appData, workspaceRoot) {
    if (scope === "workspace") {
      const root = workspaceRoot ?? cwd;
      return join(root, ".github", "mcp.json");
    }
    // user scope
    return join(home, ".copilot", "mcp-config.json");
  },
  renderBlock(input: RenderBlockInput): Record<string, unknown> {
    // Verified schema (Copilot CLI 1.0.66): `type: "local"` + `tools`
    // alongside the `command` / `args` pair the other clients emit.
    return {
      type: "local",
      command: input.binaryPath,
      args: ["mcp"],
      tools: ["*"],
    };
  },
};
