import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { discoverFiles, type DiscoveryIO, MARKDOWN_EXTENSIONS } from "./mod.ts";

function realIO(): DiscoveryIO {
  return {
    readDir: (path) => Deno.readDir(path),
    readFile: async (path) => {
      try {
        return await Deno.readTextFile(path);
      } catch {
        return undefined;
      }
    },
  };
}

async function makeTree(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir();
  for (const [name, content] of Object.entries(files)) {
    const parts = name.split("/");
    if (parts.length > 1) {
      await Deno.mkdir(join(dir, ...parts.slice(0, -1)), { recursive: true });
    }
    await Deno.writeTextFile(join(dir, ...parts), content);
  }
  return dir;
}

async function collect(
  root: string,
  opts: Parameters<typeof discoverFiles>[2] = {},
): Promise<string[]> {
  const out: string[] = [];
  for await (const f of discoverFiles(root, realIO(), opts)) {
    out.push(f.slice(root.length + 1).replaceAll("\\", "/"));
  }
  return out;
}

Deno.test("discovery: yields relevant extensions, skips others", async () => {
  const dir = await makeTree({
    "a.md": "",
    "src/b.rs": "",
    "src/c.kt": "",
    "notes.txt": "",
    "image.png": "",
  });
  try {
    assertEquals(await collect(dir), ["a.md", "src/b.rs", "src/c.kt"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: honors root .gitignore", async () => {
  const dir = await makeTree({
    ".gitignore": "vendor/\n*.gen.md\n",
    "a.md": "",
    "a.gen.md": "",
    "vendor/lib.md": "",
  });
  try {
    assertEquals(await collect(dir), ["a.md"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: nested .gitignore scopes to its directory", async () => {
  const dir = await makeTree({
    "docs/.gitignore": "draft.md\n",
    "docs/draft.md": "",
    "docs/real.md": "",
    "draft.md": "",
  });
  try {
    assertEquals(await collect(dir), ["docs/real.md", "draft.md"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: skips hidden directories (built-in)", async () => {
  const dir = await makeTree({
    ".claude/notes.md": "",
    ".worktrees/copy/a.md": "",
    "real.md": "",
  });
  try {
    assertEquals(await collect(dir), ["real.md"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: exclude option uses gitignore syntax", async () => {
  const dir = await makeTree({
    "skills/example.md": "",
    "docs/a.md": "",
  });
  try {
    assertEquals(await collect(dir, { exclude: ["skills/"] }), ["docs/a.md"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: extensions option narrows the set", async () => {
  const dir = await makeTree({ "a.md": "", "b.rs": "" });
  try {
    assertEquals(
      await collect(dir, { extensions: MARKDOWN_EXTENSIONS }),
      ["a.md"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: output is sorted (deterministic)", async () => {
  const dir = await makeTree({ "z.md": "", "a.md": "", "m/x.md": "" });
  try {
    assertEquals(await collect(dir), ["a.md", "m/x.md", "z.md"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: skips common build-output dirs (built-in, no .gitignore)", async () => {
  const dir = await makeTree({
    "real.md": "",
    "node_modules/pkg/a.md": "",
    "target/b.rs": "",
    "dist/c.md": "",
    "build/d.md": "",
    "src/nested/build/e.md": "", // nested build dir also skipped
  });
  try {
    assertEquals(await collect(dir), ["real.md"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: build-output skip is overridable via exclude negation", async () => {
  const dir = await makeTree({ "target/keep.md": "", "real.md": "" });
  try {
    assertEquals(
      await collect(dir, { exclude: ["!target/"] }),
      ["real.md", "target/keep.md"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: build-output skip is overridable via .gitignore negation", async () => {
  const dir = await makeTree({
    ".gitignore": "!build/\n",
    "build/keep.md": "",
    "real.md": "",
  });
  try {
    assertEquals(await collect(dir), ["build/keep.md", "real.md"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: explicitly naming a build dir walks its contents", async () => {
  const dir = await makeTree({
    "target/keep.md": "",
    "target/sub/deep.md": "",
  });
  try {
    // Root the walk *at* the build dir — its own name isn't in the
    // root-relative paths, so the built-in skip does not prune it.
    assertEquals(
      await collect(join(dir, "target")),
      ["keep.md", "sub/deep.md"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
