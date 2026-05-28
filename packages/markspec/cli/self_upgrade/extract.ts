/**
 * @module cli/self_upgrade/extract
 *
 * Extract the single binary entry from a markspec release tarball
 * (gzip-compressed POSIX tar). The release workflow produces archives
 * with exactly one file inside (`markspec` or `markspec.exe`); we look
 * for the expected name and copy its bytes to `outPath`. Anything else
 * — empty tarball, wrong entry name, additional entries — is rejected
 * so a corrupted or unexpected archive doesn't silently land on disk.
 *
 * Reads via Web Streams: file → DecompressionStream("gzip") →
 * UntarStream → first entry's body → write to outPath via
 * Deno.writeFile.
 */

import { UntarStream } from "@std/tar/untar-stream";

export async function extractSingleBinary(
  tarballPath: string,
  outPath: string,
  expectedEntryName: string,
): Promise<void> {
  const file = await Deno.open(tarballPath, { read: true });
  const decompressed = file.readable.pipeThrough(
    new DecompressionStream("gzip"),
  );
  const reader = decompressed.pipeThrough(new UntarStream()).getReader();

  let extracted = false;
  try {
    while (true) {
      const { done, value: entry } = await reader.read();
      if (done) break;

      // `entry.readable` is present only for file entries (typeflag "0").
      // Directories, symlinks, etc. have no readable — skip them.
      if (!entry.readable) continue;

      if (entry.path !== expectedEntryName) {
        await drain(entry.readable);
        continue;
      }

      // Found the target entry — read it entirely before writing.
      const chunks: Uint8Array[] = [];
      for await (const c of entry.readable) chunks.push(c);
      let total = 0;
      for (const c of chunks) total += c.byteLength;
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        buf.set(c, off);
        off += c.byteLength;
      }
      await Deno.writeFile(outPath, buf);
      extracted = true;
      // Release the reader so the underlying streams can be GC'd.
      break;
    }
  } finally {
    reader.releaseLock();
  }

  if (!extracted) {
    throw new Error(
      `expected entry '${expectedEntryName}' not found in tarball`,
    );
  }
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
