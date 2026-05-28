/**
 * @module cli/install/mcp_adapters_claude_code
 *
 * `claude-code` MCP install adapter — project-scoped. Writes the
 * managed `markspec` entry to `<workspaceRoot>/.mcp.json`, which
 * Claude Code reads on session start. See ADR-023 for the broader
 * trigger-language context.
 *
 * Slice G0 of the install/upgrade devex epic. The detect() function is
 * exposed for slice G1's `markspec init` to consume; no CLI surface
 * uses it in G0.
 */

import { join } from "@std/path";
import type {
  DetectEnv,
  DetectResult,
  McpAdapter,
  RenderBlockInput,
} from "./adapters.ts";

export const claudeCodeDescriptor: McpAdapter = {
  id: "claude-code",
  // Same JSON path as claude-desktop — the .mcp.json shape mirrors the
  // user-scope Claude Desktop config but lives at the project root.
  jsonPath: ["mcpServers", "markspec"],
  resolveConfigPath(scope, cwd, _home, _appData, workspaceRoot) {
    if (scope !== "workspace") {
      throw new Error(
        "claude-code does not support user scope (project-scoped only)",
      );
    }
    const root = workspaceRoot ?? cwd;
    return join(root, ".mcp.json");
  },
  renderBlock(input: RenderBlockInput): Record<string, unknown> {
    return { command: input.binaryPath, args: ["mcp"] };
  },
  detect: async (env: DetectEnv): Promise<DetectResult> => {
    const signals: string[] = [];
    // The fake-detect hook is gated behind MARKSPEC_TEST_MODE so a stray
    // MARKSPEC_FAKE_CLIENT_DETECT in a user's parent shell / .env / CI env
    // cannot trick a production run into writing unwanted MCP configs.
    // Both vars must be set together; the test harness owns both.
    if (Deno.env.get("MARKSPEC_TEST_MODE") === "1") {
      const fake = Deno.env.get("MARKSPEC_FAKE_CLIENT_DETECT");
      if (fake !== undefined && fake.split(",").includes("claude-code")) {
        signals.push("env-fake");
        return { detected: true, signals };
      }
    }
    if (await env.whichCommand("claude") !== undefined) {
      signals.push("claude-cli-on-path");
    }
    if (await env.pathExists(join(env.projectRoot, ".mcp.json"))) {
      signals.push("project-mcp-json-present");
    }
    if (await env.pathExists(join(env.homeDir, ".claude"))) {
      signals.push("user-claude-home-present");
    }
    return { detected: signals.length > 0, signals };
  },
};
