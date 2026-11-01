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

Deno.test("discovery: inheritGitignoreFrom applies each enclosing .gitignore anchored to its own folder", async () => {
  const dir = await makeTree({
    ".gitignore": "gen/\n/top.md\n",
    // Anchored to `mid/`: ignores `mid/sub/local.md`, not `sub/local.md`
    // relative to the walk root.
    "mid/.gitignore": "/sub/local.md\n*.draft.md\n",
    "mid/sub/a.md": "",
    "mid/sub/b.draft.md": "",
    "mid/sub/gen/x.md": "",
    "mid/sub/local.md": "",
    // `/top.md` is anchored to the enclosing folder, not to `mid/sub`.
    "mid/sub/top.md": "",
  });
  try {
    assertEquals(
      await collect(join(dir, "mid", "sub"), { inheritGitignoreFrom: dir }),
      ["a.md", "top.md"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: without inheritGitignoreFrom no enclosing .gitignore applies", async () => {
  const dir = await makeTree({
    // A repository root above the walk root: git would apply its
    // `.gitignore`; discovery does not, unless asked.
    ".git/HEAD": "ref: refs/heads/main\n",
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

Deno.test("discovery: inheritGitignoreFrom reads no .gitignore above that folder", async () => {
  const dir = await makeTree({
    ".gitignore": "gen/\n",
    "proj/sub/a.md": "",
    "proj/sub/gen/x.md": "",
  });
  try {
    assertEquals(
      await collect(join(dir, "proj", "sub"), {
        inheritGitignoreFrom: join(dir, "proj"),
      }),
      ["a.md", "gen/x.md"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: a deeper enclosing .gitignore overrides a higher one", async () => {
  const dir = await makeTree({
    ".gitignore": "gen/\n",
    "mid/.gitignore": "!gen/\n",
    "mid/sub/gen/x.md": "",
  });
  try {
    assertEquals(
      await collect(join(dir, "mid", "sub"), { inheritGitignoreFrom: dir }),
      ["gen/x.md"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: exclude stays anchored at the walk root under inherited rules", async () => {
  const dir = await makeTree({
    "sub/docs/a.md": "",
    "sub/docs/b.md": "",
    "sub/x/docs/c.md": "",
  });
  try {
    assertEquals(
      await collect(join(dir, "sub"), {
        inheritGitignoreFrom: dir,
        exclude: ["/docs/b.md"],
      }),
      ["docs/a.md", "x/docs/c.md"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: inheritGitignoreFrom works with relative paths", async () => {
  const dir = await makeTree({
    ".gitignore": "/docs/gen/\n",
    "docs/a.md": "",
    "docs/gen/x.md": "",
  });
  const cwd = Deno.cwd();
  Deno.chdir(dir);
  try {
    assertEquals(await collect("docs", { inheritGitignoreFrom: "." }), [
      "a.md",
    ]);
  } finally {
    Deno.chdir(cwd);
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: built-in skips still apply under inherited rules", async () => {
  const dir = await makeTree({
    "sub/a.md": "",
    "sub/node_modules/b.md": "",
  });
  try {
    assertEquals(
      await collect(join(dir, "sub"), { inheritGitignoreFrom: dir }),
      ["a.md"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: inheritGitignoreFrom that is not an ancestor is ignored", async () => {
  const dir = await makeTree({
    "other/.gitignore": "*.md\n",
    "sub/a.md": "",
  });
  try {
    assertEquals(
      await collect(join(dir, "sub"), {
        inheritGitignoreFrom: join(dir, "other"),
      }),
      ["a.md"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: inheritGitignoreFrom below the walk root is ignored", async () => {
  const dir = await makeTree({
    "a.md": "",
    "sub/.gitignore": "*.md\n",
    "sub/b.md": "",
  });
  try {
    // `sub/.gitignore` still applies to `sub/` through the walk itself,
    // but is not inherited for the root's own files.
    assertEquals(
      await collect(dir, { inheritGitignoreFrom: join(dir, "sub") }),
      ["a.md"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
