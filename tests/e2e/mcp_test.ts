/**
 * @module tests/e2e/mcp_test
 *
 * End-to-end tests for `markspec mcp`. Spawns the CLI as a subprocess and
 * exchanges real MCP JSON-RPC messages over stdio.
 *
 * Boundary: this file imports nothing from packages/markspec/ — it interacts
 * exclusively through Deno.Command.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";

const CLI_ENTRY = new URL(
  "../../packages/markspec/main.ts",
  import.meta.url,
).pathname;

const PROJECT_YAML = `name: e2e\nversion: 0.0.1\n`;

const FIXTURE_DOC = `# Stakeholder requirements

- [STK_E2E_0001] Stop on collision

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

interface RpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
  params?: unknown;
}

/** Manage a running `markspec mcp` subprocess. */
class McpProcess {
  private proc: Deno.ChildProcess;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = "";
  private pending = new Map<number, (msg: RpcResponse) => void>();
  private notifications: RpcResponse[] = [];
  private nextId = 1;

  constructor(cwd: string) {
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
      cwd,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    this.proc = cmd.spawn();
    this.writer = this.proc.stdin.getWriter();
    // Drain stderr so it doesn't leak when the process exits.
    void this.proc.stderr.pipeTo(
      new WritableStream({ write() {} }),
    ).catch(() => {});
    this.readLoop();
  }

  private async readLoop(): Promise<void> {
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      this.buffer += decoder.decode(value);
      for (;;) {
        const newlineIdx = this.buffer.indexOf("\n");
        if (newlineIdx < 0) break;
        const line = this.buffer.slice(0, newlineIdx).trim();
        this.buffer = this.buffer.slice(newlineIdx + 1);
        if (!line) continue;
        let msg: RpcResponse;
        try {
          msg = JSON.parse(line) as RpcResponse;
        } catch {
          continue;
        }
        if (typeof msg.id === "number" && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg);
          this.pending.delete(msg.id);
        } else if (msg.method) {
          this.notifications.push(msg);
        }
      }
    }
  }

  async request(method: string, params: unknown): Promise<RpcResponse> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    const promise = new Promise<RpcResponse>((resolve) => {
      this.pending.set(id, resolve);
    });
    await this.writer.write(new TextEncoder().encode(payload + "\n"));
    return await promise;
  }

  async notify(method: string, params: unknown): Promise<void> {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    await this.writer.write(new TextEncoder().encode(payload + "\n"));
  }

  drainNotifications(): RpcResponse[] {
    const out = this.notifications.slice();
    this.notifications.length = 0;
    return out;
  }

  async close(): Promise<void> {
    try {
      await this.writer.close();
    } catch { /* already closed */ }
    try {
      this.proc.kill("SIGTERM");
    } catch { /* already exited */ }
    await this.proc.status;
  }
}

/** Create a fixture project in a temp dir and start the server. */
async function setup(): Promise<
  { proc: McpProcess; cwd: string; initResponse: RpcResponse }
> {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(`${dir}/project.yaml`, PROJECT_YAML);
  await Deno.writeTextFile(`${dir}/req.md`, FIXTURE_DOC);
  const proc = new McpProcess(dir);
  const initResponse = await proc.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.1" },
  });
  await proc.notify("notifications/initialized", {});
  return { proc, cwd: dir, initResponse };
}

