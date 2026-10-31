import { assertEquals } from "@std/assert";
import { join, resolve, SEPARATOR } from "@std/path";
import type { DiscoveryIO } from "./mod.ts";
import {
  createProjectRootResolver,
  discoverProjectRoots,
  resolveConfigRoot,
} from "./projects.ts";
import { makeTree, realIO } from "./test_helpers.ts";

const PROJECT = "name: test\n";

async function real(path: string): Promise<string> {
  return await Deno.realPath(path);
}

Deno.test("discoverProjectRoots: parent without config, two children", async () => {
  const dir = await real(
    await makeTree({ "a/project.yaml": PROJECT, "b/project.yaml": PROJECT }),
  );
  const result = await discoverProjectRoots(dir, realIO());
  assertEquals(result.primaryRoot, dir);
  assertEquals(result.roots, [join(dir, "a"), join(dir, "b")]);
});

Deno.test("discoverProjectRoots: project with nested project", async () => {
  const dir = await real(
    await makeTree({ "project.yaml": PROJECT, "sub/project.yaml": PROJECT }),
  );
  const result = await discoverProjectRoots(dir, realIO());
  assertEquals(result.roots, [dir, join(dir, "sub")]);
});

Deno.test("discoverProjectRoots: .markspec.yaml below project.yaml is not a root", async () => {
  const dir = await real(
    await makeTree({
      "project.yaml": PROJECT,
      "sub/.markspec.yaml": "exclude: []\n",
    }),
  );
  const result = await discoverProjectRoots(dir, realIO());
  assertEquals(result.roots, [dir]);
});

Deno.test("discoverProjectRoots: hidden, gitignored and excluded folders skipped", async () => {
  const dir = await real(
    await makeTree({
      "project.yaml": PROJECT,
      ".markspec.yaml": "exclude:\n  - fixtures/\n",
      ".gitignore": "ignored/\n",
      ".hidden/project.yaml": PROJECT,
      "ignored/project.yaml": PROJECT,
      "fixtures/project.yaml": PROJECT,
    }),
  );
  const result = await discoverProjectRoots(dir, realIO());
  assertEquals(result.roots, [dir]);
});

Deno.test("discoverProjectRoots: start in a subfolder walks up first", async () => {
  const dir = await real(
    await makeTree({ "a/project.yaml": PROJECT, "a/docs/x.md": "" }),
  );
  const result = await discoverProjectRoots(join(dir, "a", "docs"), realIO());
  assertEquals(result.primaryRoot, join(dir, "a"));
  assertEquals(result.roots, [join(dir, "a")]);
});

Deno.test("discoverProjectRoots: no config anywhere", async () => {
  const dir = await real(await makeTree({ "a/x.md": "" }));
  const result = await discoverProjectRoots(dir, realIO());
  assertEquals(result.roots, []);
});

Deno.test("discoverProjectRoots: no downward scan from homeDir", async () => {
  const dir = await real(await makeTree({ "a/project.yaml": PROJECT }));
  const result = await discoverProjectRoots(dir, realIO(), { homeDir: dir });
  assertEquals(result.roots, []);
});

Deno.test("discoverProjectRoots: a nested project's exclude applies to its subtree", async () => {
  const dir = await real(
    await makeTree({
      "a/project.yaml": PROJECT,
      "a/.markspec.yaml": 'exclude: ["fixtures/"]\n',
      "a/fixtures/x/project.yaml": PROJECT,
    }),
  );
  const result = await discoverProjectRoots(dir, realIO());
  assertEquals(result.roots, [join(dir, "a")]);
});

/** A `DiscoveryIO` over an in-memory map of absolute paths to contents.
 * Folders are implied by the file paths. */
function memoryIO(files: Record<string, string>): DiscoveryIO {
  const store = new Map(Object.entries(files));
  return {
    readFile: (path) => Promise.resolve(store.get(path)),
    readDir: async function* (dir) {
      const prefix = dir.endsWith(SEPARATOR) ? dir : dir + SEPARATOR;
      const seen = new Set<string>();
      for (const path of store.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const name = rest.split(/[\\/]/)[0];
        if (seen.has(name)) continue;
        seen.add(name);
        const isFile = rest === name;
        yield { name, isFile, isDirectory: !isFile };
      }
    },
  };
}

const FS_ROOT = resolve("/");

Deno.test("discoverProjectRoots: no downward scan from a filesystem root without config", async () => {
  const io = memoryIO({ [join(FS_ROOT, "a", "project.yaml")]: PROJECT });
  const result = await discoverProjectRoots(FS_ROOT, io);
  assertEquals(result.primaryRoot, FS_ROOT);
  assertEquals(result.roots, []);
});

Deno.test("discoverProjectRoots: a filesystem root with its own config is served, not scanned", async () => {
  const io = memoryIO({
    [join(FS_ROOT, "project.yaml")]: PROJECT,
    [join(FS_ROOT, "a", "project.yaml")]: PROJECT,
  });
  const result = await discoverProjectRoots(FS_ROOT, io);
  assertEquals(result.roots, [FS_ROOT]);
});

Deno.test("discoverProjectRoots: homeDir with its own config is served, not scanned", async () => {
  const dir = await real(
    await makeTree({ "project.yaml": PROJECT, "a/project.yaml": PROJECT }),
  );
  const result = await discoverProjectRoots(dir, realIO(), { homeDir: dir });
  assertEquals(result.primaryRoot, dir);
  assertEquals(result.roots, [dir]);
});

