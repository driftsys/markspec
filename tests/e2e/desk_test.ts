/**
 * @module tests/e2e/desk_test
 *
 * Black-box test for `markspec desk --serve` (ADR-035 walking skeleton):
 * start the real CLI on `--port 0`, read the stdout handshake, and call
 * both endpoints over loopback HTTP. Needs `--allow-net` on the test
 * runner (CI and `just test` grant it); skipped otherwise.
 */

import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

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
      assertEquals(handshake.apiVersion, 2);
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
