/**
 * @module tests/e2e/desk_test
 *
 * Black-box test for `markspec desk --serve` (ADR-035 walking skeleton):
 * start the real CLI on `--port 0`, read the stdout handshake, and call
 * both endpoints over loopback HTTP. Needs `--allow-net` on the test
 * runner (CI and `just test` grant it); skipped otherwise.
 */

import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { copy } from "@std/fs";
import { fromFileUrl, join } from "@std/path";

const CLI_ENTRY = fromFileUrl(
  new URL("../../packages/markspec/main.ts", import.meta.url),
);
const FIXTURE_ROOT = fromFileUrl(
  new URL("../fixtures/desk-project", import.meta.url),
);

const hasNet = Deno.permissions.querySync({ name: "net" }).state ===
  "granted";

Deno.test({
  name: "desk --serve: handshake, auth, tree and entry over loopback",
  ignore: !hasNet,
  async fn() {
    const child = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-net=127.0.0.1",
        CLI_ENTRY,
        "desk",
        "--serve",
        "--port",
        "0",
        "--root",
        FIXTURE_ROOT,
      ],
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const reader = child.stdout.pipeThrough(new TextDecoderStream())
      .getReader();
    try {
      // The handshake is the first stdout line.
      let buffered = "";
      while (!buffered.includes("\n")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffered += chunk.value;
      }
      const handshake = JSON.parse(buffered.split("\n")[0]) as {
        url: string;
        token: string;
        apiVersion: number;
      };
      assertMatch(handshake.url, /^http:\/\/127\.0\.0\.1:\d+$/);
      assertEquals(handshake.apiVersion, 3);
      const auth = { authorization: `Bearer ${handshake.token}` };

      const anonymous = await fetch(`${handshake.url}/api/v1/tree`);
      assertEquals(anonymous.status, 401);
      await anonymous.body?.cancel();

      const tree = await fetch(`${handshake.url}/api/v1/tree`, {
        headers: auth,
      });
      assertEquals(tree.status, 200);
      const treeBody = await tree.json();
      assertEquals(
        treeBody.roots,
        ["HAZ_BRK_0001", "STK_BRK_0001"],
      );
      assertEquals(
        treeBody.edges.some((
          e: { from: string; to: string; relation: string },
        ) =>
          e.from === "SYS_BRK_0001" && e.to === "STK_BRK_0001" &&
          e.relation === "satisfies"
        ),
        true,
      );
      assertEquals(
        treeBody.nodes.some((n: { displayId: string }) =>
          n.displayId === "SYS_BRK_0001"
        ),
        true,
      );

      const noToken = await fetch(
        `${handshake.url}/api/v1/files?path=docs/system.md`,
      );
      assertEquals(noToken.status, 401);
      await noToken.body?.cancel();
      const file = await fetch(
        `${handshake.url}/api/v1/files?path=docs/system.md`,
        { headers: auth },
      );
      assertEquals(file.status, 200);
      assertEquals((await file.json()).path, "docs/system.md");

      const entry = await fetch(
        `${handshake.url}/api/v1/entries/SRS_BRK_0001`,
        { headers: auth },
      );
      assertEquals(entry.status, 200);
      const entryBody = await entry.json();
      assertEquals(entryBody.title, "Sensor input debouncing");
      assertEquals(entryBody.type, "software-requirement");
    } finally {
      await reader.cancel();
      child.kill("SIGTERM");
      await child.status;
    }
  },
});

Deno.test({
  name: "desk --serve --allow-origin: preflight from the extra origin gets 204",
  ignore: !hasNet,
  async fn() {
    const child = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-net=127.0.0.1",
        CLI_ENTRY,
        "desk",
        "--serve",
        "--port",
        "0",
        "--root",
        FIXTURE_ROOT,
        "--allow-origin",
        "http://localhost:5173",
      ],
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const reader = child.stdout.pipeThrough(new TextDecoderStream())
      .getReader();
    try {
      let buffered = "";
      while (!buffered.includes("\n")) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffered += chunk.value;
      }
      const handshake = JSON.parse(buffered.split("\n")[0]) as {
        url: string;
      };

      const allowed = await fetch(`${handshake.url}/api/v1/tree`, {
        method: "OPTIONS",
        headers: { origin: "http://localhost:5173" },
      });
      assertEquals(allowed.status, 204);
      assertEquals(
        allowed.headers.get("access-control-allow-origin"),
        "http://localhost:5173",
      );
      await allowed.body?.cancel();

      const other = await fetch(`${handshake.url}/api/v1/tree`, {
        method: "OPTIONS",
        headers: { origin: "http://localhost:9999" },
      });
      assertEquals(other.status, 403);
      await other.body?.cancel();
    } finally {
      await reader.cancel();
      child.kill("SIGTERM");
      await child.status;
    }
  },
});

Deno.test("desk --serve --allow-origin: a value with a path is rejected", async () => {
  const result = await new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-net=127.0.0.1",
      CLI_ENTRY,
      "desk",
      "--serve",
      "--port",
      "0",
      "--root",
      FIXTURE_ROOT,
      "--allow-origin",
      "http://localhost:5173/path",
    ],
    stdout: "null",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 1);
  assertStringIncludes(
    new TextDecoder().decode(result.stderr),
    "--allow-origin must be an origin",
  );
});

const DESK_ARGS = [
  "run",
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-net=127.0.0.1",
  CLI_ENTRY,
  "desk",
  "--serve",
  "--port",
  "0",
];

