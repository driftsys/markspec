/**
 * @module cli/helpers_test
 *
 * Error handling for project collection in CLI commands.
 */

import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { join } from "@std/path";
import {
  collectProjectEntriesOrExit,
  denoDiscoveryIO,
  owningProjectEntries,
  syncMappingFolders,
} from "./helpers.ts";
import {
  createProjectRootResolver,
  isWithin,
  type ProjectRootResolver,
} from "../core/mod.ts";

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

/** Write `files` (relative path → content) below a new temp dir. */
async function tempTree(files: Record<string, string>): Promise<string> {
  const root = await Deno.makeTempDir();
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, ...name.split("/"));
    await Deno.mkdir(join(path, ".."), { recursive: true });
    await Deno.writeTextFile(path, content);
  }
  return root;
}

/**
 * A project-root resolver that sees no file outside `root`, so a
 * `project.yaml` or `.markspec.yaml` above the temp dir (on a developer
 * machine or a CI runner) cannot become the project root.
 */
function confinedResolver(root: string): ProjectRootResolver {
  const io = denoDiscoveryIO();
  return createProjectRootResolver({
    readDir: io.readDir,
    readFile: (path) =>
      isWithin(root, path) ? io.readFile(path) : Promise.resolve(undefined),
  });
}

/** One entry block with display ID `id` and a ULID ending in `n`. */
function entryBlock(id: string, n: number): string {
  return `- [${id}] Title ${n}\n\n  Body.\n\n      Id: ` +
    `01HGW2Q8MNP3RSTVWXYZABCD${String(n).padStart(2, "0")}\n`;
}

Deno.test("owningProjectEntries: reads the files of the target file's project, without nested projects", async () => {
  const root = await tempTree({
    "proj/project.yaml": "name: x\nversion: 0.1.0\n",
    "proj/.markspec.yaml": "exclude:\n  - archive/\n",
    "proj/docs/a.md": entryBlock("REQ-0001", 1),
    "proj/docs/b.md": entryBlock("REQ-0002", 2),
    "proj/archive/old.md": entryBlock("REQ-0009", 9),
    "proj/sub/project.yaml": "name: sub\nversion: 0.1.0\n",
    "proj/sub/c.md": entryBlock("REQ-0003", 3),
  });
  try {
    const resolver = confinedResolver(root);
    const ids = (await owningProjectEntries(
      join(root, "proj/docs/b.md"),
      resolver,
    )).map((e) => e.displayId).sort();
    assertEquals(ids, ["REQ-0001", "REQ-0002"]);
    // A file of the nested project reads that project only.
    const nested = (await owningProjectEntries(
      join(root, "proj/sub/c.md"),
      resolver,
    )).map((e) => e.displayId);
    assertEquals(nested, ["REQ-0003"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("owningProjectEntries: no project config above the file gives no entries", async () => {
  const root = await tempTree({
    "loose/a.md": entryBlock("REQ-0001", 1),
    "loose/b.md": entryBlock("REQ-0002", 2),
  });
  try {
    const resolver = confinedResolver(root);
    assertEquals(
      await owningProjectEntries(join(root, "loose/b.md"), resolver),
      [],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
