# Smoother CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bare `markspec check`/`lint`/`fmt` operate on the whole project with
gitignore-aware file discovery, and `check` becomes the composite gate
(structure + traceability + fmt drift + lockfile + advisory prose lint).

**Architecture:** A new `core/discovery/` module (pure-TS gitignore matcher +
injected-I/O walker) becomes the single file-discovery SSOT, replacing three
ad-hoc walkers (LSP `walkDirectory`, `lock.ts` `walkMarkdown`, the uncommitted
WIP `walkRelevantFiles`). A shared `resolveScope` helper in `cli/helpers.ts`
gives all three verbs identical no-args/dir-expansion semantics. `check` merges
fmt-drift, lockfile-drift, and prose-lint findings into its existing single
diagnostics stream.

**Tech Stack:** Deno/TypeScript, Cliffy CLI, `@std/path`, `@std/assert`. Core
stays Node-compatible (injected I/O, no `Deno.*` in `core/`).

**Spec:** `docs/wip/specs/2026-06-12-cli-smoother-defaults-design.md`

**Spec amendment (agreed during planning):** the built-in skip set is **hidden
directories** (any directory whose name starts with `.`), not just `.git` +
`.markspec`. This matches every existing walker, and covers
`.worktrees`/`.claude` overlay trees that would otherwise produce duplicate-ID
noise. `.gitignore` _files_ are still read; hidden _files_ like `.hidden.md` are
still yielded. Task 12 updates the spec file.

---

## File map

| Path                                                 | Action | Responsibility                                                |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------- |
| `packages/markspec/core/discovery/gitignore.ts`      | Create | gitignore pattern → RegExp compiler + last-match-wins matcher |
| `packages/markspec/core/discovery/gitignore_test.ts` | Create | table-driven matcher unit tests                               |
| `packages/markspec/core/discovery/mod.ts`            | Create | extension SSOTs + `discoverFiles` walker (injected I/O)       |
| `packages/markspec/core/discovery/mod_test.ts`       | Create | walker unit tests against real temp dirs                      |
| `packages/markspec/core/mod.ts`                      | Modify | re-export discovery API                                       |
| `packages/markspec/core/model/mod.ts`                | Modify | `ProjectConfig.exclude` field + default                       |
| `packages/markspec/core/config/mod.ts`               | Modify | parse `exclude:` from project.yaml                            |
| `packages/markspec/core/validator/listing.ts`        | Modify | (Task 0) markdown-only filename trigger                       |
| `packages/markspec/main.ts`                          | Modify | (Task 0) bare invocation prints help                          |
| `packages/markspec/cli/helpers.ts`                   | Modify | `denoDiscoveryIO` + `resolveScope`                            |
| `packages/markspec/cli/commands/check.ts`            | Modify | no-args default + composite gates                             |
| `packages/markspec/cli/commands/fmt.ts`              | Modify | no-args default (markdown-only)                               |
| `packages/markspec/cli/commands/lint.ts`             | Modify | optional paths                                                |
| `packages/markspec/cli/commands/lock.ts`             | Modify | `collectEntries` uses discovery                               |
| `packages/markspec/lsp/server.ts`                    | Modify | `walkDirectory` → discovery                                   |
| `packages/markspec/lsp/context.ts`                   | Modify | extension set imported from core                              |
| `schemas/markspec/v1.json`                           | Modify | allow `exclude` property                                      |
| `project.yaml` (repo root)                           | Modify | `exclude: ["skills/"]`                                        |
| `tests/e2e/check_project_test.ts`                    | Create | bare-check e2e (gates, gitignore, header)                     |
| `tests/e2e/fmt_default_scope_test.ts`                | Create | bare-fmt e2e                                                  |
| `tests/e2e/lint_default_scope_test.ts`               | Create | bare-lint e2e                                                 |
| `tests/e2e/help_test.ts`                             | Modify | (Task 0 + 5) bare-help test, fmt no-args test update          |
| `tests/e2e/validate_test.ts`                         | Modify | (Task 7) check no-args test update                            |
| `tests/e2e/format_test.ts`                           | Modify | (Task 5) fmt no-args test update                              |
| `AGENTS.md`, `docs/guide/commands.md`, spec file     | Modify | (Task 12) docs                                                |

**Note on the main working tree:** the WIP currently sitting uncommitted in the
main checkout (`check --all`, `walkRelevantFiles`) is superseded by this plan.
Task 0 re-creates the two keeper fixes in the worktree from scratch. After this
branch merges, discard the WIP in the main tree
(`git checkout -- packages/ tests/`) — coordinate with the user first.

---

### Task 0: Branch setup + port the two keeper WIP fixes

**Files:**

- Modify: `packages/markspec/core/validator/listing.ts:72-78`
- Modify: `packages/markspec/main.ts:47-50`
- Modify: `tests/e2e/help_test.ts:17`

- [ ] **Step 1: Create worktree** (superpowers:using-git-worktrees), branch
      `feat/cli-smoother-defaults` off `main`. Run `./bootstrap` and verify
      `ls grammars/*.wasm` lists 9 files (copy from main checkout if not:
      `cp <main>/grammars/*.wasm grammars/`).

- [ ] **Step 1b: Bring the working-memory docs into the branch.** The spec and
      this plan are uncommitted in the main checkout — copy and commit them so
      Task 12's spec amendment has a file to edit:

```bash
mkdir -p docs/wip/specs docs/wip/plans
cp <main-checkout>/docs/wip/specs/2026-06-12-cli-smoother-defaults-design.md docs/wip/specs/
cp <main-checkout>/docs/wip/plans/2026-06-12-cli-smoother-defaults.md docs/wip/plans/
git add docs/wip/
git commit -m "docs(repo): add CLI smoother-defaults spec and implementation plan"
```

- [ ] **Step 2: Apply the listing.ts markdown-only fix.** In
      `packages/markspec/core/validator/listing.ts`, replace the `filenameKind`
      body:

```typescript
/** Listing kind implied by a file's basename, or null if not a listing file.
 * Listing documents are markdown-only (spec §2.1) — a `glossary.ts` source
 * file is unrelated source code that happens to share a basename. */
function filenameKind(file: string): ListingKind | null {
  const name = basename(file).toLowerCase();
  if (!name.endsWith(".md")) return null;
  const base = name.replace(/\.md$/, "");
  if (base === "references") return "references";
  if (base === "glossary") return "glossary";
  if (base === "components") return "components";
  // ... (keep the remaining branches exactly as they are)
```

(The original line was
`const base = basename(file).toLowerCase().replace(/\.[^.]+$/, "");` — only the
three lines shown change.)

- [ ] **Step 3: Apply the bare-help fix.** In `packages/markspec/main.ts`, after
      the `.globalOption("-q, --quiet", ...)` line, add:

```typescript
// clig.dev: bare `markspec` with no subcommand prints help instead of
// exiting silently. The `function` form binds `this` to the Command.
.action(function () {
  this.showHelp();
})
```

- [ ] **Step 4: Add the bare-help e2e test.** In `tests/e2e/help_test.ts`, after
      the `"--help prints usage and lists subcommands"` test, insert:

```typescript
Deno.test("no args prints help (clig.dev)", async () => {
  const { code, stdout } = await markspec([]);
  assertEquals(code, 0);
  // Same top-of-output as --help.
  assertStringIncludes(stdout, "markspec");
  assertStringIncludes(stdout, "Commands");
  assertStringIncludes(stdout, "check");
});
```

- [ ] **Step 5: Run the touched tests.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/help_test.ts packages/markspec/core/validator/`
Expected: PASS

- [ ] **Step 6: Commit (two commits).**

```bash
git add packages/markspec/core/validator/listing.ts
git commit -m "fix(core): listing filename trigger only fires for markdown files"
git add packages/markspec/main.ts tests/e2e/help_test.ts
git commit -m "fix(cli): bare markspec prints help instead of exiting silently"
```

---

### Task 1: gitignore pattern matcher

**Files:**

- Create: `packages/markspec/core/discovery/gitignore.ts`
- Test: `packages/markspec/core/discovery/gitignore_test.ts`

- [ ] **Step 1: Write the failing tests.** Create
      `packages/markspec/core/discovery/gitignore_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { isIgnored, parseGitignore } from "./gitignore.ts";

