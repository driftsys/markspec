import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  discoverFiles,
  FEATURE_EXTENSIONS,
  isDiscoverable,
  MARKDOWN_EXTENSIONS,
  RELEVANT_EXTENSIONS,
  SOURCE_EXTENSIONS,
} from "./mod.ts";
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

Deno.test("discovery: negations cannot re-include hidden directories", async () => {
  const dir = await makeTree({
    ".gitignore": "*\n!*/\n!*.md\n",
    ".worktrees/copy/requirements.md": "",
    "docs/.hidden/requirements.md": "",
    "docs/requirements.md": "",
  });
  try {
    assertEquals(await collect(dir), ["docs/requirements.md"]);
    assertEquals(
      await collect(dir, { exclude: ["!*/", "!.worktrees/", "!.hidden/"] }),
      ["docs/requirements.md"],
    );
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

Deno.test("discovery: exclude overrides conflicting root and nested gitignore rules", async () => {
  const dir = await makeTree({
    ".gitignore": "!secrets/\n!omit.md\n",
    "secrets/a.md": "",
    "omit.md": "",
    "docs/.gitignore": "!secrets/\n!omit.md\n",
    "docs/secrets/b.md": "",
    "docs/omit.md": "",
    "docs/deep/.gitignore": "!secrets/\n!omit.md\n",
    "docs/deep/secrets/c.md": "",
    "docs/deep/omit.md": "",
    "docs/deep/keep.md": "",
  });
  try {
    assertEquals(await collect(dir, { exclude: ["secrets/", "omit.md"] }), [
      "docs/deep/keep.md",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: exclude negations override gitignored and built-in directories at every depth", async () => {
  const dir = await makeTree({
    ".gitignore": "dist/\nvendor/\n.hidden/\n",
    "dist/.gitignore": "*.md\n",
    "dist/keep.md": "",
    "vendor/keep.md": "",
    ".hidden/keep.md": "",
    "docs/.gitignore": "build/\nvendor/\n.hidden/\n",
    "docs/build/.gitignore": "*.md\n",
    "docs/build/keep.md": "",
    "docs/vendor/keep.md": "",
    "docs/.hidden/keep.md": "",
    "docs/deep/.gitignore": "target/\n",
    "docs/deep/target/keep.md": "",
    "node_modules/pkg/skip.md": "",
    ".other/skip.md": "",
  });
  try {
    assertEquals(
      await collect(dir, {
        exclude: [
          "!dist/",
          "!build/",
          "!target/",
          "!vendor/",
          "!.hidden/",
          "!keep.md",
        ],
      }),
      [
        "dist/keep.md",
        "docs/build/keep.md",
        "docs/deep/target/keep.md",
        "docs/vendor/keep.md",
        "vendor/keep.md",
      ],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: ordered exclude rules stay root-anchored after inherited and nested gitignores", async () => {
  const dir = await makeTree({
    ".gitignore": "dist/\n!omit.md\n",
    "sub/.gitignore": "dist/\n!omit.md\n",
    "sub/dist/.gitignore": "*.md\n",
    "sub/dist/keep.md": "",
    "sub/dist/drop.md": "",
    "sub/omit.md": "",
    "sub/docs/omit.md": "",
    "sub/docs/dist/keep.md": "",
  });
  try {
    assertEquals(
      await collect(join(dir, "sub"), {
        inheritGitignoreFrom: dir,
        exclude: ["!/dist/", "/dist/*.md", "!/dist/keep.md", "/omit.md"],
      }),
      ["dist/keep.md", "docs/omit.md"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: file negation cannot re-include a pruned parent directory", async () => {
  const dir = await makeTree({
    ".gitignore": "vendor/\n",
    "vendor/keep.md": "",
    "target/keep.md": "",
  });
  try {
    assertEquals(await collect(dir, { exclude: ["!**/keep.md"] }), []);
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

Deno.test("discoverFiles: finds .feature, honours .gitignore and exclude:", async () => {
  const dir = await makeTree({
    ".gitignore": "ignored/\n",
    "a.md": "",
    "features/login.feature": "",
    "features/UPPER.FEATURE": "",
    "ignored/skip.feature": "",
    "legacy/old.feature": "",
  });
  try {
    assertEquals(
      await collect(dir, { exclude: ["legacy/"] }),
      ["a.md", "features/UPPER.FEATURE", "features/login.feature"],
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("discovery: FEATURE_EXTENSIONS is relevant but not a source extension", () => {
  assertEquals([...FEATURE_EXTENSIONS], [".feature"]);
  assertEquals(RELEVANT_EXTENSIONS.has(".feature"), true);
  assertEquals(SOURCE_EXTENSIONS.has(".feature"), false);
});

/** Every file of `rels` under `dir`: does the predicate agree with the walk? */
async function predicateMatchesWalk(
  dir: string,
  root: string,
  rels: string[],
  opts: Parameters<typeof discoverFiles>[2] = {},
): Promise<Record<string, boolean>> {
  const walked = new Set(await collect(root, opts));
  const out: Record<string, boolean> = {};
  for (const rel of rels) {
    const abs = join(dir, ...rel.split("/"));
    const decided = await isDiscoverable(abs, root, realIO(), opts);
    const base = root.length > dir.length ? root.slice(dir.length + 1) : "";
    const walkRel = base === "" ? rel : rel.slice(base.length + 1);
    assertEquals(decided, walked.has(walkRel), `${rel}: predicate vs walk`);
    out[rel] = decided;
  }
  return out;
}

Deno.test("isDiscoverable: matches the walk for included, ignored, excluded, hidden and wrong-extension files", async () => {
  const dir = await makeTree({
    "ok.md": "",
    "sub/deep.md": "",
    "ignored.md": "",
    "gen/out.md": "",
    "skipped/x.md": "",
    ".hidden/h.md": "",
    "node_modules/m.md": "",
    "notes.txt": "",
    ".gitignore": "ignored.md\ngen/\n",
  });
  const rels = [
    "ok.md",
    "sub/deep.md",
    "ignored.md",
    "gen/out.md",
    "skipped/x.md",
    ".hidden/h.md",
    "node_modules/m.md",
    "notes.txt",
  ];
  const got = await predicateMatchesWalk(dir, dir, rels, {
    exclude: ["skipped/"],
  });
  assertEquals(got, {
    "ok.md": true,
    "sub/deep.md": true,
    "ignored.md": false,
    "gen/out.md": false,
    "skipped/x.md": false,
    ".hidden/h.md": false,
    "node_modules/m.md": false,
    "notes.txt": false,
  });
});

Deno.test("isDiscoverable: a file that does not exist is not discoverable", async () => {
  const dir = await makeTree({ "a.md": "" });
  assertEquals(
    await isDiscoverable(join(dir, "later.md"), dir, realIO()),
    false,
  );
  assertEquals(
    await isDiscoverable(join(dir, "nodir", "x.md"), dir, realIO()),
    false,
  );
});

Deno.test(
  "isDiscoverable: a symbolic link is not discoverable, as in the walk",
  {
    ignore: Deno.build.os === "windows",
  },
  async () => {
    const dir = await makeTree({ "real.md": "", "realdir/in.md": "" });
    await Deno.symlink(join(dir, "real.md"), join(dir, "link.md"));
    await Deno.symlink(join(dir, "realdir"), join(dir, "linkdir"));
    const got = await predicateMatchesWalk(dir, dir, [
      "real.md",
      "link.md",
      "realdir/in.md",
      "linkdir/in.md",
    ]);
    assertEquals(got, {
      "real.md": true,
      "link.md": false,
      "realdir/in.md": true,
      "linkdir/in.md": false,
    });
  },
);

Deno.test("isDiscoverable: negations match the walk", async () => {
  const dir = await makeTree({
    ".gitignore": "ign/\nre/\n",
    "ign/.gitignore": "!keep.md\n",
    "ign/keep.md": "",
    "re/a.md": "",
    "plain.md": "",
  });
  const rels = ["ign/keep.md", "re/a.md", "plain.md"];
  // A deeper `!` cannot re-include a file under an ignored directory.
  assertEquals(await predicateMatchesWalk(dir, dir, rels), {
    "ign/keep.md": false,
    "re/a.md": false,
    "plain.md": true,
  });
  // An `exclude:` negation re-includes the gitignored directory.
  assertEquals(
    await predicateMatchesWalk(dir, dir, rels, { exclude: ["!re/"] }),
    { "ign/keep.md": false, "re/a.md": true, "plain.md": true },
  );
});

Deno.test("isDiscoverable: a path outside the root is not discoverable", async () => {
  const dir = await makeTree({ "a.md": "" });
  const other = await makeTree({ "b.md": "" });
  assertEquals(await isDiscoverable(join(other, "b.md"), dir, realIO()), false);
});

Deno.test("isDiscoverable: inheritGitignoreFrom applies the enclosing .gitignore", async () => {
  const dir = await makeTree({
    ".gitignore": "secret.md\n",
    "mid/sub/secret.md": "",
    "mid/sub/open.md": "",
  });
  const root = join(dir, "mid", "sub");
  const got = await predicateMatchesWalk(
    dir,
    root,
    ["mid/sub/secret.md", "mid/sub/open.md"],
    { inheritGitignoreFrom: dir },
  );
  assertEquals(got, { "mid/sub/secret.md": false, "mid/sub/open.md": true });
  // Without the inheritance the enclosing rule does not apply.
  assertEquals(
    await isDiscoverable(join(root, "secret.md"), root, realIO()),
    true,
  );
});
