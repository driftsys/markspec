/**
 * @module tests/e2e/lsp_helpers
 *
 * Minimal JSON-RPC client for E2E-testing the MarkSpec LSP server.
 * Spawns the server as a subprocess and communicates over stdin/stdout.
 */

import { fromFileUrl, toFileUrl } from "@std/path";

const LSP_ENTRY = fromFileUrl(
  new URL("../../packages/markspec/lsp/server.ts", import.meta.url),
);

/** Workspace root — two levels up from tests/e2e/. */
const WORKSPACE_ROOT = fromFileUrl(new URL("../../", import.meta.url))
  .replace(/[\\/]$/, "");

/** A JSON-RPC message (request or notification). */
interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Encode a JSON-RPC message with Content-Length header. */
function encode(message: JsonRpcMessage): Uint8Array {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${
    new TextEncoder().encode(body).length
  }\r\n\r\n`;
  return new TextEncoder().encode(header + body);
}

/**
 * Minimal LSP test client. Spawns the LSP server and provides
 * request/notification methods.
 */
export class LspTestClient {
  private process: Deno.ChildProcess;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buffer = "";
  private nextId = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }>();
  private notifications: JsonRpcMessage[] = [];

  /** The temporary directory where fixture files were written. */
  readonly workDir: string;

  private constructor(
    process: Deno.ChildProcess,
    writer: WritableStreamDefaultWriter<Uint8Array>,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    workDir: string,
  ) {
    this.process = process;
    this.writer = writer;
    this.reader = reader;
    this.workDir = workDir;
    this.startReading();
  }

  /** Spawn the LSP server in a temp directory with the given files. */
  static async create(
    files: Record<string, string> = {},
  ): Promise<LspTestClient> {
    const dir = await Deno.makeTempDir();
    for (const [name, content] of Object.entries(files)) {
      const parts = name.split("/");
      if (parts.length > 1) {
        await Deno.mkdir(`${dir}/${parts.slice(0, -1).join("/")}`, {
          recursive: true,
        }).catch(() => {});
      }
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }

    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-run",
        LSP_ENTRY,
        "--stdio",
      ],
      cwd: WORKSPACE_ROOT,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    const process = cmd.spawn();
    // Capture stderr for diagnostics
    let stderrText = "";
    const stderrReader = process.stderr.getReader();
    const stderrDecoder = new TextDecoder();
    (async () => {
      try {
        while (true) {
          const { value, done } = await stderrReader.read();
          if (done) break;
          stderrText += stderrDecoder.decode(value, { stream: true });
        }
      } catch {
        // Stream closed
      }
    })();
    const writer = process.stdin.getWriter();
    const reader = process.stdout.getReader();
    const client = new LspTestClient(process, writer, reader, dir);
    // Wait a moment for the server to start, then check for crash
    await new Promise((r) => setTimeout(r, 500));
    if (stderrText.includes("error:")) {
      throw new Error(`LSP server failed to start:\n${stderrText}`);
    }
    return client;
  }

  /** Send a JSON-RPC request and wait for the response (10s timeout). */
  async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    await this.writer.write(encode(message));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(`Timeout waiting for response to ${method} (id=${id})`),
        );
      }, 10000);
      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timeout);
          reject(reason);
        },
      });
    });
  }

  /** Send a JSON-RPC notification (no response expected). */
  async notify(method: string, params?: unknown): Promise<void> {
    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      method,
      params,
    };
    await this.writer.write(encode(message));
  }

  /**
   * Wait for a notification with the given method to arrive.
   * Polls with timeout.
   */
  async waitForNotification(
    method: string,
    timeoutMs = 5000,
  ): Promise<JsonRpcMessage> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = this.notifications.find((n) => n.method === method);
      if (found) {
        this.notifications.splice(this.notifications.indexOf(found), 1);
        return found;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timeout waiting for notification: ${method}`);
  }

  /** Perform the initialize → initialized handshake. */
  async initialize(
    options: { processId?: number | null } = {},
  ): Promise<unknown> {
    const rootUri = toFileUrl(this.workDir).href;
    const result = await this.request("initialize", {
      processId: options.processId === undefined ? Deno.pid : options.processId,
      rootUri,
      capabilities: {},
    });
    await this.notify("initialized", {});
    // Give the server a moment to start indexing
    await new Promise((r) => setTimeout(r, 200));
    return result;
  }

  /** Perform shutdown → exit, then kill the process. */
  async shutdown(): Promise<void> {
    try {
      await this.request("shutdown", null);
      await this.notify("exit");
      await this.writer.close();
    } catch {
      // Server may have already exited
    }
    // Give the server a moment to exit gracefully, then force kill
    await new Promise((r) => setTimeout(r, 100));
    try {
      this.process.kill();
    } catch {
      // Already exited
    }
    try {
      this.reader.cancel();
    } catch {
      // Already closed
    }
    // Wait for process to finish to avoid dangling resources
    try {
      await this.process.status;
    } catch {
      // Already done
    }
  }

  /** Read messages from stdout in a background loop. */
  private async startReading(): Promise<void> {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } catch {
      // Stream closed
    }
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;

      const header = this.buffer.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) return;

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (this.buffer.length < bodyEnd) return;

      const body = this.buffer.slice(bodyStart, bodyEnd);
      this.buffer = this.buffer.slice(bodyEnd);

      try {
        const message = JSON.parse(body) as JsonRpcMessage;
        this.handleMessage(message);
      } catch {
        // Malformed JSON — skip
      }
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (message.id !== undefined && !message.method) {
      // Response to a request
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(message.error);
        } else {
          pending.resolve(message.result);
        }
      }
    } else if (message.method) {
      // Server-initiated notification
      this.notifications.push(message);
    }
  }
}
