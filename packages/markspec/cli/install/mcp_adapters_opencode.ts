/**
 * @module cli/install/mcp_adapters_opencode
 *
 * `opencode` MCP install adapter — project-scoped. Writes the managed
 * `markspec` entry to `<workspaceRoot>/opencode.json`, which opencode
 * reads on session start. Slice G0 of the install/upgrade devex epic.
 *
 * The JSON shape was verified against the anomalyco/opencode repository
 * during implementation (slice G0 spec acceptance criterion #7):
 *   - Config file: `opencode.json` at the project root (NOT `.opencode/mcp.json`)
 *   - JSON path: `["mcp", "markspec"]` (flat — no "servers" nesting)
 *   - Local server shape: `{ type: "local", command: string[] }`
 *   Source: packages/opencode/src/config/mcp.ts (Local schema struct)
 *           packages/opencode/src/config/config.ts (project file resolution)
 *
 * If a future opencode release changes the shape, update both `jsonPath`
 * and `renderBlock` together with the colocated tests.
 */

import { join } from "@std/path";
import type {
  DetectEnv,
  DetectResult,
  McpAdapter,
  RenderBlockInput,
} from "./adapters.ts";

export const opencodeDescriptor: McpAdapter = {
  id: "opencode",
  // Verified: opencode uses a flat `mcp` object — no "servers" nesting.
  // The entry sits directly at mcp.<name>, not mcp.servers.<name>.
  jsonPath: ["mcp", "markspec"],
  resolveConfigPath(scope, cwd, _home, _appData, workspaceRoot) {
    if (scope !== "workspace") {
      throw new Error(
        "opencode does not support user scope (project-scoped only)",
      );
    }
    const root = workspaceRoot ?? cwd;
    // Verified: opencode reads `opencode.json` at the project root,
    // not `.opencode/mcp.json` as originally inferred by the spec.
    return join(root, "opencode.json");
  },
  renderBlock(input: RenderBlockInput): Record<string, unknown> {
    // Verified: Local schema in anomalyco/opencode uses `type: "local"`
    // and `command: string[]` — the same shape as the spec's inference.
    return { type: "local", command: [input.binaryPath, "mcp"] };
  },
  detect: async (env: DetectEnv): Promise<DetectResult> => {
    const signals: string[] = [];
    const fake = Deno.env.get("MARKSPEC_FAKE_CLIENT_DETECT");
    if (fake !== undefined && fake.split(",").includes("opencode")) {
      signals.push("env-fake");
      return { detected: true, signals };
    }
    if (await env.whichCommand("opencode") !== undefined) {
      signals.push("opencode-cli-on-path");
    }
    // opencode reads `opencode.json` (or `opencode.jsonc`) at the
    // project root. Verified against anomalyco/opencode.
    if (
      await env.pathExists(join(env.projectRoot, "opencode.json")) ||
      await env.pathExists(join(env.projectRoot, "opencode.jsonc"))
    ) {
      signals.push("project-opencode-config-present");
    }
    if (await env.pathExists(join(env.homeDir, ".opencode"))) {
      signals.push("user-opencode-home-present");
    }
    return { detected: signals.length > 0, signals };
  },
};
