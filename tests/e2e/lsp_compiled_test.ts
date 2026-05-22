/**
 * Smoke test for the compiled markspec binary's `lsp` subcommand.
 *
 * Exercises the spawn path that ships in the VSIX. Catches regressions where
 * `deno compile` output diverges from `deno run` (missing --include for
 * embedded assets, transport flag handling, etc).
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const COMPILED_BINARY = fromFileUrl(
  new URL("../../dist/markspec", import.meta.url),
);

const compiledExists = await Deno.stat(COMPILED_BINARY)
  .then(() => true)
  .catch(() => false);

Deno.test({
  name: "compiled lsp: responds to initialize",
  ignore: !compiledExists,
  async fn() {
    const cmd = new Deno.Command(COMPILED_BINARY, {
      args: ["lsp", "--stdio"],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    const child = cmd.spawn();
    try {
      const writer = child.stdin.getWriter();
      const initBody = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { processId: Deno.pid, rootUri: null, capabilities: {} },
      });
      const init = `Content-Length: ${initBody.length}\r\n\r\n${initBody}`;
      await writer.write(new TextEncoder().encode(init));

      // Read the initialize response.
      const reader = child.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!buffer.includes("\r\n\r\n")) {
        const { value, done } = await reader.read();
        if (done) throw new Error("server closed before responding");
        buffer += decoder.decode(value, { stream: true });
      }
      const headerEnd = buffer.indexOf("\r\n\r\n");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(
        buffer.slice(0, headerEnd),
      );
      if (!lengthMatch) throw new Error("no content-length header");
      const contentLength = parseInt(lengthMatch[1], 10);
      while (buffer.length < headerEnd + 4 + contentLength) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      const body = buffer.slice(headerEnd + 4, headerEnd + 4 + contentLength);
      const response = JSON.parse(body);
      assertEquals(response.id, 1);
      assertEquals(typeof response.result, "object");
      // Capabilities object should include textDocumentSync
      const caps = response.result.capabilities as Record<string, unknown>;
      assertEquals(caps.textDocumentSync, 1);

      // Send shutdown + exit so the server exits cleanly.
      const shutdownBody = JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "shutdown",
        params: null,
      });
      await writer.write(
        new TextEncoder().encode(
          `Content-Length: ${shutdownBody.length}\r\n\r\n${shutdownBody}`,
        ),
      );
      const exitBody = JSON.stringify({
        jsonrpc: "2.0",
        method: "exit",
        params: null,
      });
      await writer.write(
        new TextEncoder().encode(
          `Content-Length: ${exitBody.length}\r\n\r\n${exitBody}`,
        ),
      );
      await writer.close();
      reader.releaseLock();
    } finally {
      try {
        child.kill();
      } catch { /* already exited */ }
      await child.stderr.cancel().catch(() => {});
      await child.stdout.cancel().catch(() => {});
      await child.status;
    }
  },
});
