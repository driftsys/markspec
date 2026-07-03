/**
 * @module cli/install/read_config
 *
 * Loop-safe config read for the install orchestrators.
 *
 * The install watchdog ({@linkcode ../install/deadline.ts}) can only fire
 * while the JS event loop keeps running. `Deno.readTextFile` does not
 * satisfy that: a read that parks in a blocking `open()`/`read()` syscall
 * (a contended filesystem, a locked config file, a special file) starves
 * the event loop, so a `setTimeout`-based watchdog wrapped around it never
 * gets a turn (#634).
 *
 * `Deno.open` and `FsFile` stream reads are offloaded to the blocking
 * threadpool, so the event loop stays live even while the open/read is
 * stuck — which lets the watchdog win the race and turn a wedge into a
 * fast diagnostic. This helper reads through that offloaded path while
 * preserving `readTextFile`'s "missing file → treat as empty" contract.
 */

/**
 * Read `path` as UTF-8 text through the offloaded `Deno.open` path so a
 * stalled open/read does not starve the event loop.
 *
 * Returns `undefined` when the file does not exist (the caller treats a
 * missing config as empty). Any other error — permissions, IO — is
 * re-thrown for the caller to surface, matching the prior
 * `Deno.readTextFile` + `NotFound` handling.
 */
export async function readConfigText(
  path: string,
): Promise<string | undefined> {
  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, { read: true });
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return undefined;
    throw err;
  }
  // Consuming `file.readable` closes the underlying handle when the
  // stream ends, so no explicit `file.close()` is needed (and adding one
  // would risk a double-close "Bad resource ID").
  return await new Response(file.readable).text();
}