Deno.test("mcp: initialize advertises resources and tools capabilities", async () => {
  const { proc, cwd, initResponse } = await setup();
  try {
    // deno-lint-ignore no-explicit-any
    const caps = (initResponse.result as any).capabilities;
    assertEquals(typeof caps.resources, "object");
    assertEquals(typeof caps.tools, "object");
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("mcp: initialize returns top-level instructions guiding agent use", async () => {
  const { proc, cwd, initResponse } = await setup();
  try {
    // deno-lint-ignore no-explicit-any
    const instructions = (initResponse.result as any).instructions as
      | string
      | undefined;
    assertEquals(typeof instructions, "string");
    assertStringIncludes(instructions!, "entry_search");
    assertStringIncludes(instructions!, "markspec://entry/");
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("mcp: every tool advertises read-only annotations", async () => {
  const { proc, cwd } = await setup();
  try {
    const resp = await proc.request("tools/list", {});
    // deno-lint-ignore no-explicit-any
    const tools = (resp.result as any).tools as Array<{
      name: string;
      annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
        openWorldHint?: boolean;
      };
    }>;
    for (const tool of tools) {
      assertEquals(
        tool.annotations?.readOnlyHint,
        true,
        `${tool.name} should declare readOnlyHint: true`,
      );
      assertEquals(
        tool.annotations?.destructiveHint,
        false,
        `${tool.name} should declare destructiveHint: false`,
      );
      assertEquals(
        tool.annotations?.openWorldHint,
        false,
        `${tool.name} should declare openWorldHint: false`,
      );
    }
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("mcp: tools/list returns all five tools", async () => {
  const { proc, cwd } = await setup();
  try {
    const resp = await proc.request("tools/list", {});
    // deno-lint-ignore no-explicit-any
    const tools = (resp.result as any).tools as Array<{ name: string }>;
    const names = tools.map((t) => t.name).sort();
    assertEquals(names, [
      "entry_context",
      "entry_search",
      "markspec_refresh",
      "profile_describe",
      "validate",
    ]);
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("mcp: resources/list returns profile, entries, and per-entry URIs", async () => {
  const { proc, cwd } = await setup();
  try {
    const resp = await proc.request("resources/list", {});
    // deno-lint-ignore no-explicit-any
    const resources = (resp.result as any).resources as Array<
      { uri: string }
    >;
    const uris = resources.map((r) => r.uri).sort();
    assertEquals(uris.includes("markspec://profile"), true);
    assertEquals(uris.includes("markspec://entries"), true);
    assertEquals(
      uris.includes("markspec://entry/STK_E2E_0001"),
      true,
    );
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("mcp: resources/read on entry returns Markdown body", async () => {
  const { proc, cwd } = await setup();
  try {
    const resp = await proc.request("resources/read", {
      uri: "markspec://entry/STK_E2E_0001",
    });
    // deno-lint-ignore no-explicit-any
    const contents = (resp.result as any).contents as Array<
      { text: string; mimeType: string }
    >;
    assertEquals(contents[0].mimeType, "text/markdown");
    assertStringIncludes(
      contents[0].text,
      "# STK_E2E_0001 — Stop on collision",
    );
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("mcp: tools/call entry_search returns ranked matches", async () => {
  const { proc, cwd } = await setup();
  try {
    const resp = await proc.request("tools/call", {
      name: "entry_search",
      arguments: { query: "collision" },
    });
    // deno-lint-ignore no-explicit-any
    const content = (resp.result as any).content as Array<{ text: string }>;
    assertStringIncludes(content[0].text, "STK_E2E_0001");
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("mcp: tools/call validate returns clean report", async () => {
  const { proc, cwd } = await setup();
  try {
    const resp = await proc.request("tools/call", {
      name: "validate",
      arguments: {},
    });
    // deno-lint-ignore no-explicit-any
    const content = (resp.result as any).content as Array<{ text: string }>;
    assertStringIncludes(content[0].text, "All 1 entries pass validation");
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});

Deno.test("mcp: file edit + markspec_refresh fires resources/updated", async () => {
  const { proc, cwd } = await setup();
  try {
    // Edit the fixture file: add a second entry.
    await Deno.writeTextFile(
      `${cwd}/req.md`,
      FIXTURE_DOC +
        `\n- [STK_E2E_0002] Second\n\n  Body.\n\n      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG\n`,
    );

    // Retry the refresh up to 5 times with short delays. On slow CI
    // runners the subprocess's view of the file system can lag behind
    // the test's `writeTextFile` by tens of milliseconds; a single
    // refresh call can race and report the pre-edit entry count.
    let lastText = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const resp = await proc.request("tools/call", {
        name: "markspec_refresh",
        arguments: {},
      });
      // deno-lint-ignore no-explicit-any
      const content = (resp.result as any).content as Array<{ text: string }>;
      lastText = content[0].text;
      if (lastText.includes("2 entries")) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assertStringIncludes(lastText, "2 entries");

    // Subscription handlers fire on the next microtask after the tool call
    // response; give the runtime up to ~500ms to flush them before draining.
    const deadline = performance.now() + 500;
    let methods: (string | undefined)[] = [];
    while (performance.now() < deadline) {
      methods = proc.drainNotifications().map((n) => n.method);
      if (methods.includes("notifications/resources/list_changed")) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assertEquals(
      methods.includes("notifications/resources/list_changed"),
      true,
    );
  } finally {
    await proc.close();
    await Deno.remove(cwd, { recursive: true });
  }
});