/** Read stdout until the first newline; return the first line. */
async function readFirstLine(
  reader: ReadableStreamDefaultReader<string>,
): Promise<string> {
  let buffered = "";
  while (!buffered.includes("\n")) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffered += chunk.value;
  }
  return buffered.split("\n")[0];
}

Deno.test({
  name:
    "desk --serve --root: a folder outside any product exits 1 without a handshake",
  ignore: !hasNet,
  async fn() {
    const outside = await Deno.makeTempDir();
    try {
      const result = await new Deno.Command("deno", {
        args: [...DESK_ARGS, "--root", outside],
        cwd: fromFileUrl(new URL("../..", import.meta.url)),
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.code, 1);
      assertEquals(new TextDecoder().decode(result.stdout), "");
      assertStringIncludes(
        new TextDecoder().decode(result.stderr),
        "No MarkSpec project",
      );
    } finally {
      await Deno.remove(outside, { recursive: true });
    }
  },
});

Deno.test({
  name: "desk --serve --root: a subfolder opens the enclosing product",
  ignore: !hasNet,
  async fn() {
    const child = new Deno.Command("deno", {
      args: [...DESK_ARGS, "--root", `${FIXTURE_ROOT}/docs`],
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const reader = child.stdout.pipeThrough(new TextDecoderStream())
      .getReader();
    try {
      const handshake = JSON.parse(await readFirstLine(reader)) as {
        root: string;
      };
      assertEquals(handshake.root, await Deno.realPath(FIXTURE_ROOT));
    } finally {
      await reader.cancel();
      child.kill("SIGTERM");
      await child.status;
    }
  },
});

Deno.test({
  name: "desk --serve --exit-on-stdin-eof: closing stdin stops the server",
  ignore: !hasNet,
  async fn() {
    const child = new Deno.Command("deno", {
      args: [
        ...DESK_ARGS,
        "--root",
        FIXTURE_ROOT,
        "--exit-on-stdin-eof",
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const reader = child.stdout.pipeThrough(new TextDecoderStream())
      .getReader();
    try {
      await readFirstLine(reader);
      await child.stdin.close();
      const timeout = new Promise<"timeout">((r) =>
        setTimeout(() => r("timeout"), 5000)
      );
      const outcome = await Promise.race([child.status, timeout]);
      if (outcome === "timeout") {
        child.kill("SIGKILL");
        throw new Error("server did not exit within 5000 ms of stdin EOF");
      }
      assertEquals(outcome.code, 0);
    } finally {
      await reader.cancel().catch(() => {});
      try {
        child.kill("SIGKILL");
      } catch { /* already exited */ }
      await child.status;
    }
  },
});

Deno.test({
  name:
    "desk --serve: without --exit-on-stdin-eof, closing stdin keeps serving",
  ignore: !hasNet,
  async fn() {
    const child = new Deno.Command("deno", {
      args: [...DESK_ARGS, "--root", FIXTURE_ROOT],
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const reader = child.stdout.pipeThrough(new TextDecoderStream())
      .getReader();
    try {
      const handshake = JSON.parse(await readFirstLine(reader)) as {
        url: string;
        token: string;
      };
      await child.stdin.close();
      // Give a server that wrongly stops on stdin EOF the time to stop.
      await new Promise((r) => setTimeout(r, 500));
      const res = await fetch(`${handshake.url}/api/v1/tree`, {
        headers: { authorization: `Bearer ${handshake.token}` },
      });
      assertEquals(res.status, 200);
      assertEquals((await res.json()).apiVersion, 3);
    } finally {
      await reader.cancel().catch(() => {});
      try {
        child.kill("SIGKILL");
      } catch { /* already exited */ }
      await child.status;
    }
  },
});

Deno.test({
  name: "desk --serve: a document edited on disk is rendered again",
  ignore: !hasNet,
  async fn() {
    const temp = await Deno.makeTempDir();
    const root = join(temp, "product");
    await copy(FIXTURE_ROOT, root);
    const child = new Deno.Command("deno", {
      args: [...DESK_ARGS, "--root", root],
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const reader = child.stdout.pipeThrough(new TextDecoderStream())
      .getReader();
    try {
      const handshake = JSON.parse(await readFirstLine(reader)) as {
        url: string;
        token: string;
      };
      const url = `${handshake.url}/api/v1/documents?path=docs/system.md`;
      const auth = { authorization: `Bearer ${handshake.token}` };

      const first = await fetch(url, { headers: auth });
      assertEquals(first.status, 200);
      const etag = first.headers.get("etag") ?? "";
      assertMatch(etag, /^"[0-9a-f]{64}"$/);
      const before = (await first.json()).html as string;
      assertEquals(before.includes("Edited on disk"), false);

      const unchanged = await fetch(url, {
        headers: { ...auth, "if-none-match": etag },
      });
      assertEquals(unchanged.status, 304);
      await unchanged.body?.cancel();

      const file = join(root, "docs", "system.md");
      await Deno.writeTextFile(
        file,
        `${await Deno.readTextFile(file)}\nEdited on disk.\n`,
      );
      const edited = await fetch(url, {
        headers: { ...auth, "if-none-match": etag },
      });
      assertEquals(edited.status, 200);
      assertStringIncludes((await edited.json()).html, "Edited on disk");
    } finally {
      await reader.cancel();
      child.kill("SIGTERM");
      await child.status;
      await Deno.remove(temp, { recursive: true });
    }
  },
});
