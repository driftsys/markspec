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
import { opencodeDescriptor } from "./mcp_adapters_opencode.ts";
import type { DetectEnv } from "./adapters.ts";

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
    "/some/cwd",
    "/home/u",
    undefined,
    "/repo",
  );
  // Verified: opencode reads opencode.json at the project root (not .opencode/mcp.json)
  assertEquals(path, "/repo/opencode.json");
});

Deno.test("opencodeDescriptor: workspace scope without workspaceRoot → falls back to cwd", () => {
  const path = opencodeDescriptor.resolveConfigPath(
    "workspace",
    "/some/cwd",
    "/home/u",
  );
  assertEquals(path, "/some/cwd/opencode.json");
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
    projectRoot: "/repo",
    homeDir: "/home/u",
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
        Promise.resolve(
          name === "opencode" ? "/usr/local/bin/opencode" : undefined,
        ),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(result.signals, ["opencode-cli-on-path"]);
});

Deno.test("opencodeDescriptor.detect: project opencode.json present → project-opencode-config-present", async () => {
  const result = await opencodeDescriptor.detect!(
    makeEnv({
      pathExists: (path) => Promise.resolve(path === "/repo/opencode.json"),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(result.signals, ["project-opencode-config-present"]);
});

Deno.test("opencodeDescriptor.detect: project opencode.jsonc present → project-opencode-config-present", async () => {
  const result = await opencodeDescriptor.detect!(
    makeEnv({
      pathExists: (path) => Promise.resolve(path === "/repo/opencode.jsonc"),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(result.signals, ["project-opencode-config-present"]);
});

Deno.test("opencodeDescriptor.detect: ~/.opencode/ present → user-opencode-home-present", async () => {
  const result = await opencodeDescriptor.detect!(
    makeEnv({
      pathExists: (path) => Promise.resolve(path === "/home/u/.opencode"),
    }),
  );
  assertEquals(result.detected, true);
  assertEquals(result.signals, ["user-opencode-home-present"]);
});

Deno.test("opencodeDescriptor.detect: all signals fire → all listed", async () => {
  const result = await opencodeDescriptor.detect!(
    makeEnv({
      whichCommand: (name) =>
        Promise.resolve(
          name === "opencode" ? "/usr/local/bin/opencode" : undefined,
        ),
      pathExists: (path) =>
        Promise.resolve(
          path === "/repo/opencode.json" || path === "/home/u/.opencode",
        ),
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