function ignored(
  patterns: string,
  relPath: string,
  isDir = false,
  baseDir = "",
): boolean {
  return isIgnored(relPath, isDir, parseGitignore(patterns, baseDir));
}

Deno.test("gitignore: unanchored name matches at any depth", () => {
  assertEquals(ignored("*.log", "a.log"), true);
  assertEquals(ignored("*.log", "sub/dir/a.log"), true);
  assertEquals(ignored("*.log", "a.md"), false);
});

Deno.test("gitignore: leading slash anchors to the base dir", () => {
  assertEquals(ignored("/vendor", "vendor", true), true);
  assertEquals(ignored("/vendor", "a/vendor", true), false);
});

Deno.test("gitignore: pattern containing a slash is anchored", () => {
  assertEquals(ignored("docs/*.tmp", "docs/a.tmp"), true);
  assertEquals(ignored("docs/*.tmp", "docs/sub/a.tmp"), false);
  assertEquals(ignored("docs/*.tmp", "other/docs/a.tmp"), false);
});

Deno.test("gitignore: trailing slash matches directories only", () => {
  assertEquals(ignored("build/", "build", true), true);
  assertEquals(ignored("build/", "build", false), false);
});

Deno.test("gitignore: negation re-includes, last match wins", () => {
  const rules = parseGitignore("*.log\n!keep.log", "");
  assertEquals(isIgnored("debug.log", false, rules), true);
  assertEquals(isIgnored("keep.log", false, rules), false);
});

Deno.test("gitignore: comments and blank lines are skipped", () => {
  const rules = parseGitignore("# comment\n\n*.tmp\n", "");
  assertEquals(isIgnored("a.tmp", false, rules), true);
  assertEquals(rules.length, 1);
});

Deno.test("gitignore: ** crosses directory boundaries", () => {
  assertEquals(ignored("**/foo", "foo", true), true);
  assertEquals(ignored("**/foo", "a/b/foo", true), true);
  assertEquals(ignored("a/**/b", "a/b", true), true);
  assertEquals(ignored("a/**/b", "a/x/y/b", true), true);
  assertEquals(ignored("a/**/b", "a/b/c", true), false);
});

Deno.test("gitignore: ? matches a single non-slash char", () => {
  assertEquals(ignored("a?.md", "ab.md"), true);
  assertEquals(ignored("a?.md", "a/b.md"), false);
});

Deno.test("gitignore: character classes", () => {
  assertEquals(ignored("[Dd]ebug", "Debug", true), true);
  assertEquals(ignored("[Dd]ebug", "debug", true), true);
  assertEquals(ignored("[Dd]ebug", "rebug", true), false);
});

Deno.test("gitignore: baseDir scopes nested gitignore patterns", () => {
  assertEquals(ignored("*.md", "sub/x.md", false, "sub"), true);
  assertEquals(ignored("*.md", "x.md", false, "sub"), false);
  assertEquals(ignored("/draft.md", "sub/draft.md", false, "sub"), true);
  assertEquals(ignored("/draft.md", "sub/deep/draft.md", false, "sub"), false);
});

Deno.test("gitignore: trailing spaces are stripped", () => {
  assertEquals(ignored("*.tmp   ", "a.tmp"), true);
});
```

- [ ] **Step 2: Run to verify failure.**

Run: `deno test packages/markspec/core/discovery/gitignore_test.ts` Expected:
FAIL — module `./gitignore.ts` not found.

- [ ] **Step 3: Implement.** Create
      `packages/markspec/core/discovery/gitignore.ts`:

```typescript
/**
 * @module core/discovery/gitignore
 *
 * Pure-TypeScript `.gitignore` pattern matcher. Implements the standard
 * semantics the discovery walker needs: `#` comments, `!` negation,
 * trailing-`/` directory-only patterns, leading-`/` and contains-`/`
 * anchoring, `*` / `?` / `[...]` globs, and `**` cross-directory globs.
 * Last matching rule wins.
 *
 * Per git semantics, a file inside an ignored directory cannot be
 * re-included by a negation — the walker enforces this by pruning
 * ignored directories without descending.
 *
 * No I/O, no platform APIs — Node-compatible by construction.
 */

/** One compiled gitignore rule. */
export interface GitignoreRule {
  /** Matches a root-relative POSIX path (no leading slash). */
  readonly regex: RegExp;
  /** `!pattern` — a match un-ignores the path. */
  readonly negated: boolean;
  /** `pattern/` — matches directories only. */
  readonly dirOnly: boolean;
}

const REGEX_SPECIALS = /[.+^${}()|\\]/;

function escapeRegexChar(c: string): string {
  return REGEX_SPECIALS.test(c) ? `\\${c}` : c;
}

/** Translate one gitignore glob (already stripped of `!`, `/` affixes)
 * into a regex source string. */
function globToRegexSource(pattern: string): string {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          re += "(?:[^/]+/)*"; // `**/` — zero or more whole segments
          i += 3;
        } else {
          re += ".*"; // trailing or bare `**`
          i += 2;
        }
      } else {
        re += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (c === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end < 0) {
        re += "\\[";
        i++;
      } else {
        let cls = pattern.slice(i + 1, end);
        if (cls.startsWith("!")) cls = `^${cls.slice(1)}`;
        re += `[${cls}]`;
        i = end + 1;
      }
    } else if (c === "\\" && i + 1 < pattern.length) {
      re += escapeRegexChar(pattern[i + 1]);
      i += 2;
    } else {
      re += escapeRegexChar(c);
      i++;
    }
  }
  return re;
}

/**
 * Parse `.gitignore` content into compiled rules.
 *
 * @param content - Raw file content (LF or CRLF).
 * @param baseDir - Root-relative POSIX dir the `.gitignore` lives in
 *   (`""` for the root one). Patterns only match paths under it.
 */
export function parseGitignore(
  content: string,
  baseDir: string,
): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (const rawLine of content.split("\n")) {
    // Strip CR and unescaped trailing spaces (git semantics).
    const line = rawLine.replace(/\r$/, "").replace(/(?<!\\) +$/, "");
    if (line === "" || line.startsWith("#")) continue;
    let pattern = line;
    let negated = false;
    if (pattern.startsWith("!")) {
      negated = true;
      pattern = pattern.slice(1);
    }
    let dirOnly = false;
    if (pattern.endsWith("/")) {
      dirOnly = true;
      pattern = pattern.slice(0, -1);
    }
    // A separator anywhere in the pattern anchors it to baseDir;
    // otherwise it matches at any depth below baseDir.
    const anchored = pattern.includes("/");
    if (pattern.startsWith("/")) pattern = pattern.slice(1);
    if (pattern === "") continue;
    const prefix = baseDir === "" ? "" : `${baseDir.replace(/[.+^${}()|\\]/g, "\\$&")}/`;
    const depth = anchored ? "" : "(?:.*/)?";
    rules.push({
      regex: new RegExp(`^${prefix}${depth}${globToRegexSource(pattern)}$`),
      negated,
      dirOnly,
    });
  }
  return rules;
}

/**
 * Test a root-relative POSIX path against compiled rules.
 * Last matching rule wins; no match → not ignored.
 *
 * @param isDir - Directory-only rules (`build/`) match only when true.
 */
