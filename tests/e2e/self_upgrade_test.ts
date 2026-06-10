/**
 * E2E tests for `markspec self-upgrade`.
 *
 * The CLI runs via `markspecInDir` (which spawns `deno run main.ts ...`)
 * so the real `Deno.execPath()` inside the spawned process is the deno
 * binary. The orchestrator falls back to the `MARKSPEC_SELF_UPGRADE_BIN_PATH`
 * env var when set; the tests use that to point at a temp file.
 *
 * The mocked release server is a `Deno.serve()` on an ephemeral port,
 * exposed via `MARKSPEC_RELEASES_API` + `MARKSPEC_RELEASES_DOWNLOAD_BASE`.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { encodeHex } from "@std/encoding/hex";
import { join } from "@std/path";
import { TarStream } from "@std/tar/tar-stream";
import { markspecInDir } from "./helpers.ts";
import { VERSION } from "../../packages/markspec/core/mod.ts";

const TARGET = (() => {
  if (Deno.build.os === "linux" && Deno.build.arch === "x86_64") {
    return "x86_64-unknown-linux-gnu";
  }
  if (Deno.build.os === "linux" && Deno.build.arch === "aarch64") {
    return "aarch64-unknown-linux-gnu";
  }
  if (Deno.build.os === "darwin" && Deno.build.arch === "x86_64") {
    return "x86_64-apple-darwin";
  }
  if (Deno.build.os === "darwin" && Deno.build.arch === "aarch64") {
    return "aarch64-apple-darwin";
  }
  if (Deno.build.os === "windows" && Deno.build.arch === "x86_64") {
    return "x86_64-pc-windows-msvc";
  }
  throw new Error("unsupported test platform");
})();

const BIN_NAME = Deno.build.os === "windows" ? "markspec.exe" : "markspec";

/**
 * Build a tiny tar.gz containing a single entry. TarStream is a
 * backpressure-aware TransformStream — the writes block until the
 * readable side is consumed, so we start collecting concurrently.
 */
async function makeTarGz(payload: Uint8Array): Promise<Uint8Array> {
  const tarStream = new TarStream();

  const collectTask: Promise<Uint8Array[]> = (async () => {
    const chunks: Uint8Array[] = [];
    const compressed = tarStream.readable.pipeThrough(
      new CompressionStream("gzip"),
    );
    for await (const chunk of compressed) chunks.push(chunk);
    return chunks;
  })();

  const writer = tarStream.writable.getWriter();
  await writer.write({
    type: "file",
    path: BIN_NAME,
    size: payload.byteLength,
    readable: ReadableStream.from([payload]),
  });
  await writer.close();

  const chunks = await collectTask;
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer so crypto.subtle.digest accepts it
  // regardless of whether the source uses a SharedArrayBuffer backing.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const buf = await crypto.subtle.digest("SHA-256", copy);
  return encodeHex(new Uint8Array(buf));
}

interface MockServer {
  baseUrl: string;
  close: () => Promise<void>;
}

