/**
 * @module cli/install/mcp_adapters_claude_code_test
 *
 * Tests for the claude-code adapter — slice G0 of the install/upgrade
 * devex epic.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { claudeCodeDescriptor } from "./mcp_adapters_claude_code.ts";
import type { DetectEnv } from "./adapters.ts";

// Path fixtures use `join()` so the constants match the platform-aware
// paths the adapter constructs at runtime — on Windows the std `join`
// returns backslash paths (`\repo\.mcp.json`), so a POSIX literal
// would miss the equality check.
const REPO_ROOT = join("/", "repo");
const HOME_DIR = join("/", "home", "u");
const CWD_DIR = join("/", "some", "cwd");
const CLAUDE_BIN = join("/", "usr", "local", "bin", "claude");
const REPO_MCP_JSON = join(REPO_ROOT, ".mcp.json");
const CWD_MCP_JSON = join(CWD_DIR, ".mcp.json");
const HOME_CLAUDE = join(HOME_DIR, ".claude");

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
    CWD_DIR,
    HOME_DIR,
    undefined,
    REPO_ROOT,
  );
  assertEquals(path, REPO_MCP_JSON);
});

Deno.test("claudeCodeDescriptor: workspace scope without workspaceRoot → falls back to cwd", () => {
  const path = claudeCodeDescriptor.resolveConfigPath(
    "workspace",
    CWD_DIR,
    HOME_DIR,
  );
  assertEquals(path, CWD_MCP_JSON);
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
    projectRoot: REPO_ROOT,
    homeDir: HOME_DIR,
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
        Promise.resolve(name === "claude" ? CLAUDE_BIN : undefined),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(result.signals, ["claude-cli-on-path"]);
});

Deno.test("claudeCodeDescriptor.detect: project .mcp.json present → project-mcp-json-present signal", async () => {
  const result = await claudeCodeDescriptor.detect!(
    makeEnv({
      pathExists: (path) => Promise.resolve(path === REPO_MCP_JSON),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(result.signals, ["project-mcp-json-present"]);
});

Deno.test("claudeCodeDescriptor.detect: ~/.claude/ present → user-claude-home-present signal", async () => {
  const result = await claudeCodeDescriptor.detect!(
    makeEnv({
      pathExists: (path) => Promise.resolve(path === HOME_CLAUDE),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(result.signals, ["user-claude-home-present"]);
});

Deno.test("claudeCodeDescriptor.detect: all signals fire → all listed", async () => {
  const result = await claudeCodeDescriptor.detect!(
    makeEnv({
      whichCommand: (name) =>
        Promise.resolve(name === "claude" ? CLAUDE_BIN : undefined),
      pathExists: (path) =>
        Promise.resolve(path === REPO_MCP_JSON || path === HOME_CLAUDE),
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

/**
 * Run `body` with MARKSPEC_TEST_MODE + MARKSPEC_FAKE_CLIENT_DETECT
 * set to the given values, restoring the previous values afterward.
 * Both vars are required because the adapter's fake-detect hook is
 * gated behind MARKSPEC_TEST_MODE=1.
 */
async function withFakeEnv(
  testMode: string | undefined,
  fake: string | undefined,
  body: () => Promise<void>,
): Promise<void> {
  const origMode = Deno.env.get("MARKSPEC_TEST_MODE");
  const origFake = Deno.env.get("MARKSPEC_FAKE_CLIENT_DETECT");
  if (testMode === undefined) Deno.env.delete("MARKSPEC_TEST_MODE");
  else Deno.env.set("MARKSPEC_TEST_MODE", testMode);
  if (fake === undefined) Deno.env.delete("MARKSPEC_FAKE_CLIENT_DETECT");
  else Deno.env.set("MARKSPEC_FAKE_CLIENT_DETECT", fake);
  try {
    await body();
  } finally {
    if (origMode === undefined) Deno.env.delete("MARKSPEC_TEST_MODE");
    else Deno.env.set("MARKSPEC_TEST_MODE", origMode);
    if (origFake === undefined) Deno.env.delete("MARKSPEC_FAKE_CLIENT_DETECT");
    else Deno.env.set("MARKSPEC_FAKE_CLIENT_DETECT", origFake);
  }
}

Deno.test("detect: MARKSPEC_FAKE_CLIENT_DETECT=claude-code forces detected=true (with TEST_MODE)", async () => {
  await withFakeEnv("1", "claude-code", async () => {
    const r = await claudeCodeDescriptor.detect!(makeEnv());
    assertEquals(r.detected, true);
    assertEquals(r.signals.includes("env-fake"), true);
  });
});

Deno.test("detect: MARKSPEC_FAKE_CLIENT_DETECT=opencode does NOT force claude-code (with TEST_MODE)", async () => {
  await withFakeEnv("1", "opencode", async () => {
    const r = await claudeCodeDescriptor.detect!(makeEnv());
    assertEquals(r.detected, false);
  });
});

Deno.test("detect: MARKSPEC_FAKE_CLIENT_DETECT without MARKSPEC_TEST_MODE is ignored", async () => {
  // Env-bleed guard: a stray MARKSPEC_FAKE_CLIENT_DETECT in a parent
  // shell / .env / CI environment must not trick a production run.
  await withFakeEnv(undefined, "claude-code", async () => {
    const r = await claudeCodeDescriptor.detect!(makeEnv());
    assertEquals(r.detected, false);
    assertEquals(r.signals.includes("env-fake"), false);
  });
});
