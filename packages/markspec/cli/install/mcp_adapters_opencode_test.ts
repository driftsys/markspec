/**
 * @module cli/install/mcp_adapters_opencode_test
 *
 * Tests for the opencode adapter — slice G0 of the install/upgrade
 * devex epic. opencode's exact JSON shape was verified during
 * implementation (see Task 5 Step 1); if a future opencode release
 * changes the shape, update the adapter and these tests together.
 *
 * Verification source: anomalyco/opencode repo
 *   packages/opencode/src/config/mcp.ts — Local schema struct
 *   packages/opencode/src/config/config.ts — project file resolution
 * The config file is `opencode.json` at the project root (NOT
 * `.opencode/mcp.json` as the spec inferred). The JSON path is
 * ["mcp", "markspec"] (no "servers" nesting).
 */

import { assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { opencodeDescriptor } from "./mcp_adapters_opencode.ts";
import type { DetectEnv } from "./adapters.ts";

// Path fixtures use `join()` so the constants match the platform-aware
// paths the adapter constructs at runtime — on Windows the std `join`
// returns backslash paths (`\repo\opencode.json`), so a POSIX literal
// would miss the equality check.
const REPO_ROOT = join("/", "repo");
const HOME_DIR = join("/", "home", "u");
const CWD_DIR = join("/", "some", "cwd");
const OPENCODE_BIN = join("/", "usr", "local", "bin", "opencode");
const REPO_OPENCODE_JSON = join(REPO_ROOT, "opencode.json");
const REPO_OPENCODE_JSONC = join(REPO_ROOT, "opencode.jsonc");
const CWD_OPENCODE_JSON = join(CWD_DIR, "opencode.json");
const HOME_OPENCODE = join(HOME_DIR, ".opencode");

// ---------------------------------------------------------------------------
// jsonPath + id
// ---------------------------------------------------------------------------

Deno.test("opencodeDescriptor: id and jsonPath", () => {
  assertEquals(opencodeDescriptor.id, "opencode");
  // Verified against anomalyco/opencode — flat mcp object, no "servers" nesting:
  assertEquals(opencodeDescriptor.jsonPath, ["mcp", "markspec"]);
});

// ---------------------------------------------------------------------------
// resolveConfigPath
// ---------------------------------------------------------------------------

Deno.test("opencodeDescriptor: workspace scope → <workspaceRoot>/opencode.json", () => {
  const path = opencodeDescriptor.resolveConfigPath(
    "workspace",
    CWD_DIR,
    HOME_DIR,
    undefined,
    REPO_ROOT,
  );
  // Verified: opencode reads opencode.json at the project root (not .opencode/mcp.json)
  assertEquals(path, REPO_OPENCODE_JSON);
});

Deno.test("opencodeDescriptor: workspace scope without workspaceRoot → falls back to cwd", () => {
  const path = opencodeDescriptor.resolveConfigPath(
    "workspace",
    CWD_DIR,
    HOME_DIR,
  );
  assertEquals(path, CWD_OPENCODE_JSON);
});

Deno.test("opencodeDescriptor: user scope throws", () => {
  assertThrows(
    () => opencodeDescriptor.resolveConfigPath("user", "/cwd", "/home"),
    Error,
    "opencode does not support user scope",
  );
});

// ---------------------------------------------------------------------------
// renderBlock
// ---------------------------------------------------------------------------

Deno.test("opencodeDescriptor: renderBlock returns the opencode JSON shape", () => {
  const block = opencodeDescriptor.renderBlock({ binaryPath: "markspec" });
  // Verified: Local schema in anomalyco/opencode has { type: "local", command: string[] }
  assertEquals(block, { type: "local", command: ["markspec", "mcp"] });
});

Deno.test("opencodeDescriptor: renderBlock honors absolute binary path", () => {
  const block = opencodeDescriptor.renderBlock({
    binaryPath: "/opt/markspec/bin/markspec",
  });
  assertEquals(block, {
    type: "local",
    command: ["/opt/markspec/bin/markspec", "mcp"],
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

Deno.test("opencodeDescriptor.detect: all signals false → detected=false", async () => {
  const result = await opencodeDescriptor.detect!(makeEnv());
  assertEquals(result.detected, false);
  assertEquals(result.signals, []);
});

Deno.test("opencodeDescriptor.detect: opencode on PATH → opencode-cli-on-path signal", async () => {
  const result = await opencodeDescriptor.detect!(
    makeEnv({
      whichCommand: (name) =>
        Promise.resolve(name === "opencode" ? OPENCODE_BIN : undefined),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(result.signals, ["opencode-cli-on-path"]);
});

Deno.test("opencodeDescriptor.detect: project opencode.json present → project-opencode-config-present", async () => {
  const result = await opencodeDescriptor.detect!(
    makeEnv({
      pathExists: (path) => Promise.resolve(path === REPO_OPENCODE_JSON),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(result.signals, ["project-opencode-config-present"]);
});

Deno.test("opencodeDescriptor.detect: project opencode.jsonc present → project-opencode-config-present", async () => {
  const result = await opencodeDescriptor.detect!(
    makeEnv({
      pathExists: (path) => Promise.resolve(path === REPO_OPENCODE_JSONC),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(result.signals, ["project-opencode-config-present"]);
});

Deno.test("opencodeDescriptor.detect: ~/.opencode/ present → user-opencode-home-present", async () => {
  const result = await opencodeDescriptor.detect!(
    makeEnv({
      pathExists: (path) => Promise.resolve(path === HOME_OPENCODE),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(result.signals, ["user-opencode-home-present"]);
});

Deno.test("opencodeDescriptor.detect: all signals fire → all listed", async () => {
  const result = await opencodeDescriptor.detect!(
    makeEnv({
      whichCommand: (name) =>
        Promise.resolve(name === "opencode" ? OPENCODE_BIN : undefined),
      pathExists: (path) =>
        Promise.resolve(path === REPO_OPENCODE_JSON || path === HOME_OPENCODE),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(
    new Set(result.signals),
    new Set([
      "opencode-cli-on-path",
      "project-opencode-config-present",
      "user-opencode-home-present",
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

Deno.test("detect: MARKSPEC_FAKE_CLIENT_DETECT=opencode forces detected=true (with TEST_MODE)", async () => {
  await withFakeEnv("1", "opencode", async () => {
    const r = await opencodeDescriptor.detect!(makeEnv());
    assertEquals(r.detected, true);
    assertEquals(r.signals.includes("env-fake"), true);
  });
});

Deno.test("detect: MARKSPEC_FAKE_CLIENT_DETECT=claude does NOT force opencode (with TEST_MODE)", async () => {
  await withFakeEnv("1", "claude", async () => {
    const r = await opencodeDescriptor.detect!(makeEnv());
    assertEquals(r.detected, false);
  });
});

Deno.test("detect: MARKSPEC_FAKE_CLIENT_DETECT without MARKSPEC_TEST_MODE is ignored", async () => {
  // Env-bleed guard: a stray MARKSPEC_FAKE_CLIENT_DETECT in a parent
  // shell / .env / CI environment must not trick a production run.
  await withFakeEnv(undefined, "opencode", async () => {
    const r = await opencodeDescriptor.detect!(makeEnv());
    assertEquals(r.detected, false);
    assertEquals(r.signals.includes("env-fake"), false);
  });
});
