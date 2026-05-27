/**
 * @module cli/install/mcp_adapters_claude_code_test
 *
 * Tests for the claude-code adapter — slice G0 of the install/upgrade
 * devex epic.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { claudeCodeDescriptor } from "./mcp_adapters_claude_code.ts";
import type { DetectEnv } from "./adapters.ts";

// ---------------------------------------------------------------------------
// jsonPath + id
// ---------------------------------------------------------------------------

Deno.test("claudeCodeDescriptor: id and jsonPath", () => {
  assertEquals(claudeCodeDescriptor.id, "claude-code");
  assertEquals(claudeCodeDescriptor.jsonPath, ["mcpServers", "markspec"]);
});

// ---------------------------------------------------------------------------
// resolveConfigPath
// ---------------------------------------------------------------------------

Deno.test("claudeCodeDescriptor: workspace scope → <workspaceRoot>/.mcp.json", () => {
  const path = claudeCodeDescriptor.resolveConfigPath(
    "workspace",
    "/some/cwd",
    "/home/u",
    undefined,
    "/repo",
  );
  assertEquals(path, "/repo/.mcp.json");
});

Deno.test("claudeCodeDescriptor: workspace scope without workspaceRoot → falls back to cwd", () => {
  const path = claudeCodeDescriptor.resolveConfigPath(
    "workspace",
    "/some/cwd",
    "/home/u",
  );
  assertEquals(path, "/some/cwd/.mcp.json");
});

Deno.test("claudeCodeDescriptor: user scope throws", () => {
  assertThrows(
    () => claudeCodeDescriptor.resolveConfigPath("user", "/cwd", "/home"),
    Error,
    "claude-code does not support user scope",
  );
});

// ---------------------------------------------------------------------------
// renderBlock
// ---------------------------------------------------------------------------

Deno.test("claudeCodeDescriptor: renderBlock returns command + args", () => {
  const block = claudeCodeDescriptor.renderBlock({ binaryPath: "markspec" });
  assertEquals(block, { command: "markspec", args: ["mcp"] });
});

Deno.test("claudeCodeDescriptor: renderBlock honors absolute binary path", () => {
  const block = claudeCodeDescriptor.renderBlock({
    binaryPath: "/opt/markspec/bin/markspec",
  });
  assertEquals(block, {
    command: "/opt/markspec/bin/markspec",
    args: ["mcp"],
  });
});

// ---------------------------------------------------------------------------
// detect()
// ---------------------------------------------------------------------------

function makeEnv(overrides: Partial<DetectEnv> = {}): DetectEnv {
  return {
    whichCommand: () => Promise.resolve(undefined),
    pathExists: () => Promise.resolve(false),
    projectRoot: "/repo",
    homeDir: "/home/u",
    ...overrides,
  };
}

Deno.test("claudeCodeDescriptor.detect: all signals false → detected=false", async () => {
  const result = await claudeCodeDescriptor.detect!(makeEnv());
  assertEquals(result.detected, false);
  assertEquals(result.signals, []);
});

Deno.test("claudeCodeDescriptor.detect: claude on PATH → claude-cli-on-path signal", async () => {
  const result = await claudeCodeDescriptor.detect!(
    makeEnv({
      whichCommand: (name) =>
        Promise.resolve(
          name === "claude" ? "/usr/local/bin/claude" : undefined,
        ),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(result.signals, ["claude-cli-on-path"]);
});

Deno.test("claudeCodeDescriptor.detect: project .mcp.json present → project-mcp-json-present signal", async () => {
  const result = await claudeCodeDescriptor.detect!(
    makeEnv({
      pathExists: (path) => Promise.resolve(path === "/repo/.mcp.json"),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(result.signals, ["project-mcp-json-present"]);
});

Deno.test("claudeCodeDescriptor.detect: ~/.claude/ present → user-claude-home-present signal", async () => {
  const result = await claudeCodeDescriptor.detect!(
    makeEnv({
      pathExists: (path) => Promise.resolve(path === "/home/u/.claude"),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(result.signals, ["user-claude-home-present"]);
});

Deno.test("claudeCodeDescriptor.detect: all signals fire → all listed", async () => {
  const result = await claudeCodeDescriptor.detect!(
    makeEnv({
      whichCommand: (name) =>
        Promise.resolve(
          name === "claude" ? "/usr/local/bin/claude" : undefined,
        ),
      pathExists: (path) =>
        Promise.resolve(
          path === "/repo/.mcp.json" || path === "/home/u/.claude",
        ),
    }),
  );
  assertEquals(result.detected, true);
  // Order is implementation-defined but stable; assert as a set.
  assertEquals(
    new Set(result.signals),
    new Set([
      "claude-cli-on-path",
      "project-mcp-json-present",
      "user-claude-home-present",
    ]),
  );
});
