import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { discoverProjectRoots } from "./projects.ts";
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
