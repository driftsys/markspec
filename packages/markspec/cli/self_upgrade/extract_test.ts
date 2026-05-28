import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { TarStream } from "@std/tar/tar-stream";
import { extractSingleBinary } from "./extract.ts";

/**
 * Build a tiny tar.gz containing the given files. Uses @std/tar's
 * `TarStream` for writing, piped through `CompressionStream("gzip")`.
 * The release workflow produces ustar archives (one entry); the same
 * shape is what extractSingleBinary consumes.
 *
 * TarStream is a backpressure-aware TransformStream: the writable side
 * blocks until the readable side is being consumed. We therefore start
 * a concurrent collector task before writing so neither side deadlocks.
 */
async function makeTarGz(
  files: { name: string; bytes: Uint8Array }[],
): Promise<Uint8Array> {
  const tarStream = new TarStream();

  // Start collecting compressed output concurrently so the writable
  // side doesn't block waiting for a reader.
  const collectTask: Promise<Uint8Array[]> = (async () => {
    const chunks: Uint8Array[] = [];
    const compressed = tarStream.readable.pipeThrough(
      new CompressionStream("gzip"),
    );
    for await (const chunk of compressed) chunks.push(chunk);
    return chunks;
  })();

  const writer = tarStream.writable.getWriter();
  for (const f of files) {
    await writer.write({
      type: "file",
      path: f.name,
      size: f.bytes.byteLength,
      readable: ReadableStream.from([f.bytes]),
    });
  }
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

Deno.test("extractSingleBinary: writes the single payload file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const payload = new TextEncoder().encode("fake-binary-bytes");
    const tar = await makeTarGz([{ name: "markspec", bytes: payload }]);
    const tarPath = join(dir, "input.tar.gz");
    await Deno.writeFile(tarPath, tar);

    const outPath = join(dir, "markspec.new");
    await extractSingleBinary(tarPath, outPath, "markspec");
    const got = await Deno.readFile(outPath);
    assertEquals(got, payload);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("extractSingleBinary: extracts markspec.exe payload on windows naming", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const payload = new TextEncoder().encode("fake-exe-bytes");
    const tar = await makeTarGz([{ name: "markspec.exe", bytes: payload }]);
    const tarPath = join(dir, "input.tar.gz");
    await Deno.writeFile(tarPath, tar);

    const outPath = join(dir, "markspec.new.exe");
    await extractSingleBinary(tarPath, outPath, "markspec.exe");
    const got = await Deno.readFile(outPath);
    assertEquals(got, payload);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("extractSingleBinary: rejects empty tarball", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const tar = await makeTarGz([]);
    const tarPath = join(dir, "input.tar.gz");
    await Deno.writeFile(tarPath, tar);

    await assertRejects(
      () => extractSingleBinary(tarPath, join(dir, "out"), "markspec"),
      Error,
      "expected entry",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("extractSingleBinary: rejects tarball with wrong entry name", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const tar = await makeTarGz([
      { name: "wrong-name", bytes: new TextEncoder().encode("x") },
    ]);
    const tarPath = join(dir, "input.tar.gz");
    await Deno.writeFile(tarPath, tar);

    await assertRejects(
      () => extractSingleBinary(tarPath, join(dir, "out"), "markspec"),
      Error,
      "expected entry",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
