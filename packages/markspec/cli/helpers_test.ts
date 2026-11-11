/**
 * @module cli/helpers_test
 *
 * Error handling for project collection in CLI commands.
 */

import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { join } from "@std/path";
import { collectProjectEntriesOrExit, syncMappingFolders } from "./helpers.ts";
import type { ProjectRootResolver } from "../core/mod.ts";

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

for (
  const scenario of [
    {
      name: "unknown outermost root",
      outermost: undefined,
      expected: ["p/group/sub"],
    },
    {
      name: "outermost root equals root",
      outermost: "p/group/sub",
      expected: ["p/group/sub"],
    },
    {
      name: "outermost root is not an ancestor",
      outermost: "other",
      expected: ["p/group/sub"],
    },
    {
      name: "three-level walk from outermost to root",
      outermost: "p",
      expected: ["p", "p/group", "p/group/sub"],
    },
  ]
) {
  Deno.test(`syncMappingFolders: ${scenario.name}`, async () => {
    const root = join(Deno.cwd(), "p/group/sub");
    const resolver: ProjectRootResolver = {
      ownerOf: () => Promise.resolve(root),
      nestedRoots: () => Promise.resolve([]),
      outermostOf: () =>
        Promise.resolve(
          scenario.outermost === undefined
            ? undefined
            : join(Deno.cwd(), scenario.outermost),
        ),
    };
    assertEquals(
      await syncMappingFolders(root, resolver),
      scenario.expected.map((folder) => join(Deno.cwd(), folder)),
    );
  });
}
