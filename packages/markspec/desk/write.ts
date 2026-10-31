/**
 * @module desk/write
 *
 * Atomic file write for the desk server (`markspec desk --serve`). The API
 * handler (`desk/api.ts`) stays free of `Deno.*` calls and writes through
 * `DeskSource.writeFile`, which `desk/server.ts` backs with
 * {@linkcode writeTextFileAtomic}.
 */

import { basename, dirname, join } from "@std/path";

/** The UTF-8 byte order mark. */
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

/**
 * Write `text` to `path` atomically. The text goes to a new temporary file
 * `.<name>.markdesk-<8 hex>.tmp` in the same folder (created with
 * `createNew`, so an existing file is never reused), which then gets the
 * original file's mode (POSIX only) and is renamed over `path`. A reader
 * sees either the old content or the new content, never a partial file.
 *
 * When the original file starts with a UTF-8 BOM and `text` does not, the
 * BOM is written first: a text read drops the BOM, and the write keeps it.
 *
 * On failure the temporary file is removed and the error is rethrown.
 */
export async function writeTextFileAtomic(
  path: string,
  text: string,
): Promise<void> {
  const [mode, hasBom] = await Promise.all([modeOf(path), startsWithBom(path)]);
  const encoded = new TextEncoder().encode(text);
  const bytes = hasBom && !text.startsWith("﻿")
    ? new Uint8Array([...UTF8_BOM, ...encoded])
    : encoded;

  const suffix = [...crypto.getRandomValues(new Uint8Array(4))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const temp = join(dirname(path), `.${basename(path)}.markdesk-${suffix}.tmp`);

  await Deno.writeFile(temp, bytes, { createNew: true });
  try {
    if (mode !== undefined && Deno.build.os !== "windows") {
      // Set after creation: the create mode is reduced by the umask.
      await Deno.chmod(temp, mode);
    }
    await Deno.rename(temp, path);
  } catch (err) {
    try {
      await Deno.remove(temp);
    } catch { /* the temporary file may already be gone */ }
    throw err;
  }
}

/** Permission bits of `path`; `undefined` when it cannot be read. */
async function modeOf(path: string): Promise<number | undefined> {
  try {
    const mode = (await Deno.stat(path)).mode;
    return mode === null ? undefined : mode & 0o7777;
  } catch {
    return undefined;
  }
}

/** Whether the file at `path` starts with a UTF-8 BOM. */
async function startsWithBom(path: string): Promise<boolean> {
  let file: Deno.FsFile | undefined;
  try {
    file = await Deno.open(path, { read: true });
    const head = new Uint8Array(3);
    let filled = 0;
    while (filled < 3) {
      const n = await file.read(head.subarray(filled));
      if (n === null) break;
      filled += n;
    }
    return filled === 3 && head.every((b, i) => b === UTF8_BOM[i]);
  } catch {
    return false;
  } finally {
    file?.close();
  }
}
