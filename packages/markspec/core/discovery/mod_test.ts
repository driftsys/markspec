import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { discoverFiles, MARKDOWN_EXTENSIONS } from "./mod.ts";
import { makeTree, realIO } from "./test_helpers.ts";

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

Deno.test("discovery: inherits ancestor .gitignore rules up to the .git directory", async () => {
  const dir = await makeTree({
    ".git/HEAD": "ref: refs/heads/main\n",
    ".gitignore": "gen/\n/top.md\n",
    "mid/.gitignore": "*.draft.md\n",
    "mid/sub/a.md": "",
    "mid/sub/b.draft.md": "",
    "mid/sub/gen/x.md": "",
    // `/top.md` is anchored to the repository root, not to `mid/sub`.
    "mid/sub/top.md": "",
  });
  try {
    assertEquals(await collect(join(dir, "mid", "sub")), ["a.md", "top.md"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: a .git file (worktree) also marks the work-tree root", async () => {
  const dir = await makeTree({
    ".git": "gitdir: /elsewhere/.git/worktrees/wt\n",
    ".gitignore": "gen/\n",
    "sub/a.md": "",
    "sub/gen/x.md": "",
  });
  try {
    assertEquals(await collect(join(dir, "sub")), ["a.md"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: inherits no ancestor .gitignore without a .git above", async () => {
  const dir = await makeTree({
    ".gitignore": "gen/\n",
    "sub/a.md": "",
    "sub/gen/x.md": "",
  });
  try {
    assertEquals(await collect(join(dir, "sub")), ["a.md", "gen/x.md"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: a walk root that holds .git inherits nothing from above", async () => {
  const dir = await makeTree({
    ".git/HEAD": "ref: refs/heads/main\n",
    ".gitignore": "gen/\n",
    "sub/.git/HEAD": "ref: refs/heads/main\n",
    "sub/a.md": "",
    "sub/gen/x.md": "",
  });
  try {
    assertEquals(await collect(join(dir, "sub")), ["a.md", "gen/x.md"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: a relative walk root inherits the same ancestor rules", async () => {
  const dir = await makeTree({
    ".git/HEAD": "ref: refs/heads/main\n",
    ".gitignore": "/docs/gen/\n",
    "docs/a.md": "",
    "docs/gen/x.md": "",
  });
  // A one-segment root (`docs`, as in `markspec fmt docs`) has `.` as its
  // dirname, so the walk-up must start from the absolute path.
  const cwd = Deno.cwd();
  Deno.chdir(dir);
  try {
    assertEquals(await collect("docs"), ["a.md"]);
  } finally {
    Deno.chdir(cwd);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: a walk root that an ancestor .gitignore ignores is walked", async () => {
  const dir = await makeTree({
    ".git/HEAD": "ref: refs/heads/main\n",
    ".gitignore": "fixtures/**\n",
    "fixtures/proj/a.md": "",
    "fixtures/proj/b/c.md": "",
  });
  try {
    assertEquals(await collect(join(dir, "fixtures", "proj")), [
      "a.md",
      "b/c.md",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
