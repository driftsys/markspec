/**
 * @module cli/install/write_config
 *
 * Loop-safe config write for the install orchestrators — the write-path
 * counterpart to {@linkcode ./read_config.ts}'s `readConfigText`.
 *
 * `Deno.writeTextFile` fuses open+write into one op that starves the event
 * loop when it stalls (a contended filesystem, a special file), so the
 * install watchdog ({@linkcode ./deadline.ts}) can never get a turn to
 * fire. `Deno.open` and `FsFile.write` are offloaded to the blocking
 * threadpool, keeping the loop alive so a stalled write becomes a fast
 * diagnostic instead of a silent hang (#634).
 */

/**
 * Write `content` as UTF-8 text to `path` through the offloaded
 * `Deno.open` path so a stalled open/write does not starve the event
 * loop. Creates the file if missing and truncates it otherwise, matching
 * `Deno.writeTextFile`'s default behaviour. The write loops until every
 * byte is flushed (a single `FsFile.write` may be partial).
 */
export async function writeConfigText(
  path: string,
  content: string,
): Promise<void> {
  const file = await Deno.open(path, {
    write: true,
    create: true,
    truncate: true,
  });
  try {
    const data = new TextEncoder().encode(content);
    let offset = 0;
    while (offset < data.length) {
      offset += await file.write(data.subarray(offset));
    }
  } finally {
    file.close();
  }
}
