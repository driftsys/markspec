import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runMcpInstall } from "./mcp_orchestrator.ts";

// Expected stderr paths use `join()` so the assertion matches the
// platform-aware path the adapter renders — on Windows `join` produces
// backslash paths (`\tmp\some-repo\.mcp.json`), so a POSIX literal
// would fail the substring check.
const REPO_CWD = join("/", "tmp", "some-repo");
const REPO_MCP_JSON = join(REPO_CWD, ".mcp.json");
const REPO_OPENCODE_JSON = join(REPO_CWD, "opencode.json");
const REPO_COPILOT_WORKSPACE = join(REPO_CWD, ".github", "mcp.json");
const USER_COPILOT_CONFIG = join("/home/u", ".copilot", "mcp-config.json");

Deno.test("runMcpInstall: unknown client → exit 1 with suggestion", async () => {
  const r = await runMcpInstall({
    client: "claud", // typo for claude
    binaryPath: "markspec",
    env: { cwd: "/tmp", home: "/home/test", isTty: false },
  });
  assertEquals(r.exitCode, 1);
  assertStringIncludes(r.stderr, "unknown client 'claud'");
  assertStringIncludes(r.stderr, "did you mean: claude");
});

Deno.test("runMcpInstall: unknown scope → exit 1", async () => {
  const r = await runMcpInstall({
    client: "claude",
    scope: "global",
    binaryPath: "markspec",
    env: { cwd: "/tmp", home: "/home/test", isTty: false },
  });
  assertEquals(r.exitCode, 1);
  assertStringIncludes(r.stderr, "unknown scope 'global'");
});

Deno.test("runMcpInstall: cursor → delegates to legacy print-only adapter", async () => {
  const r = await runMcpInstall({
    client: "cursor",
    binaryPath: "markspec",
    env: { cwd: "/tmp", home: "/home/test", isTty: false },
  });
  assertEquals(r.exitCode, 0);
  assertStringIncludes(r.stdout, "mcpServers");
  assertStringIncludes(r.stderr, "mcp.json");
});

Deno.test("runMcpInstall: --client=claude routes through managed-block flow", async () => {
  // Use --print path so we don't write any file.
  const result = await runMcpInstall({
    client: "claude",
    scope: "workspace",
    binaryPath: "markspec",
    print: true,
    env: {
      cwd: REPO_CWD,
      home: "/home/u",
      isTty: true,
    },
  });
  assertEquals(result.exitCode, 0);
  // stdout has the rendered JSON
  assertStringIncludes(result.stdout, `"mcpServers"`);
  assertStringIncludes(result.stdout, `"markspec"`);
  // stderr shows the target path under cwd
  assertStringIncludes(result.stderr, REPO_MCP_JSON);
});

Deno.test("runMcpInstall: --client=claude --scope=user is rejected", async () => {
  const result = await runMcpInstall({
    client: "claude",
    scope: "user",
    binaryPath: "markspec",
    print: true,
    env: { cwd: "/tmp", home: "/home/u", isTty: true },
  });
  assertEquals(result.exitCode, 1);
  assertStringIncludes(
    result.stderr,
    "--scope=user is not supported for --client=claude",
  );
});

Deno.test("runMcpInstall: --client=opencode routes through managed-block flow", async () => {
  const result = await runMcpInstall({
    client: "opencode",
    scope: "workspace",
    binaryPath: "markspec",
    print: true,
    env: {
      cwd: REPO_CWD,
      home: "/home/u",
      isTty: true,
    },
  });
  assertEquals(result.exitCode, 0);
  // Verified opencode shape — flat `mcp.markspec`, no `mcpServers`.
  assertStringIncludes(result.stdout, `"mcp"`);
  assertStringIncludes(result.stdout, `"markspec"`);
  // Verified opencode path: `opencode.json` at project root.
  assertStringIncludes(result.stderr, REPO_OPENCODE_JSON);
});

Deno.test("runMcpInstall: --client=opencode --scope=user is rejected", async () => {
  const result = await runMcpInstall({
    client: "opencode",
    scope: "user",
    binaryPath: "markspec",
    print: true,
    env: { cwd: "/tmp", home: "/home/u", isTty: true },
  });
  assertEquals(result.exitCode, 1);
  assertStringIncludes(
    result.stderr,
    "--scope=user is not supported for --client=opencode",
  );
});

// ---------------------------------------------------------------------------
// copilot — the first dual-scope managed-block client (#635). Accepts both
// --scope=workspace (.github/mcp.json) and --scope=user
// (~/.copilot/mcp-config.json); defaults to workspace when scope is omitted.
// ---------------------------------------------------------------------------

Deno.test("runMcpInstall: --client=copilot --scope=workspace → .github/mcp.json with type+tools", async () => {
  const result = await runMcpInstall({
    client: "copilot",
    scope: "workspace",
    binaryPath: "markspec",
    print: true,
    env: { cwd: REPO_CWD, home: "/home/u", isTty: true },
  });
  assertEquals(result.exitCode, 0);
  // Copilot local-server schema differs from claude: adds type + tools.
  assertStringIncludes(result.stdout, `"mcpServers"`);
  assertStringIncludes(result.stdout, `"markspec"`);
  assertStringIncludes(result.stdout, `"type": "local"`);
  assertStringIncludes(result.stdout, `"tools"`);
  assertStringIncludes(result.stderr, REPO_COPILOT_WORKSPACE);
});

Deno.test("runMcpInstall: --client=copilot --scope=user → ~/.copilot/mcp-config.json", async () => {
  const result = await runMcpInstall({
    client: "copilot",
    scope: "user",
    binaryPath: "markspec",
    print: true,
    env: { cwd: REPO_CWD, home: "/home/u", isTty: true },
  });
  assertEquals(result.exitCode, 0);
  assertStringIncludes(result.stdout, `"type": "local"`);
  assertStringIncludes(result.stderr, USER_COPILOT_CONFIG);
});

Deno.test("runMcpInstall: --client=copilot with no scope defaults to workspace", async () => {
  const result = await runMcpInstall({
    client: "copilot",
    binaryPath: "markspec",
    print: true,
    env: { cwd: REPO_CWD, home: "/home/u", isTty: true },
  });
  assertEquals(result.exitCode, 0);
  assertStringIncludes(result.stderr, REPO_COPILOT_WORKSPACE);
});

Deno.test("runMcpInstall: --client=copilot --scope=global → unknown scope error", async () => {
  const result = await runMcpInstall({
    client: "copilot",
    scope: "global",
    binaryPath: "markspec",
    print: true,
    env: { cwd: REPO_CWD, home: "/home/u", isTty: true },
  });
  assertEquals(result.exitCode, 1);
  assertStringIncludes(result.stderr, "unknown scope 'global'");
});
