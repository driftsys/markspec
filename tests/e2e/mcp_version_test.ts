/**
 * @module tests/e2e/mcp_version_test
 *
 * Per Toolchain Tier 3 spec §3.3: the MCP server advertises both its release
 * version and core-schema version on initialize, exactly as `markspec lsp`
 * does in its LSP `serverInfo.version`. Clients use this to detect skew
 * between the launched binary and the project's pinned core-schema.
 *
 * Boundary: blackbox e2e — spawns the CLI subprocess and speaks raw MCP
 * JSON-RPC over stdio. No imports from packages/markspec/.
 */

import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const CLI_ENTRY = fromFileUrl(
  new URL("../../packages/markspec/main.ts", import.meta.url),
);

Deno.test("mcp: initialize response advertises release + core-schema version", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/project.yaml`,
    "name: e2e\nversion: 0.0.1\n",
  );

  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-net",
      "--allow-ffi",
      CLI_ENTRY,
      "mcp",
    ],
    cwd: dir,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const proc = cmd.spawn();
  const writer = proc.stdin.getWriter();
  const reader = proc.stdout.getReader();
  // Drain stderr so the subprocess doesn't block on a full pipe.
  void proc.stderr.pipeTo(new WritableStream({ write() {} })).catch(() => {});

  try {
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.1" },
      },
    });
    await writer.write(new TextEncoder().encode(request + "\n"));

    const decoder = new TextDecoder();
    let buffer = "";
    let response: { id?: number; result?: unknown } | undefined;
    // Read JSON-RPC frames until we see the one matching our request id.
    // The MCP server may emit unrelated notifications before the response
    // arrives, so matching by id is required.
    while (!response) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stdout closed before initialize response");
      buffer += decoder.decode(value);
      while (true) {
        const newlineIdx = buffer.indexOf("\n");
        if (newlineIdx < 0) break;
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { id?: number; result?: unknown };
        if (msg.id === 1) {
          response = msg;
          break;
        }
      }
    }

    const result = response.result as {
      serverInfo?: { name?: string; version?: string };
    };
    assertEquals(result.serverInfo?.name, "markspec");
    const version = result.serverInfo?.version ?? "";
    // Release version (semver-ish prefix), then literal " (core-schema N)".
    assertMatch(version, /^\d+\.\d+\.\d+.* \(core-schema \d+\)$/);
    assertStringIncludes(version, "core-schema");
  } finally {
    try {
      await writer.close();
    } catch { /* already closed */ }
    try {
      await reader.cancel();
    } catch { /* already cancelled */ }
    try {
      proc.kill("SIGTERM");
    } catch { /* already exited */ }
    await proc.status;
    await Deno.remove(dir, { recursive: true });
  }
});
