import { assertEquals } from "@std/assert";
import { join, resolve, SEPARATOR } from "@std/path";
import type { DiscoveryIO } from "./mod.ts";
import { discoverOwnedFiles, discoverProjectRoots } from "./projects.ts";
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

Deno.test("discoverOwnedFiles: skips files of nested projects, returns nested roots", async () => {
  const dir = await real(
    await makeTree({
      "project.yaml": PROJECT,
      "a.md": "",
      "docs/b.md": "",
      "sub/project.yaml": PROJECT,
      "sub/c.md": "",
      "sub/deep/d.md": "",
    }),
  );
  const result = await discoverOwnedFiles(dir, realIO());
  assertEquals(result.nestedRoots, [join(dir, "sub")]);
  assertEquals(result.files, [join(dir, "a.md"), join(dir, "docs", "b.md")]);
});

Deno.test("discoverOwnedFiles: a nested root's own call owns its subtree", async () => {
  const dir = await real(
    await makeTree({
      "project.yaml": PROJECT,
      "a.md": "",
      "sub/project.yaml": PROJECT,
      "sub/c.md": "",
      "sub/inner/project.yaml": PROJECT,
      "sub/inner/e.md": "",
    }),
  );
  const sub = join(dir, "sub");
  const result = await discoverOwnedFiles(sub, realIO());
  assertEquals(result.nestedRoots, [join(sub, "inner")]);
  assertEquals(result.files, [join(sub, "c.md")]);
});

Deno.test("discoverOwnedFiles: no nested project returns every file", async () => {
  const dir = await real(
    await makeTree({ "project.yaml": PROJECT, "a.md": "", "x/b.md": "" }),
  );
  const result = await discoverOwnedFiles(dir, realIO());
  assertEquals(result.nestedRoots, []);
  assertEquals(result.files, [join(dir, "a.md"), join(dir, "x", "b.md")]);
});

Deno.test("discoverOwnedFiles: exclude patterns apply to the file walk", async () => {
  const dir = await real(
    await makeTree({
      "project.yaml": PROJECT,
      "a.md": "",
      "skip/b.md": "",
      "sub/project.yaml": PROJECT,
      "sub/c.md": "",
    }),
  );
  const result = await discoverOwnedFiles(dir, realIO(), {
    exclude: ["skip/"],
  });
  assertEquals(result.files, [join(dir, "a.md")]);
});
