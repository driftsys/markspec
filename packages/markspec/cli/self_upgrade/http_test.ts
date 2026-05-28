import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  downloadTo,
  fetchChecksum,
  fetchLatestTag,
  sha256OfFile,
} from "./http.ts";

/** Spin a Deno.serve() on an ephemeral port for the duration of fn. */
async function withServer(
  routes: Record<string, (req: Request) => Response>,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const ac = new AbortController();
  const server = Deno.serve(
    { port: 0, signal: ac.signal, onListen: () => {} },
    (req) => {
      const url = new URL(req.url);
      const handler = routes[url.pathname];
      if (!handler) return new Response("not found", { status: 404 });
      return handler(req);
    },
  );
  const addr = server.addr as { hostname: string; port: number };
  try {
    await fn(`http://${addr.hostname}:${addr.port}`);
  } finally {
    ac.abort();
    await server.finished;
  }
}

Deno.test("fetchLatestTag: parses tag_name from /releases/latest", async () => {
  await withServer(
    {
      "/releases/latest": () =>
        new Response(JSON.stringify({ tag_name: "v0.7.0" }), {
          headers: { "content-type": "application/json" },
        }),
    },
    async (base) => {
      assertEquals(await fetchLatestTag(`${base}/releases`), "v0.7.0");
    },
  );
});

Deno.test("fetchLatestTag: rejects with helpful message on HTTP 5xx", async () => {
  await withServer(
    {
      "/releases/latest": () => new Response("server boom", { status: 500 }),
    },
    async (base) => {
      await assertRejects(
        () => fetchLatestTag(`${base}/releases`),
        Error,
        "status 500",
      );
    },
  );
});

Deno.test("fetchLatestTag: rejects with helpful message on HTTP 404", async () => {
  await withServer(
    {},
    async (base) => {
      await assertRejects(
        () => fetchLatestTag(`${base}/releases`),
        Error,
        "status 404",
      );
    },
  );
});

Deno.test("downloadTo: writes body bytes to file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await withServer(
      {
        "/asset.bin": () =>
          new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }),
      },
      async (base) => {
        const target = join(dir, "asset");
        await downloadTo(`${base}/asset.bin`, target);
        assertEquals(await Deno.readFile(target), new Uint8Array([1, 2, 3, 4]));
      },
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("downloadTo: rejects on non-2xx with status in message", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await withServer(
      { "/asset.bin": () => new Response("", { status: 404 }) },
      async (base) => {
        await assertRejects(
          () => downloadTo(`${base}/asset.bin`, join(dir, "asset")),
          Error,
          "status 404",
        );
      },
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("fetchChecksum: returns lowercase hex digest from .sha256 line", async () => {
  const hex = "abcd1234".repeat(8);
  await withServer(
    {
      "/sums": () =>
        new Response(
          `${hex.toUpperCase()}  markspec-x86_64-unknown-linux-gnu.tar.gz\n`,
        ),
    },
    async (base) => {
      assertEquals(await fetchChecksum(`${base}/sums`), hex);
    },
  );
});

Deno.test("sha256OfFile: matches a known hash", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "in.bin");
    await Deno.writeTextFile(path, "hello world");
    // sha256 of "hello world" = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    assertEquals(
      await sha256OfFile(path),
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("fetchLatestTag: helpful message on network error (server unreachable)", async () => {
  // Use a port that nothing should be listening on. (Pick 1; lower than
  // ephemeral range so we won't collide with leftover sockets.)
  await assertRejects(
    () => fetchLatestTag("http://127.0.0.1:1/releases"),
    Error,
  );
});