function startMock(
  latestTag: string,
  tarGz: Uint8Array,
  checksumLine: string,
): MockServer {
  const ac = new AbortController();
  const server = Deno.serve(
    { port: 0, signal: ac.signal, onListen: () => {} },
    (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/releases/latest") {
        return new Response(JSON.stringify({ tag_name: latestTag }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname.endsWith(".tar.gz.sha256")) {
        return new Response(checksumLine, { status: 200 });
      }
      if (url.pathname.endsWith(".tar.gz")) {
        // Copy into a plain ArrayBuffer so Response accepts it.
        const copy = new Uint8Array(tarGz.byteLength);
        copy.set(tarGz);
        return new Response(copy, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    },
  );
  const addr = server.addr as { hostname: string; port: number };
  // server.addr.hostname is "0.0.0.0" (bind address); Windows can't
  // connect to that (os error 10049). Use 127.0.0.1 for client URLs.
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      ac.abort();
      await server.finished;
    },
  };
}

Deno.test("self-upgrade --check: up-to-date → exit 0", async () => {
  const newPayload = new TextEncoder().encode("NEW");
  const tarGz = await makeTarGz(newPayload);
  const sum = await sha256Hex(tarGz);
  const mock = startMock(
    `v${VERSION}`,
    tarGz,
    `${sum}  markspec-${TARGET}.tar.gz\n`,
  );
  const dir = await Deno.makeTempDir();
  try {
    const binPath = join(dir, BIN_NAME);
    await Deno.writeTextFile(binPath, "OLD");
    const { code, stdout } = await markspecInDir(
      dir,
      ["self-upgrade", "--check"],
      ["--allow-net", "--allow-env", "--allow-run"],
      {
        MARKSPEC_RELEASES_API: `${mock.baseUrl}/releases`,
        MARKSPEC_RELEASES_DOWNLOAD_BASE: `${mock.baseUrl}/releases/download`,
        MARKSPEC_SELF_UPGRADE_BIN_PATH: binPath,
        MARKSPEC_TEST_MODE: "1",
      },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, `markspec ${VERSION} (up-to-date)`);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await mock.close();
  }
});

Deno.test("self-upgrade --check: newer available → exit 1", async () => {
  const next = nextPatch(VERSION);
  const newPayload = new TextEncoder().encode("NEW");
  const tarGz = await makeTarGz(newPayload);
  const sum = await sha256Hex(tarGz);
  const mock = startMock(
    `v${next}`,
    tarGz,
    `${sum}  markspec-${TARGET}.tar.gz\n`,
  );
  const dir = await Deno.makeTempDir();
  try {
    const binPath = join(dir, BIN_NAME);
    await Deno.writeTextFile(binPath, "OLD");
    const { code, stdout } = await markspecInDir(
      dir,
      ["self-upgrade", "--check"],
      ["--allow-net", "--allow-env", "--allow-run"],
      {
        MARKSPEC_RELEASES_API: `${mock.baseUrl}/releases`,
        MARKSPEC_RELEASES_DOWNLOAD_BASE: `${mock.baseUrl}/releases/download`,
        MARKSPEC_SELF_UPGRADE_BIN_PATH: binPath,
        MARKSPEC_TEST_MODE: "1",
      },
    );
    assertEquals(code, 1);
    assertStringIncludes(stdout, `latest is ${next}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await mock.close();
  }
});

Deno.test("self-upgrade: up-to-date → already-current, no FS change", async () => {
  const tarGz = await makeTarGz(new TextEncoder().encode("NEW"));
  const sum = await sha256Hex(tarGz);
  const mock = startMock(
    `v${VERSION}`,
    tarGz,
    `${sum}  markspec-${TARGET}.tar.gz\n`,
  );
  const dir = await Deno.makeTempDir();
  try {
    const binPath = join(dir, BIN_NAME);
    await Deno.writeTextFile(binPath, "OLD");
    const { code, stdout } = await markspecInDir(
      dir,
      ["self-upgrade"],
      ["--allow-net", "--allow-env", "--allow-run"],
      {
        MARKSPEC_RELEASES_API: `${mock.baseUrl}/releases`,
        MARKSPEC_RELEASES_DOWNLOAD_BASE: `${mock.baseUrl}/releases/download`,
        MARKSPEC_SELF_UPGRADE_BIN_PATH: binPath,
        MARKSPEC_TEST_MODE: "1",
      },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "already on the latest release");
    assertEquals(await Deno.readTextFile(binPath), "OLD");
  } finally {
    await Deno.remove(dir, { recursive: true });
    await mock.close();
  }
});

Deno.test(
  "self-upgrade: newer available → upgrade, .old left behind",
  async () => {
    const next = nextPatch(VERSION);
    const newPayload = new TextEncoder().encode("NEW-BYTES");
    const tarGz = await makeTarGz(newPayload);
    const sum = await sha256Hex(tarGz);
    const mock = startMock(
      `v${next}`,
      tarGz,
      `${sum}  markspec-${TARGET}.tar.gz\n`,
    );
    const dir = await Deno.makeTempDir();
    try {
      const binPath = join(dir, BIN_NAME);
      await Deno.writeTextFile(binPath, "OLD-BYTES");
      const { code, stdout } = await markspecInDir(
        dir,
        ["self-upgrade"],
        ["--allow-net", "--allow-env", "--allow-run"],
        {
          MARKSPEC_RELEASES_API: `${mock.baseUrl}/releases`,
          MARKSPEC_RELEASES_DOWNLOAD_BASE: `${mock.baseUrl}/releases/download`,
          MARKSPEC_SELF_UPGRADE_BIN_PATH: binPath,
          MARKSPEC_TEST_MODE: "1",
        },
      );
      assertEquals(code, 0);
      assertStringIncludes(stdout, `Upgraded markspec ${VERSION} → ${next}`);
      assertEquals(await Deno.readFile(binPath), newPayload);
      assertEquals(await Deno.readTextFile(`${binPath}.old`), "OLD-BYTES");
    } finally {
      await Deno.remove(dir, { recursive: true });
      await mock.close();
    }
  },
);

Deno.test(
  "self-upgrade: checksum mismatch → exit 2, binary untouched",
  async () => {
    const next = nextPatch(VERSION);
    const tarGz = await makeTarGz(new TextEncoder().encode("NEW"));
    const badSum = "0".repeat(64);
    const mock = startMock(
      `v${next}`,
      tarGz,
      `${badSum}  markspec-${TARGET}.tar.gz\n`,
    );
    const dir = await Deno.makeTempDir();
    try {
      const binPath = join(dir, BIN_NAME);
      await Deno.writeTextFile(binPath, "OLD");
      const { code, stderr } = await markspecInDir(
        dir,
        ["self-upgrade"],
        ["--allow-net", "--allow-env", "--allow-run"],
        {
          MARKSPEC_RELEASES_API: `${mock.baseUrl}/releases`,
          MARKSPEC_RELEASES_DOWNLOAD_BASE: `${mock.baseUrl}/releases/download`,
          MARKSPEC_SELF_UPGRADE_BIN_PATH: binPath,
          MARKSPEC_TEST_MODE: "1",
        },
      );
      assertEquals(code, 2);
      assertStringIncludes(stderr, "checksum mismatch");
      assertEquals(await Deno.readTextFile(binPath), "OLD");
      let oldExists = true;
      try {
        await Deno.stat(`${binPath}.old`);
      } catch {
        oldExists = false;
      }
      assert(!oldExists);
    } finally {
      await Deno.remove(dir, { recursive: true });
      await mock.close();
    }
  },
);

Deno.test("self-upgrade --version v0.0.1: downgrade flow", async () => {
  const newPayload = new TextEncoder().encode("OLDER-BYTES");
  const tarGz = await makeTarGz(newPayload);
  const sum = await sha256Hex(tarGz);
  const mock = startMock(
    "v999.0.0",
    tarGz,
    `${sum}  markspec-${TARGET}.tar.gz\n`,
  );
  const dir = await Deno.makeTempDir();
  try {
    const binPath = join(dir, BIN_NAME);
    await Deno.writeTextFile(binPath, "CURRENT-BYTES");
    const { code, stdout } = await markspecInDir(
      dir,
      ["self-upgrade", "--version", "v0.0.1"],
      ["--allow-net", "--allow-env", "--allow-run"],
      {
        MARKSPEC_RELEASES_API: `${mock.baseUrl}/releases`,
        MARKSPEC_RELEASES_DOWNLOAD_BASE: `${mock.baseUrl}/releases/download`,
        MARKSPEC_SELF_UPGRADE_BIN_PATH: binPath,
        MARKSPEC_TEST_MODE: "1",
      },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, `Switched markspec ${VERSION} → 0.0.1`);
    assertEquals(await Deno.readFile(binPath), newPayload);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await mock.close();
  }
});

Deno.test({
  name: "self-upgrade: PM-managed path (brew Cellar) → refused",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const next = nextPatch(VERSION);
    const tarGz = await makeTarGz(new TextEncoder().encode("NEW"));
    const sum = await sha256Hex(tarGz);
    const mock = startMock(
      `v${next}`,
      tarGz,
      `${sum}  markspec-${TARGET}.tar.gz\n`,
    );
    const dir = await Deno.makeTempDir();
    try {
      const cellarDir = join(dir, "Cellar", "markspec", "0.6.1", "bin");
      await Deno.mkdir(cellarDir, { recursive: true });
      const realBin = join(cellarDir, BIN_NAME);
      await Deno.writeTextFile(realBin, "BREW-BIN");
      const linkBin = join(dir, BIN_NAME);
      await Deno.symlink(realBin, linkBin);
      const { code, stderr } = await markspecInDir(
        dir,
        ["self-upgrade"],
        ["--allow-net", "--allow-env", "--allow-run"],
        {
          MARKSPEC_RELEASES_API: `${mock.baseUrl}/releases`,
          MARKSPEC_RELEASES_DOWNLOAD_BASE: `${mock.baseUrl}/releases/download`,
          MARKSPEC_SELF_UPGRADE_BIN_PATH: linkBin,
          MARKSPEC_TEST_MODE: "1",
        },
      );
      assertEquals(code, 2);
      assertStringIncludes(stderr, "Homebrew");
      assertStringIncludes(stderr, "brew upgrade markspec");
    } finally {
      await Deno.remove(dir, { recursive: true });
      await mock.close();
    }
  },
});

Deno.test({
  name: "self-upgrade: PM-managed path (~/.cargo/bin) → refused (#575)",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const next = nextPatch(VERSION);
    const tarGz = await makeTarGz(new TextEncoder().encode("NEW"));
    const sum = await sha256Hex(tarGz);
    const mock = startMock(
      `v${next}`,
      tarGz,
      `${sum}  markspec-${TARGET}.tar.gz\n`,
    );
    const dir = await Deno.makeTempDir();
    try {
      // Resolve the temp dir's realpath up front: the classifier compares the
      // binary's realpath against HOME, and on macOS the temp dir is a
      // symlink (/var → /private/var), so both sides must be realpaths.
      const realDir = await Deno.realPath(dir);
      const cargoBin = join(realDir, ".cargo", "bin");
      await Deno.mkdir(cargoBin, { recursive: true });
      const realBin = join(cargoBin, BIN_NAME);
      await Deno.writeTextFile(realBin, "CARGO-BIN");
      const { code, stderr } = await markspecInDir(
        dir,
        ["self-upgrade"],
        ["--allow-net", "--allow-env", "--allow-run"],
        {
          MARKSPEC_RELEASES_API: `${mock.baseUrl}/releases`,
          MARKSPEC_RELEASES_DOWNLOAD_BASE: `${mock.baseUrl}/releases/download`,
          MARKSPEC_SELF_UPGRADE_BIN_PATH: realBin,
          MARKSPEC_TEST_MODE: "1",
          // The cargo rule matches `${HOME}/.cargo/bin/` — point HOME at the
          // temp dir's realpath so the realpath classifies as cargo.
          HOME: realDir,
        },
      );
      assertEquals(code, 2);
      assertStringIncludes(stderr, "Cargo");
      assertStringIncludes(stderr, "cargo install markspec --force");
    } finally {
      await Deno.remove(dir, { recursive: true });
      await mock.close();
    }
  },
});

Deno.test(
  "self-upgrade --format json: emits valid JSON outcome",
  async () => {
    const tarGz = await makeTarGz(new TextEncoder().encode("NEW"));
    const sum = await sha256Hex(tarGz);
    const mock = startMock(
      `v${VERSION}`,
      tarGz,
      `${sum}  markspec-${TARGET}.tar.gz\n`,
    );
    const dir = await Deno.makeTempDir();
    try {
      const binPath = join(dir, BIN_NAME);
      await Deno.writeTextFile(binPath, "OLD");
      const { code, stdout } = await markspecInDir(
        dir,
        ["self-upgrade", "--format", "json"],
        ["--allow-net", "--allow-env", "--allow-run"],
        {
          MARKSPEC_RELEASES_API: `${mock.baseUrl}/releases`,
          MARKSPEC_RELEASES_DOWNLOAD_BASE: `${mock.baseUrl}/releases/download`,
          MARKSPEC_SELF_UPGRADE_BIN_PATH: binPath,
          MARKSPEC_TEST_MODE: "1",
        },
      );
      assertEquals(code, 0);
      const parsed = JSON.parse(stdout.trim());
      assertEquals(parsed.action, "already-current");
      assertEquals(parsed.current, VERSION);
      assertEquals(parsed.target, VERSION);
    } finally {
      await Deno.remove(dir, { recursive: true });
      await mock.close();
    }
  },
);

function nextPatch(v: string): string {
  const [maj, min, pat] = v.split(".").map((s) => parseInt(s, 10));
  return `${maj}.${min}.${pat + 1}`;
}