export function isIgnored(
  relPath: string,
  isDir: boolean,
  rules: readonly GitignoreRule[],
): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.regex.test(relPath)) ignored = !rule.negated;
  }
  return ignored;
}
```

- [ ] **Step 4: Run to verify pass.**

Run: `deno test packages/markspec/core/discovery/gitignore_test.ts` Expected:
PASS (11 tests)

- [ ] **Step 5: Commit.**

```bash
git add packages/markspec/core/discovery/gitignore.ts packages/markspec/core/discovery/gitignore_test.ts
git commit -m "feat(core): gitignore pattern matcher for project discovery"
```

---

### Task 2: discovery walker + extension SSOTs

**Files:**

- Create: `packages/markspec/core/discovery/mod.ts`
- Test: `packages/markspec/core/discovery/mod_test.ts`
- Modify: `packages/markspec/core/mod.ts` (append re-exports)

- [ ] **Step 1: Write the failing tests.** Create
      `packages/markspec/core/discovery/mod_test.ts`. Tests use real temp dirs
      (`Deno.*` is allowed in tests):

```typescript
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { type DiscoveryIO, discoverFiles, MARKDOWN_EXTENSIONS } from "./mod.ts";

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
```

- [ ] **Step 2: Run to verify failure.**

Run:
`deno test --allow-read --allow-write packages/markspec/core/discovery/mod_test.ts`
Expected: FAIL — `./mod.ts` not found.

- [ ] **Step 3: Implement.** Create `packages/markspec/core/discovery/mod.ts`:

```typescript
/**
 * @module core/discovery
 *
 * Gitignore-aware project file discovery — the single walker every
 * MarkSpec surface uses (CLI verbs, LSP indexing, lockfile entry
 * collection). Yields absolute paths of MarkSpec-relevant files under a
 * root, honoring (in precedence order):
 *
 *   1. built-in skips — hidden directories (name starts with `.`)
 *   2. `.gitignore` files (root + nested, standard semantics)
 *   3. caller-supplied `exclude` patterns (gitignore syntax, root-anchored)
 *
 * I/O is injected via {@linkcode DiscoveryIO} so the module stays
 * Node-compatible; entry points supply the Deno implementation.
 */

import { extname, join } from "@std/path";
import { type GitignoreRule, isIgnored, parseGitignore } from "./gitignore.ts";

export { type GitignoreRule, isIgnored, parseGitignore } from "./gitignore.ts";

/**
 * Source-file extensions the parser can extract doc-comment entries
 * from (tree-sitter grammars available). Single SSOT — `lsp/context.ts`
 * imports this set.
 */
export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".rs",
  ".kt",
  ".kts",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".cxx",
  ".hpp",
  ".hxx",
  ".ts",
  ".tsx",
  ".jsx",
  ".js",
  ".mjs",
  ".cjs",
  ".cs",
]);

/** Markdown only — the `fmt` scope (the formatter never rewrites source). */
export const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set([".md"]);

/** Everything MarkSpec-relevant: markdown + source families. */
export const RELEVANT_EXTENSIONS: ReadonlySet<string> = new Set([
  ...MARKDOWN_EXTENSIONS,
  ...SOURCE_EXTENSIONS,
]);

/** One directory entry from {@linkcode DiscoveryIO.readDir}.
 * Structurally compatible with `Deno.DirEntry`. */
export interface DiscoveryDirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

/** Injected filesystem surface for the walker. */
export interface DiscoveryIO {
  readDir(path: string): AsyncIterable<DiscoveryDirEntry>;
  /** Resolves `undefined` when the file does not exist or is unreadable. */
  readFile(path: string): Promise<string | undefined>;
}

/** Options for {@linkcode discoverFiles}. */
export interface DiscoverOptions {
  /** Extension filter; defaults to {@linkcode RELEVANT_EXTENSIONS}. */
  readonly extensions?: ReadonlySet<string>;
  /** Extra gitignore-syntax patterns, anchored at `root` (e.g. from
   * project.yaml `exclude:`). Applied after `.gitignore` rules. */
  readonly exclude?: readonly string[];
}

/**
 * Walk `root` recursively, yielding absolute paths of relevant files.
 * Entries are yielded in sorted order per directory — deterministic
 * output across filesystems. Unreadable directories are skipped.
 */
export async function* discoverFiles(
  root: string,
  io: DiscoveryIO,
  options: DiscoverOptions = {},
): AsyncGenerator<string> {
  const extensions = options.extensions ?? RELEVANT_EXTENSIONS;
  const excludeRules = parseGitignore(
    (options.exclude ?? []).join("\n"),
    "",
  );
  yield* walk(root, "", excludeRules, io, extensions);
}

async function* walk(
  absDir: string,
  relDir: string,
  rules: readonly GitignoreRule[],
  io: DiscoveryIO,
  extensions: ReadonlySet<string>,
): AsyncGenerator<string> {
  // Nested .gitignore rules append after inherited ones — deeper rules
  // win under last-match-wins.
  const raw = await io.readFile(join(absDir, ".gitignore"));
  const active = raw !== undefined && raw.length > 0
    ? [...rules, ...parseGitignore(raw, relDir)]
    : rules;

  const entries: DiscoveryDirEntry[] = [];
  try {
    for await (const e of io.readDir(absDir)) entries.push(e);
  } catch {
    return; // unreadable directory — a project walk must not abort
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name.startsWith(".")) continue; // built-in: hidden dirs
      // Git semantics: paths under an ignored directory cannot be
      // re-included, so pruning here is correct (and fast).
      if (isIgnored(rel, true, active)) continue;
      yield* walk(join(absDir, entry.name), rel, active, io, extensions);
    } else if (entry.isFile) {
      if (!extensions.has(extname(entry.name).toLowerCase())) continue;
      if (isIgnored(rel, false, active)) continue;
      yield join(absDir, entry.name);
    }
  }
}
```

- [ ] **Step 4: Run to verify pass.**

Run: `deno test --allow-read --allow-write packages/markspec/core/discovery/`
Expected: PASS (gitignore + walker tests)

- [ ] **Step 5: Re-export from the library boundary.** In
      `packages/markspec/core/mod.ts`, append at the end of the file:

```typescript
export {
  discoverFiles,
  isIgnored,
  MARKDOWN_EXTENSIONS,
  parseGitignore,
  RELEVANT_EXTENSIONS,
  SOURCE_EXTENSIONS,
} from "./discovery/mod.ts";
export type {
  DiscoverOptions,
  DiscoveryDirEntry,
  DiscoveryIO,
  GitignoreRule,
} from "./discovery/mod.ts";
```

- [ ] **Step 6: Type-check and commit.**

Run: `deno check packages/markspec/main.ts packages/markspec/core/mod.ts`
Expected: clean

```bash
git add packages/markspec/core/discovery/ packages/markspec/core/mod.ts
git commit -m "feat(core): gitignore-aware project file discovery walker"
```

---

### Task 3: `exclude:` in project.yaml

**Files:**

- Modify: `packages/markspec/core/model/mod.ts:592-620` (ProjectConfig +
  default)
- Modify: `packages/markspec/core/config/mod.ts` (parse, mirroring the `labels`
  block at ~line 150)
- Modify: `schemas/markspec/v1.json`
- Test: `packages/markspec/core/config/mod_test.ts` (append; if the file does
  not exist, check for an existing config test file with
  `ls packages/markspec/core/config/` and append there)

- [ ] **Step 1: Write the failing test.** Append to the config test file:

```typescript
Deno.test("loadConfig: parses exclude as string array", async () => {
  const yaml = `name: t\nversion: 0.1.0\nexclude:\n  - "skills/"\n  - "*.gen.md"\n`;
  const result = await loadConfig(
    "/proj",
    (p) => Promise.resolve(p === "/proj/project.yaml" ? yaml : undefined),
  );
  assertEquals(result?.config.exclude, ["skills/", "*.gen.md"]);
});

Deno.test("loadConfig: exclude defaults to empty", async () => {
  const yaml = `name: t\nversion: 0.1.0\n`;
  const result = await loadConfig(
    "/proj",
    (p) => Promise.resolve(p === "/proj/project.yaml" ? yaml : undefined),
  );
  assertEquals(result?.config.exclude, []);
});

