/**
 * @module tests/e2e/desk_test
 *
 * Black-box test for `markspec desk --serve` (ADR-035 walking skeleton):
 * start the real CLI on `--port 0`, read the stdout handshake, and call
 * both endpoints over loopback HTTP. Needs `--allow-net` on the test
 * runner (CI and `just test` grant it); skipped otherwise.
 */

import { assertEquals, assertMatch } from "@std/assert";
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
      assertEquals(handshake.apiVersion, 1);
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
        treeBody.nodes.map((n: { displayId: string }) => n.displayId),
        ["HAZ_BRK_0001", "STK_BRK_0001"],
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