Deno.test("discoverProjectRoots: a start folder below homeDir walks up to it and does not scan it", async () => {
  const dir = await real(
    await makeTree({
      ".markspec.yaml": "exclude: []\n",
      "docs/x.md": "",
      "b/project.yaml": PROJECT,
    }),
  );
  const result = await discoverProjectRoots(join(dir, "docs"), realIO(), {
    homeDir: dir,
  });
  assertEquals(result.primaryRoot, dir);
  assertEquals(result.roots, [dir]);
});

// ---------------------------------------------------------------------------
// resolveConfigRoot — project.yaml first, else .markspec.yaml (#845)
// ---------------------------------------------------------------------------

/** A reader over an in-memory map of absolute path to content. */
function mapReader(
  files: Record<string, string>,
): (path: string) => Promise<string | undefined> {
  return (path) => Promise.resolve(files[path]);
}

Deno.test("resolveConfigRoot: a project.yaml above wins over a nearer .markspec.yaml", async () => {
  const a = resolve("/a");
  const b = join(a, "b");
  const readFile = mapReader({
    [join(a, "project.yaml")]: PROJECT,
    [join(b, ".markspec.yaml")]: "exclude: []\n",
  });
  assertEquals(await resolveConfigRoot(join(b, "c"), readFile), a);
});

Deno.test("resolveConfigRoot: falls back to the nearest .markspec.yaml", async () => {
  const a = resolve("/a");
  const readFile = mapReader({ [join(a, ".markspec.yaml")]: "exclude: []\n" });
  assertEquals(await resolveConfigRoot(join(a, "b", "c"), readFile), a);
});

Deno.test("resolveConfigRoot: returns undefined when neither file exists", async () => {
  assertEquals(
    await resolveConfigRoot(resolve("/a/b"), mapReader({})),
    undefined,
  );
});

Deno.test("createProjectRootResolver: a config in an excluded folder belongs to the enclosing project", async () => {
  const dir = await real(
    await makeTree({
      ".markspec.yaml": "exclude:\n  - vendor/\n",
      "vendor/.markspec.yaml": "exclude: []\n",
      "vendor/docs/x.md": "",
    }),
  );
  const resolver = createProjectRootResolver(realIO());
  assertEquals(await resolver.ownerOf(join(dir, "vendor", "docs")), dir);
});

Deno.test("createProjectRootResolver: a config in a gitignored or hidden folder belongs to the enclosing project", async () => {
  const dir = await real(
    await makeTree({
      "project.yaml": PROJECT,
      ".gitignore": "ignored/\n",
      "ignored/project.yaml": PROJECT,
      ".hidden/project.yaml": PROJECT,
    }),
  );
  const resolver = createProjectRootResolver(realIO());
  assertEquals(await resolver.ownerOf(join(dir, "ignored")), dir);
  assertEquals(await resolver.ownerOf(join(dir, ".hidden")), dir);
});

Deno.test("createProjectRootResolver: a visible nested project owns its files", async () => {
  const dir = await real(
    await makeTree({
      "project.yaml": PROJECT,
      "sub/project.yaml": PROJECT,
      "sub/docs/x.md": "",
    }),
  );
  const resolver = createProjectRootResolver(realIO());
  assertEquals(
    await resolver.ownerOf(join(dir, "sub", "docs")),
    join(dir, "sub"),
  );
  assertEquals(await resolver.ownerOf(dir), dir);
});

Deno.test("createProjectRootResolver: an intermediate project's exclude applies", async () => {
  const dir = await real(
    await makeTree({
      "project.yaml": PROJECT,
      "mid/.markspec.yaml": "exclude:\n  - deep/\n",
      "mid/project.yaml": PROJECT,
      "mid/deep/project.yaml": PROJECT,
    }),
  );
  const resolver = createProjectRootResolver(realIO());
  assertEquals(
    await resolver.ownerOf(join(dir, "mid", "deep")),
    join(dir, "mid"),
  );
});

Deno.test("createProjectRootResolver: no config above the folder", async () => {
  const dir = await real(await makeTree({ "a/x.md": "" }));
  const resolver = createProjectRootResolver(realIO());
  assertEquals(await resolver.ownerOf(join(dir, "a")), undefined);
});

Deno.test("createProjectRootResolver: the walk up stops below homeDir", async () => {
  const dir = await real(
    await makeTree({
      ".markspec.yaml": "exclude:\n  - a/\n",
      "a/project.yaml": PROJECT,
    }),
  );
  const resolver = createProjectRootResolver(realIO(), { homeDir: dir });
  assertEquals(await resolver.ownerOf(join(dir, "a")), join(dir, "a"));
});

Deno.test("createProjectRootResolver: a config two levels below a hidden folder belongs to the outermost project", async () => {
  const dir = await real(
    await makeTree({
      ".markspec.yaml": "exclude:\n  - a/\n",
      "a/project.yaml": PROJECT,
      "a/b/project.yaml": PROJECT,
    }),
  );
  const resolver = createProjectRootResolver(realIO());
  assertEquals(await resolver.ownerOf(join(dir, "a", "b")), dir);
});
