import { assertEquals, assertStringIncludes } from "@std/assert";
import { runMcpInstall } from "./mcp_orchestrator.ts";

Deno.test("runMcpInstall: unknown client → exit 1 with suggestion", async () => {
  const r = await runMcpInstall({
    client: "claude-desktp", // typo
    binaryPath: "markspec",
    env: { cwd: "/tmp", home: "/home/test", isTty: false },
  });
  assertEquals(r.exitCode, 1);
  assertStringIncludes(r.stderr, "unknown client 'claude-desktp'");
  assertStringIncludes(r.stderr, "did you mean: claude-desktop");
});

Deno.test(
  "runMcpInstall: claude-desktop + --scope=workspace → exit 1 with clear message",
  async () => {
    const r = await runMcpInstall({
      client: "claude-desktop",
      scope: "workspace",
      binaryPath: "markspec",
      env: { cwd: "/tmp", home: "/home/test", isTty: false },
    });
    assertEquals(r.exitCode, 1);
    assertStringIncludes(r.stderr, "--scope=workspace is not supported");
    assertStringIncludes(r.stderr, "claude-desktop");
    assertStringIncludes(r.stderr, "per-user");
  },
);

Deno.test("runMcpInstall: unknown scope → exit 1", async () => {
  const r = await runMcpInstall({
    client: "claude-desktop",
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