Deno.test("loadConfig: non-array exclude is a ConfigError", async () => {
  const yaml = `name: t\nversion: 0.1.0\nexclude: nope\n`;
  let threw = false;
  try {
    await loadConfig(
      "/proj",
      (p) => Promise.resolve(p === "/proj/project.yaml" ? yaml : undefined),
    );
  } catch (err) {
    threw = err instanceof ConfigError;
  }
  assertEquals(threw, true);
});
```

(Match the existing test file's import style for `loadConfig` / `ConfigError` /
`assertEquals` — mirror neighbouring tests. If existing tests show `loadConfig`
reporting errors via a different channel than throwing, mirror that convention
instead for the third test.)

- [ ] **Step 2: Run to verify failure.**

Run: `deno test packages/markspec/core/config/` Expected: FAIL — `exclude`
property missing / type error.

- [ ] **Step 3: Add the model field.** In `packages/markspec/core/model/mod.ts`,
      inside `interface ProjectConfig` after `captionConventions`:

```typescript
/**
 * Gitignore-syntax patterns excluded from project file discovery,
 * anchored at the project root (e.g. `["skills/", "*.gen.md"]`).
 * Applied after `.gitignore` rules by `core/discovery`.
 */
readonly exclude: readonly string[];
```

And in `DEFAULT_PROJECT_CONFIG` add `exclude: [],`.

- [ ] **Step 4: Parse it.** In `packages/markspec/core/config/mod.ts`, after the
      `labels` parsing block (~line 173), add a sibling block:

```typescript
// exclude: optional string[] of gitignore-syntax patterns
let exclude: readonly string[] = DEFAULT_PROJECT_CONFIG.exclude;
if (obj.exclude !== undefined && obj.exclude !== null) {
  if (!Array.isArray(obj.exclude)) {
    errors.push({
      field: "exclude",
      message: `expected array, got ${typeof obj.exclude}`,
      line: findLineNumber(yaml, "exclude"),
    });
  } else {
    const bad = obj.exclude.findIndex(
      (v: unknown) => typeof v !== "string" || v === "",
    );
    if (bad !== -1) {
      errors.push({
        field: `exclude[${bad}]`,
        message: "each exclude pattern must be a non-empty string",
        line: findLineNumber(yaml, "exclude"),
      });
    } else {
      exclude = obj.exclude as string[];
    }
  }
}
```

Then add `exclude,` to the `ProjectConfig` object literal the function returns
(find where `labels`, `parents`, `captionConventions` are assembled).

- [ ] **Step 5: Update the JSON schema.** In `schemas/markspec/v1.json`, add to
      `properties`:

```json
"exclude": {
  "type": "array",
  "description": "Gitignore-syntax patterns excluded from project file discovery, anchored at the project root.",
  "items": { "type": "string", "minLength": 1 }
}
```

- [ ] **Step 6: Run to verify pass, then commit.**

Run:
`deno test packages/markspec/core/config/ && deno check packages/markspec/core/mod.ts`
Expected: PASS / clean

```bash
git add packages/markspec/core/model/mod.ts packages/markspec/core/config/mod.ts packages/markspec/core/config/*_test.ts schemas/markspec/v1.json
git commit -m "feat(core): exclude patterns in project.yaml for file discovery"
```

---

### Task 4: `resolveScope` shared CLI helper

**Files:**

- Modify: `packages/markspec/cli/helpers.ts` (append; the WIP
  `walkRelevantFiles` does not exist on this branch — nothing to remove)

No unit test here — `resolveScope` calls `Deno.exit` and prints; it is covered
by the e2e tests in Tasks 5–7.

- [ ] **Step 1: Implement.** Append to `packages/markspec/cli/helpers.ts`:

```typescript
/** Deno-backed I/O implementation for `core/discovery`. CLI entry
 * points are allowed to use `Deno.*` APIs. */
export function denoDiscoveryIO(): DiscoveryIO {
  return {
    readDir: (path: string) => Deno.readDir(path),
    readFile: async (path: string) => {
      try {
        return await Deno.readTextFile(path);
      } catch {
        return undefined;
      }
    },
  };
}

/** Resolved invocation scope for a file-consuming verb. */
export interface ResolvedScope {
  /** Files to operate on (absolute for discovered, verbatim for explicit). */
  readonly files: string[];
  /** Discovered project root, if any (needed by profile/config loaders). */
  readonly projectRoot: string | undefined;
  /** True when no args were given — the whole-project case. Drives
   * project-wide-only gates (MSL-L006, lockfile drift). */
  readonly projectWide: boolean;
}

/**
 * Shared scope resolution for `check` / `lint` / `fmt`:
 *
 *   - no args  → whole project via gitignore-aware discovery (requires a
 *     discoverable project root; honors project.yaml `exclude:`), with a
 *     one-line scope header on stderr;
 *   - explicit args → files verbatim; directories expand recursively
 *     through the discovery filter. Exact scope, no surprises.
 *
 * Exits 1 (with a hint) when no args are given and no project root is
 * found, when project.yaml is malformed, or when an explicit path does
 * not exist.
 */
