/**
 * @module cli/helpers_test
 *
 * Error handling for project collection in CLI commands.
 */

import { assertRejects, assertStrictEquals } from "@std/assert";
import { join } from "@std/path";
import { collectProjectEntriesOrExit } from "./helpers.ts";

Deno.test("collectProjectEntriesOrExit: rethrows unrelated errors", async () => {
  const root = await Deno.makeTempDir();
  const file = join(root, "req.md");
  const failure = new Error(`Cannot read discovered project file: ${file}`);
  try {
    await Deno.writeTextFile(file, "# Requirements\n");
    const error = await assertRejects(() =>
      collectProjectEntriesOrExit(root, {
        readDir: (path) => Deno.readDir(path),
        readFile: (path) => {
          if (path === file) throw failure;
          return Promise.resolve(undefined);
        },
      })
    );
    assertStrictEquals(error, failure);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