export async function resolveScope(
  args: string[],
  opts: {
    /** Header verb, e.g. "checking" / "formatting" / "linting". */
    verb: string;
    /** Extension filter; defaults to RELEVANT_EXTENSIONS. */
    extensions?: ReadonlySet<string>;
    /** Suppress the scope header (set for -q and --format json). */
    quiet?: boolean;
  },
): Promise<ResolvedScope> {
  const {
    discoverFiles,
    discoverProjectRoot,
    loadConfig,
    RELEVANT_EXTENSIONS,
  } = await import("../core/mod.ts");
  const extensions = opts.extensions ?? RELEVANT_EXTENSIONS;
  const io = denoDiscoveryIO();
  const projectRoot = await discoverProjectRoot(Deno.cwd(), readFile);

  if (args.length === 0) {
    if (projectRoot === undefined) {
      console.error(
        "error: no project root found (project.yaml or .markspec.yaml)",
      );
      console.error(`  searched from ${Deno.cwd()} to filesystem root`);
      console.error(
        "  run 'markspec init' to create one, or pass explicit files",
      );
      Deno.exit(1);
    }
    let exclude: readonly string[] = [];
    try {
      const configResult = await loadConfig(projectRoot, readFile);
      if (configResult) exclude = configResult.config.exclude;
    } catch (err) {
      if (err instanceof ConfigError) {
        console.error(`error: ${err.message}`);
        Deno.exit(1);
      }
      // Other errors: discovery proceeds without exclude patterns.
    }
    const files: string[] = [];
    for await (const f of discoverFiles(projectRoot, io, { extensions, exclude })) {
      files.push(f);
    }
    if (!opts.quiet) {
      console.error(`${opts.verb} ${files.length} file(s) under ${projectRoot}`);
    }
    return { files, projectRoot, projectWide: true };
  }

  const files: string[] = [];
  for (const arg of args) {
    let info: Deno.FileInfo;
    try {
      info = await Deno.stat(arg);
    } catch {
      console.error(`error: ${arg}: no such file or directory`);
      Deno.exit(1);
    }
    if (info.isDirectory) {
      for await (const f of discoverFiles(arg, io, { extensions })) {
        files.push(f);
      }
    } else {
      files.push(arg);
    }
  }
  return { files, projectRoot, projectWide: false };
}
```

Add `DiscoveryIO` to the existing static type import at the top of helpers.ts:

```typescript
import type {
  CompileResult,
  DiscoveryIO,
  ProfileChain,
  ReadFile,
} from "../core/mod.ts";
```

(`ConfigError` and `readFile` are already imported/defined in helpers.ts.)

- [ ] **Step 2: Type-check and commit.**

Run: `deno check packages/markspec/main.ts` Expected: clean

```bash
git add packages/markspec/cli/helpers.ts
git commit -m "feat(cli): resolveScope shared project-wide default scope resolution"
```

---

### Task 5: `fmt` defaults to whole-project markdown

**Files:**

- Modify: `packages/markspec/cli/commands/fmt.ts:18-23`
- Modify: `tests/e2e/help_test.ts:41-45` (the `"fmt with no args exits 1"` test)
- Modify: `tests/e2e/format_test.ts:~470-485` (the no-args subprocess test)
- Create: `tests/e2e/fmt_default_scope_test.ts`

- [ ] **Step 1: Write the failing e2e tests.** Create
      `tests/e2e/fmt_default_scope_test.ts`:

```typescript
/**
 * @module tests/e2e/fmt_default_scope_test
 *
 * E2E: bare `markspec fmt` formats every markdown file under the project
 * root (gitignore-aware), never touches source files, and errors with a
 * hint outside a project.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec, markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT_YAML = `name: fmt-scope-e2e\nversion: 0.1.0\n`;

const UNFORMATTED = `# Doc

- [REQ-0001] A requirement

  The system shall respond within 200 ms.

    Labels: x
`;

Deno.test("fmt: bare invocation formats project markdown", async () => {
  const run = await markspecPersist(["fmt"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "docs/a.md": UNFORMATTED,
      ".gitignore": "ignored/\n",
      "ignored/b.md": UNFORMATTED,
    },
  });
  try {
    assertEquals(run.code, 0, `stderr: ${run.stderr}`);
    // Scope header announces the project-wide default.
    assertStringIncludes(run.stderr, "file(s) under");
    // The tracked file was stamped (Id: added by the formatter)...
    const formatted = await Deno.readTextFile(`${run.dir}/docs/a.md`);
    assertStringIncludes(formatted, "Id: ");
    // ...the gitignored file was not touched.
    const ignored = await Deno.readTextFile(`${run.dir}/ignored/b.md`);
    assertEquals(ignored, UNFORMATTED);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("fmt: bare invocation outside a project errors with hint", async () => {
  const { code, stderr } = await markspec(["fmt"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no project root found");
  assertStringIncludes(stderr, "markspec init");
});

Deno.test("fmt: directory argument expands to markdown inside it", async () => {
  const run = await markspecPersist(["fmt", "docs"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "docs/a.md": UNFORMATTED,
      "other/b.md": UNFORMATTED,
    },
  });
  try {
    assertEquals(run.code, 0, `stderr: ${run.stderr}`);
    const inside = await Deno.readTextFile(`${run.dir}/docs/a.md`);
    assertStringIncludes(inside, "Id: ");
    // Outside the named directory: untouched.
    const outside = await Deno.readTextFile(`${run.dir}/other/b.md`);
    assertEquals(outside, UNFORMATTED);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
```

- [ ] **Step 2: Update the two stale no-args tests.**

In `tests/e2e/help_test.ts`, replace the `"fmt with no args exits 1"` test:

```typescript
Deno.test("fmt with no args outside a project exits 1 with hint", async () => {
  const { code, stderr } = await markspec(["fmt"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no project root found");
});
```

In `tests/e2e/format_test.ts`, find the test near line 470-485 asserting
`"no files specified"` (it spawns `Deno.Command` directly in an empty temp dir)
and change its assertion to:

```typescript
assertStringIncludes(stderr, "no project root found");
```

- [ ] **Step 3: Run to verify failure.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/fmt_default_scope_test.ts`
Expected: FAIL — fmt still errors "no files specified".

- [ ] **Step 4: Implement.** In `packages/markspec/cli/commands/fmt.ts`:

Replace the top of the action (the `no files specified` block):

```typescript
.arguments("[...files:string]")
.action(
  async (
    options: { check?: boolean; quiet?: boolean },
    ...fileArgs: string[]
  ) => {
    const { MARKDOWN_EXTENSIONS } = await import("../../core/mod.ts");
    const scope = await resolveScope(fileArgs, {
      verb: options.check ? "checking format of" : "formatting",
      extensions: MARKDOWN_EXTENSIONS,
      quiet: options.quiet === true,
    });
    const files = scope.files;
```

Update the helpers import at the top of the file:

```typescript
import { loadActiveProfile, readFile, resolveScope } from "../helpers.ts";
```

The rest of the action body already iterates `files` — it keeps working
unchanged (the local `const files` replaces the rest-parameter binding; rename
the rest parameter to `fileArgs` as shown so there is no shadowing).

- [ ] **Step 5: Run to verify pass.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/fmt_default_scope_test.ts tests/e2e/format_test.ts tests/e2e/help_test.ts`
Expected: PASS

- [ ] **Step 6: Commit.**

```bash
git add packages/markspec/cli/commands/fmt.ts tests/e2e/fmt_default_scope_test.ts tests/e2e/format_test.ts tests/e2e/help_test.ts
git commit -m "feat(cli): markspec fmt defaults to whole-project markdown scope"
```

---

### Task 6: `lint` paths become optional

**Files:**

- Modify: `packages/markspec/cli/commands/lint.ts:21-30`
- Create: `tests/e2e/lint_default_scope_test.ts`

- [ ] **Step 1: Write the failing e2e test.** Create
      `tests/e2e/lint_default_scope_test.ts`:

```typescript
/**
 * @module tests/e2e/lint_default_scope_test
 *
 * E2E: bare `markspec lint` lints every relevant file under the project
 * root (gitignore-aware).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: lint-scope-e2e\nversion: 0.1.0\n`;

// "as appropriate" is an INCOSE vague-term finding (MSL-Q3xx warning).
const VAGUE = `# Doc

- [REQ-0001] A requirement

  The system shall respond as appropriate.

      Id: 01REQ000000000000000000001
`;

Deno.test("lint: bare invocation lints the whole project", async () => {
  const { code, stderr } = await markspec(["lint"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "docs/req.md": VAGUE,
      ".gitignore": "drafts/\n",
      "drafts/ignored.md": VAGUE,
    },
  });
  // Warning-only run exits 2; the finding comes from the tracked file
  // and the gitignored copy contributes nothing.
  assertEquals(code, 2, `stderr: ${stderr}`);
  assertStringIncludes(stderr, "docs/req.md");
  assertEquals(stderr.includes("drafts/ignored.md"), false);
});

Deno.test("lint: bare invocation outside a project errors with hint", async () => {
  const { code, stderr } = await markspec(["lint"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no project root found");
});
```

(If `as appropriate` turns out not to trigger any MSL-Q rule, check
`packages/markspec/core/lint/` lexicon fixtures for a term that does — e.g. grep
`vague` in `core/lint/` — and adjust the body; the test's structure stays the
same.)

- [ ] **Step 2: Run to verify failure.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/lint_default_scope_test.ts`
Expected: FAIL — lint usage error (missing required paths).

- [ ] **Step 3: Implement.** In `packages/markspec/cli/commands/lint.ts`:

```typescript
import { compileProject, resolveScope } from "../helpers.ts";
```

```typescript
.arguments("[...paths:string]")
.action(
  async (
    options: { format?: string; strict?: boolean; quiet?: boolean },
    ...paths: string[]
  ) => {
    const scope = await resolveScope(paths, {
      verb: "linting",
      quiet: options.quiet === true || options.format === "json",
    });
    const { result } = await compileProject(scope.files);
```

(Only the arguments declaration, the options type, and the first two action
lines change; the rest of the body stays.)

- [ ] **Step 4: Run to verify pass, then commit.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/lint_default_scope_test.ts`
Expected: PASS

```bash
git add packages/markspec/cli/commands/lint.ts tests/e2e/lint_default_scope_test.ts
git commit -m "feat(cli): markspec lint paths optional, defaults to whole project"
```

---

### Task 7: bare `check` validates the whole project

**Files:**

- Modify: `packages/markspec/cli/commands/check.ts`
- Modify: `tests/e2e/validate_test.ts:~1812` (the `"validate: no files exits 1"`
  test)
- Create: `tests/e2e/check_project_test.ts`

- [ ] **Step 1: Write the failing e2e tests.** Create
      `tests/e2e/check_project_test.ts`:

```typescript
/**
 * @module tests/e2e/check_project_test
 *
 * E2E: bare `markspec check` walks every relevant file under the project
 * root (gitignore-aware) and runs the validator in project-wide mode (so
 * MSL-L006 is meaningful). Explicit file args keep the file-local mode.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: check-project-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/check-project"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
    system-requirement:
      extends: Requirement
      display-id-pattern: "SREQ-{n:04d}"
      traceability:
        Satisfies:
          target: [requirement]
          cardinality: 0..3
          required: false
`;

export const BASE_FILES = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": `profiles:\n  - ./profiles/p\n`,
  "profiles/p/markspec.yaml": PROFILE_YAML,
};

const CLEAN_REQ = `# Requirements

- [REQ-0001] Response time

  The system shall respond within 200 ms.

      Id: 01REQ000000000000000000001
      Type: requirement
`;

Deno.test("check: bare invocation walks project and flips MSL-L006 on", async () => {
  const files = {
    ...BASE_FILES,
    "docs/req.md": CLEAN_REQ,
    "docs/sreq.md": `# System Requirements

- [SREQ-0001] Derived response time

  The system shall forward responses within 100 ms.

      Id: 01SREQ00000000000000000001
      Type: system-requirement
      Satisfies: REQ-9999
`,
  };

  // File-local: MSL-L006 suppressed even when both files are passed.
  const fileLocal = await markspec(
    ["check", "docs/req.md", "docs/sreq.md"],
    { files },
  );
  assertEquals(
    fileLocal.stderr.split("\n").filter((l) => l.includes("MSL-L006")).length,
    0,
    `file-local should not emit MSL-L006; got: ${fileLocal.stderr}`,
  );

  // Bare: project-wide — MSL-L006 fires for the unresolved target.
  const all = await markspec(["check"], { files });
  assertStringIncludes(all.stderr, "MSL-L006");
  assertEquals(all.code, 2); // warnings only
});

Deno.test("check: bare invocation prints scope header, -q suppresses it", async () => {
  const files = { ...BASE_FILES, "docs/req.md": CLEAN_REQ };
  const loud = await markspec(["check"], { files });
  assertStringIncludes(loud.stderr, "file(s) under");
  const quiet = await markspec(["check", "-q"], { files });
  assertEquals(quiet.stderr.includes("file(s) under"), false);
});

Deno.test("check: gitignored files are not validated", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: {
      ...BASE_FILES,
      ".gitignore": "drafts/\n",
      "docs/req.md": CLEAN_REQ,
      // Broken entry that would fail hard if it were scanned.
      "drafts/broken.md": `# Draft\n\n- [REQ-0001] Duplicate id\n\n  Dup.\n\n      Id: 01REQ000000000000000000001\n`,
    },
  });
  assertEquals(code, 0, `expected clean; stderr: ${stderr}`);
});

Deno.test("check: bare invocation without project root errors with hint", async () => {
  const { code, stderr } = await markspec(["check"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no project root found");
  assertStringIncludes(stderr, "markspec init");
});

Deno.test("check: clean project exits 0", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: { ...BASE_FILES, "docs/req.md": CLEAN_REQ },
  });
  assertEquals(code, 0, `expected exit 0; stderr: ${stderr}`);
});
```

- [ ] **Step 2: Update the stale no-args test.** In
      `tests/e2e/validate_test.ts`, replace the `"validate: no files exits 1"`
      test:

```typescript
Deno.test("validate: no files outside a project exits 1 with hint", async () => {
  const { code, stderr } = await markspec(["check"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no project root found");
});
```

- [ ] **Step 3: Run to verify failure.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/check_project_test.ts`
Expected: FAIL — check still errors "no files specified".

- [ ] **Step 4: Implement.** Rewrite the top of
      `packages/markspec/cli/commands/check.ts` (everything from
      `.option("--strict"...)` down to the `loadActiveProfile` call). The full
      new shape:

```typescript
export const checkCmd = new Command()
  .description("Check broken refs, missing Ids, duplicates")
  .option("--strict", "Promote warnings to errors")
  .option(
    "--format <format:string>",
    "Output format (json|text)",
    { default: "text" },
  )
  .arguments("[...files:string]")
  .action(
    async (
      options: { strict?: boolean; format?: string; quiet?: boolean },
      ...fileArgs: string[]
    ) => {
      const scope = await resolveScope(fileArgs, {
        verb: "checking",
        quiet: options.quiet === true || options.format === "json",
      });
      const files = scope.files;
      const projectRoot = scope.projectRoot;

      const { loadConfig } = await import("../../core/mod.ts");

      const chain = projectRoot !== undefined
        ? await loadActiveProfile(projectRoot)
        : null;
```

Changes relative to the current file:

- import `resolveScope` from `../helpers.ts` (alongside the existing imports);
- delete the `--all` option, the mutual-exclusion check, the "no files
  specified" block, the `discoverProjectRoot` call (resolveScope did it), and
  the `--all` walking block;
- the `runPipeline` call's option becomes `{ projectWide: scope.projectWide }`;
- everything else (config load, parse loop, listing validation, strict mapping,
  output, exit codes) stays as-is.

- [ ] **Step 5: Run to verify pass.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/check_project_test.ts tests/e2e/validate_test.ts`
Expected: PASS

- [ ] **Step 6: Commit.**

```bash
git add packages/markspec/cli/commands/check.ts tests/e2e/check_project_test.ts tests/e2e/validate_test.ts
git commit -m "feat(cli): bare markspec check validates the whole project"
```

---

### Task 8: fmt-drift gate in `check` (MSL-F010)

**Files:**

- Modify: `packages/markspec/cli/commands/check.ts` (parse loop + after listing
  validation)
- Modify: `tests/e2e/check_project_test.ts` (append)

- [ ] **Step 1: Write the failing e2e test.** Append to
      `tests/e2e/check_project_test.ts`:

```typescript
Deno.test("check: unformatted file fails the gate with MSL-F010", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: {
      ...BASE_FILES,
      // Missing Id: — `markspec fmt` would stamp it, so this is drift.
      "docs/unformatted.md": `# Doc

- [REQ-0002] Unformatted

  The system shall respond within 200 ms.

      Type: requirement
`,
    },
  });
  assertStringIncludes(stderr, "MSL-F010");
  assertStringIncludes(stderr, "markspec fmt");
  assertEquals(code, 1); // error severity blocks
});

Deno.test("check: formatted project does not emit MSL-F010", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: { ...BASE_FILES, "docs/req.md": CLEAN_REQ },
  });
  assertEquals(stderr.includes("MSL-F010"), false, stderr);
  assertEquals(code, 0, stderr);
});
```

- [ ] **Step 2: Run to verify failure.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/check_project_test.ts`
Expected: FAIL — no MSL-F010 emitted.

- [ ] **Step 3: Implement.** In `check.ts`:

In the parse loop, retain markdown content for the drift pass — add before the
loop:

```typescript
const mdContents = new Map<string, string>();
```

and inside the loop after `content` is read:

```typescript
if (filePath.endsWith(".md")) mdContents.set(filePath, content);
```

After the `validateListingDocuments` call, add the gate:

```typescript
// Gate: fmt drift. Markdown only — `markspec fmt` never rewrites
// source files. format() is the same code path fmt uses, so the
// gate exactly matches what fmt would change.
const { format } = await import("../../core/mod.ts");
const fmtDiagnostics: Diagnostic[] = [];
for (const [filePath, content] of mdContents) {
  if (format(content, { file: filePath }).changed) {
    fmtDiagnostics.push({
      code: "MSL-F010",
      severity: "error",
      message: "file is not formatted (run `markspec fmt`)",
      location: { file: filePath, line: 1, column: 1 },
    });
  }
}
```

and include it in the merge:

```typescript
const allDiagnostics = [
  ...parseDiagnostics,
  ...result.diagnostics,
  ...listingDiagnostics,
  ...fmtDiagnostics,
];
```

- [ ] **Step 4: Run to verify pass, then commit.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/check_project_test.ts`
Expected: PASS

```bash
git add packages/markspec/cli/commands/check.ts tests/e2e/check_project_test.ts
git commit -m "feat(cli): MSL-F010 fmt-drift gate in markspec check"
```

---

### Task 9: offline lockfile gate in `check`

**Files:**

- Modify: `packages/markspec/cli/commands/check.ts`
- Modify: `tests/e2e/check_project_test.ts` (append)

The gate is **offline by design**: it reuses `parseLockfile` (parse errors) and
recomputes the canonical edge hash from the parsed corpus (`extractEdgeQuads` +
`hashCanonicalEdges`) against `lockfile.generatedCache.edgesHash` — the same
MSL-L212 category `markspec lock --check` reports, without the network-touching
upstream resolution.

- [ ] **Step 1: Verify the lock primitives are exported.**

Run:
`grep -n "extractEdgeQuads\|hashCanonicalEdges" packages/markspec/core/mod.ts`
Expected: both names present in the lock re-export block. If missing, add them
to that block (they are exported by `core/lock/mod.ts`).

- [ ] **Step 2: Write the failing e2e tests.** Append to
      `tests/e2e/check_project_test.ts` (add `markspecInDir, markspecPersist` to
      the helpers import at the top):

```typescript
Deno.test("check: lockfile edge drift fails with MSL-L212", async () => {
  // 1. Build a project and generate a lockfile that pins its edges.
  const run = await markspecPersist(["lock"], {
    files: {
      ...BASE_FILES,
      "docs/req.md": CLEAN_REQ,
      "docs/sreq.md": `# System Requirements

- [SREQ-0001] Derived response time

  The system shall forward responses within 100 ms.

      Id: 01SREQ00000000000000000001
      Type: system-requirement
      Satisfies: REQ-0001
`,
    },
    permissions: ["--allow-net", "--allow-env", "--allow-run"],
  });
  try {
    assertEquals(run.code, 0, `lock failed: ${run.stderr}`);

    // 2. In-sync project: check passes the lockfile gate.
    const clean = await markspecInDir(run.dir, ["check"]);
    assertEquals(clean.stderr.includes("MSL-L212"), false, clean.stderr);

    // 3. Change the traceability graph without re-locking.
    const sreqPath = `${run.dir}/docs/sreq.md`;
    const content = await Deno.readTextFile(sreqPath);
    await Deno.writeTextFile(
      sreqPath,
      content.replace("Satisfies: REQ-0001", ""),
    );
    const drifted = await markspecInDir(run.dir, ["check"]);
    assertStringIncludes(drifted.stderr, "MSL-L212");
    assertEquals(drifted.code, 1);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("check: malformed lockfile is an error", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: {
      ...BASE_FILES,
      "docs/req.md": CLEAN_REQ,
      "markspec.lock": "this is not toml {{{",
    },
  });
  assertEquals(code, 1, stderr);
});

Deno.test("check: lockfile gate skipped in file-local mode", async () => {
  const { code, stderr } = await markspec(["check", "docs/req.md"], {
    files: {
      ...BASE_FILES,
      "docs/req.md": CLEAN_REQ,
      "markspec.lock": "this is not toml {{{",
    },
  });
  assertEquals(stderr.includes("MSL-L2"), false, stderr);
  assertEquals(code, 0, stderr);
});
```

(If `markspec lock` needs different permissions or a `markspec.lock` cannot be
produced without upstreams, inspect `markspec lock --help` and
`cli/commands/lock.ts` — the project here has no References/registries, so
resolution must not hit the network. If `lock` genuinely cannot run offline in
this fixture, replace step 1 of the first test by hand-building the lockfile:
run `markspec lock` once, read the generated TOML, and inline it as a fixture
string.)

- [ ] **Step 3: Run to verify failure.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/check_project_test.ts`
Expected: the new tests FAIL — no lockfile gate yet.

- [ ] **Step 4: Implement.** In `check.ts`, after the fmt-drift gate block:

```typescript
// Gate: lockfile (project-wide only; needs the full corpus to
// recompute the canonical edge hash). Offline by design — upstream
// resolution (network) stays in `markspec lock --check`.
const lockDiagnostics: Diagnostic[] = [];
if (scope.projectWide && projectRoot !== undefined) {
  const { join } = await import("@std/path");
  const lockRaw = await readFile(join(projectRoot, "markspec.lock"));
  if (lockRaw !== undefined) {
    const { extractEdgeQuads, hashCanonicalEdges, parseLockfile } =
      await import("../../core/mod.ts");
    const parsed = parseLockfile(lockRaw);
    if (!parsed.lockfile) {
      lockDiagnostics.push(...parsed.diagnostics);
    } else {
      const quads = extractEdgeQuads(allEntries);
      const currentHash = await hashCanonicalEdges(quads);
      const cache = parsed.lockfile.generatedCache;
      if (cache.edgesHash !== currentHash) {
        lockDiagnostics.push({
          code: "MSL-L212",
          severity: "error",
          message:
            `traceability edges drifted from markspec.lock: locked ${cache.edgesCount} edge(s), current ${quads.length} (run \`markspec lock\` to refresh)`,
          location: undefined,
        });
      }
    }
  }
}
```

Add `...lockDiagnostics,` to the `allDiagnostics` merge. If `parsed.diagnostics`
entries are not `severity: "error"`, keep them as-is (the malformed-lockfile e2e
asserts exit 1 — verify the parser emits errors; if it emits only warnings, map
them to errors here with a comment citing the gate decision in the spec).

- [ ] **Step 5: Run to verify pass, then commit.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/check_project_test.ts`
Expected: PASS

```bash
git add packages/markspec/cli/commands/check.ts tests/e2e/check_project_test.ts
git commit -m "feat(cli): offline lockfile gate (parse + MSL-L212 edge drift) in check"
```

---

### Task 10: advisory prose-lint gate in `check`

**Files:**

- Modify: `packages/markspec/cli/commands/check.ts`
- Modify: `tests/e2e/check_project_test.ts` (append)

- [ ] **Step 1: Write the failing e2e tests.** Append:

```typescript
Deno.test("check: prose findings are advisory (exit 2)", async () => {
  const { code, stderr } = await markspec(["check"], {
    files: {
      ...BASE_FILES,
      "docs/vague.md": `# Doc

- [REQ-0003] Vague requirement

  The system shall respond as appropriate.

      Id: 01REQ000000000000000000003
      Type: requirement
`,
    },
  });
  assertStringIncludes(stderr, "MSL-Q");
  assertEquals(code, 2, `prose findings must not block; stderr: ${stderr}`);
});

Deno.test("check: --strict promotes prose findings to errors", async () => {
  const { code } = await markspec(["check", "--strict"], {
    files: {
      ...BASE_FILES,
      "docs/vague.md": `# Doc

- [REQ-0003] Vague requirement

  The system shall respond as appropriate.

      Id: 01REQ000000000000000000003
      Type: requirement
`,
    },
  });
  assertEquals(code, 1);
});

Deno.test("check: json output keeps the stable diagnostic schema", async () => {
  const { code, stdout } = await markspec(["check", "--format", "json"], {
    files: {
      ...BASE_FILES,
      "docs/vague.md": `# Doc

- [REQ-0003] Vague requirement

  The system shall respond as appropriate.

      Id: 01REQ000000000000000000003
      Type: requirement
`,
    },
  });
  assertEquals(code, 2);
  const diags = JSON.parse(stdout) as Record<string, unknown>[];
  const q = diags.find((d) => String(d.code).startsWith("MSL-Q"));
  assertEquals(q !== undefined, true, "expected an MSL-Q diagnostic");
  // LintDiagnostic extras must not leak into check's stable JSON schema.
  assertEquals("slug" in q!, false);
  assertEquals("group" in q!, false);
  assertEquals("scoreContribution" in q!, false);
});
```

(Same caveat as Task 6: if `as appropriate` doesn't fire a Q rule, find a term
in `core/lint/` lexicon data that does and use it in all three tests.)

- [ ] **Step 2: Run to verify failure.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/check_project_test.ts`
Expected: new tests FAIL — no MSL-Q output from check.

- [ ] **Step 3: Implement.** In `check.ts`, after the lockfile gate block:

```typescript
// Gate: prose lint (advisory — warnings/info only unless --strict).
// LintDiagnostic carries slug/group/score fields that must not leak
// into check's stable JSON schema — project to plain Diagnostic.
const { runLint } = await import("../../core/mod.ts");
const lintResult = await runLint({ entries: allEntries, readFile });
const proseDiagnostics: Diagnostic[] = lintResult.diagnostics.map(
  (d) => ({
    code: d.code,
    severity: d.severity,
    message: d.message,
    location: d.location,
  }),
);
```

Add `...proseDiagnostics,` to the `allDiagnostics` merge. (`readFile` is the
helpers re-export already imported at the top of check.ts; `runLint`'s
`LintOptions.readFile` accepts the same `(path) => Promise<string | undefined>`
shape — verify against `core/lint` and adapt the property name if it differs.)

- [ ] **Step 4: Run the full check suite, then commit.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/check_project_test.ts tests/e2e/validate_test.ts`
Expected: PASS. If a pre-existing `validate_test.ts` case now exits 2 instead of
0 because its fixture trips a Q rule, that is the designed behavior change —
update that case's expected exit code and note it in the commit body.

```bash
git add packages/markspec/cli/commands/check.ts tests/e2e/check_project_test.ts tests/e2e/validate_test.ts
git commit -m "feat(cli): advisory prose-lint gate in markspec check"
```

---

### Task 11: unify the remaining walkers on `core/discovery`

**Files:**

- Modify: `packages/markspec/lsp/server.ts` (~line 1080, `walkDirectory` + its
  use in `onInitialized`)
- Modify: `packages/markspec/lsp/context.ts:13-32`
- Modify: `packages/markspec/cli/commands/lock.ts:196-225`
- Modify: `project.yaml` (repo root)

- [ ] **Step 1: LSP indexing.** In `packages/markspec/lsp/server.ts`:

Add to the core import block: `discoverFiles`.

In `onInitialized`, replace the discovery loop:

```typescript
// Discover all relevant files (core/discovery: gitignore-aware,
// honors project.yaml `exclude:`).
const files: string[] = [];
const io = { readDir: (p: string) => Deno.readDir(p), readFile };
for await (
  const entry of discoverFiles(projectRoot, io, {
    exclude: _config.exclude,
  })
) {
  files.push(entry);
}
```

Delete the entire `walkDirectory` generator and its `SKIP_DIRS` set (the
`skills` skip moves to this repo's `project.yaml` in Step 4).

- [ ] **Step 2: extension SSOT.** In `packages/markspec/lsp/context.ts`, delete
      the local `SOURCE_EXTENSIONS` set and import it:

```typescript
import { extname } from "@std/path";
import { SOURCE_EXTENSIONS } from "../core/mod.ts";
```

(`isMarkspecFile` / `isSourceFile` bodies stay unchanged.)

- [ ] **Step 3: lock entry collection.** In
      `packages/markspec/cli/commands/lock.ts`, replace `collectEntries`,
      `SKIP_DIRS`, and `walkMarkdown` with:

```typescript
async function collectEntries(root: string) {
  const { discoverFiles } = await import("../../core/mod.ts");
  const { denoDiscoveryIO } = await import("../helpers.ts");
  const out = [];
  for await (const f of discoverFiles(root, denoDiscoveryIO())) {
    const content = await Deno.readTextFile(f);
    const r = await parseFile(content, { file: f });
    out.push(...r.entries);
  }
  return out;
}
```

**Behavior change (intended):** lock previously collected markdown only; it now
includes source-file entries, matching what `check`'s edge-hash gate computes —
the two MUST walk identically or MSL-L212 false-positives. Lockfiles in projects
with source entries need one `markspec lock` refresh after upgrading. Also honor
`exclude:`: if `loadConfig` results are already available at the
`collectEntries` call site in lock.ts, pass `{ exclude: config.exclude }`
through `discoverFiles`'s options — check the call site; `fmt.ts` also calls
`collectEntries` via `./lock.ts` import for its refIndex, which is fine (same
discovery either way).

**Check the parity in check.ts (Task 9 code):** the lockfile gate computes its
hash from `allEntries`, which in bare mode comes from the same `discoverFiles`
walk with the same `exclude` — parity holds. In file-local mode the gate is
skipped — no parity issue.

- [ ] **Step 4: this repo's own exclude.** In the root `project.yaml`, add:

```yaml
exclude:
  - "skills/"
```

(This replaces the LSP's hardcoded `skills` skip — the upskill SSOT contains
example entry blocks that are not real requirements.)

- [ ] **Step 5: Run LSP + lock + full e2e tests.**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/lsp/ tests/e2e/`
Expected: PASS. Lock-related e2e fixtures with source files may show changed
edge counts — if a lock e2e snapshot/assertion fails on edge count, that is the
intended collection change; update the assertion and say so in the commit body.

- [ ] **Step 6: Commit.**

```bash
git add packages/markspec/lsp/server.ts packages/markspec/lsp/context.ts packages/markspec/cli/commands/lock.ts project.yaml
git commit -m "refactor(repo): unify LSP and lock walkers on core/discovery"
```

---

### Task 12: docs, spec amendment, full build

**Files:**

- Modify: `AGENTS.md` (MarkSpec-specific CLI rules section + CLI subcommands
  table)
- Modify: `docs/guide/commands.md`
- Modify: `docs/wip/specs/2026-06-12-cli-smoother-defaults-design.md`

- [ ] **Step 1: AGENTS.md.** In the "MarkSpec-specific CLI rules" section,
      replace the **File-local vs project-wide** bullet with:

```markdown
- **Explicit args = exact scope; bare invocation = announced project scope.**
  `check`, `lint`, and `fmt` with explicit file/directory arguments operate on
  exactly those paths (directories expand through gitignore-aware discovery).
  Invoked bare, they operate on every relevant file under the project root
  (gitignore + project.yaml `exclude:` honored) and announce the scope on
  stderr. Bare invocation outside a project is an error, never a silent cwd
  scan. Artifact-producing commands (`compile`, `export`) still require explicit
  paths/globs.
```

In the CLI subcommands table, update the `check` row's purpose to:

```markdown
| `markspec check [...files]` | `core/validator` + gates | Composite gate:
structure, traceability, listing docs, fmt drift (MSL-F010), offline lockfile
drift (MSL-L212), advisory prose lint. Bare = whole project. |
```

and note in the `fmt` / `lint` rows that bare invocation = whole project.

- [ ] **Step 2: docs/guide/commands.md.** Update the `check`, `fmt`, `lint`
      sections: bare-invocation default, scope header, gitignore + `exclude:`
      discovery, the gate table from the spec (copy the table in §3 of the
      spec), exit codes (0 clean / 1 errors / 2 warnings-only), `--strict`, and
      the `exclude:` project.yaml key with a YAML example. Lead with examples
      per clig.dev:

```markdown
    # the whole project — what you wire into CI and the pre-push hook
    markspec check

    # one file, fast — what editors and per-file hooks run
    markspec check docs/requirements.md

    # a subtree
    markspec check docs/
```

- [ ] **Step 3: Spec amendment.** In
      `docs/wip/specs/2026-06-12-cli-smoother-defaults-design.md` §1, change the
      built-in-skips sentence to: "Skips, in precedence order: built-ins (hidden
      directories — any directory whose name starts with `.`, which covers
      `.git` and `.markspec`) → patterns from `.gitignore` files (root + nested)
      → `exclude:` globs from `project.yaml`."

- [ ] **Step 4: Format + full verification.**

Run: `just fmt && just build && deno fmt --check && dprint check` Expected:
build green (lint + tests + type-check + compile), formatters clean.

- [ ] **Step 5: Commit.**

```bash
git add AGENTS.md docs/guide/commands.md docs/wip/specs/2026-06-12-cli-smoother-defaults-design.md
git commit -m "docs(repo): document project-scope defaults and composite check gate"
```

---

## Self-review notes (already applied)

- **Spec coverage:** D1 → Tasks 4–7; D2/D5 → Tasks 8–10; D3 → Tasks 1–2; D4 →
  Tasks 8–10 exit-code assertions; discovery unification → Task 11; docs/AGENTS
  rule → Task 12; WIP disposition → Task 0 + file-map note.
- **Known judgment calls encoded above:** hidden-dir built-in skip (spec
  amended); lock collection widened to source files for hash parity with the
  check gate; prose-lint fields stripped to keep check's JSON schema stable;
  lockfile gate offline-only.
- **Fixture risk:** the `as appropriate` vague-term trigger in Tasks 6/10 and
  the offline `markspec lock` run in Task 9 are verified-at-execution
  assumptions; both tasks carry explicit fallback instructions.
