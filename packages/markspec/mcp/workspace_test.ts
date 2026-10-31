/**
 * @module mcp/workspace_test
 *
 * Unit tests for the multi-project MCP workspace. Uses an in-memory
 * `ProjectEnv` so no filesystem access is required.
 */

import {
  assertEquals,
  assertExists,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { join, resolve, SEPARATOR } from "@std/path";
import { makeDisplayId } from "../core/mod.ts";
import type { ProjectEnv } from "./project.ts";
import { createWorkspace } from "./workspace.ts";

const PARENT = resolve("/work");
const A = join(PARENT, "a");
const B = join(PARENT, "b");

const PROJECT_YAML = `name: test\nversion: 0.0.1\n`;

/** An entry document with the given display ID and ULID. */
function doc(displayId: string, ulid: string): string {
  return `- [${displayId}] Test entry\n\n  Body.\n\n  Id: ${ulid}\n`;
}

const DOC_A = doc("STK_TEST_0001", "01HGW2Q8MNP3RSTVWXYZABCDEF");
const DOC_B = doc("STK_TEST_0002", "01HGW2Q8MNP3RSTVWXYZABCDEG");

interface EnvOptions {
  readonly cwd?: string;
  readonly rootOverrides?: string[];
  readonly realPath?: (path: string) => string;
}

/**
 * Build a `ProjectEnv` over an in-memory file map. Directories are implied
 * by the file paths. Returns the store so tests can add or remove files.
 */
function makeEnv(
  files: Record<string, string>,
  options: EnvOptions = {},
): { env: ProjectEnv; store: Map<string, string> } {
  const store = new Map(Object.entries(files));
  const under = (dir: string, path: string) =>
    path.startsWith(dir.endsWith(SEPARATOR) ? dir : dir + SEPARATOR);
  const env: ProjectEnv = {
    cwd: () => options.cwd ?? PARENT,
    rootOverrides: () => options.rootOverrides ?? [],
    readFile: (path) => Promise.resolve(store.get(path)),
    readDir: async function* (dir) {
      const seen = new Set<string>();
      for (const path of store.keys()) {
        if (!under(dir, path)) continue;
        const rest = path.slice(dir.length).replace(/^[\\/]/, "");
        const name = rest.split(/[\\/]/)[0];
        if (seen.has(name)) continue;
        seen.add(name);
        const isFile = rest === name;
        yield { name, isFile, isDirectory: !isFile };
      }
    },
    homeDir: () => undefined,
    realPath: (path) => Promise.resolve(options.realPath?.(path) ?? path),
    stat: (path) => {
      if (!store.has(path)) return Promise.reject(new Error(`ENOENT ${path}`));
      return Promise.resolve({ mtime: 1 });
    },
    walk: async function* (root) {
      for (const path of store.keys()) if (under(root, path)) yield path;
    },
  };
  return { env, store };
}

/** Two sibling projects `a` and `b` below `PARENT`. */
function twoProjects(): Record<string, string> {
  return {
    [join(A, "project.yaml")]: PROJECT_YAML,
    [join(A, "req.md")]: DOC_A,
    [join(B, "project.yaml")]: PROJECT_YAML,
    [join(B, "req.md")]: DOC_B,
  };
}

const labels = (ws: { projects(): readonly { label: string }[] }) =>
  ws.projects().map((p) => p.label);

Deno.test("createWorkspace: parent folder with two projects", async () => {
  const { env } = makeEnv(twoProjects());
  const ws = await createWorkspace(env);
  assertEquals(ws.startRoot, PARENT);
  assertEquals(labels(ws), ["a", "b"]);
  assertEquals(ws.softGateMessage, undefined);
  const b = ws.projects()[1].project;
  assertEquals(b.projectRoot, B);
  const result = await b.getCompiled();
  assertExists(result.entries.get(makeDisplayId("STK_TEST_0002")));
  assertEquals(result.entries.get(makeDisplayId("STK_TEST_0001")), undefined);
});

Deno.test('createWorkspace: single project is labeled "."', async () => {
  const { env } = makeEnv({
    [join(A, "project.yaml")]: PROJECT_YAML,
    [join(A, "req.md")]: DOC_A,
  }, { cwd: A });
  const ws = await createWorkspace(env);
  assertEquals(ws.startRoot, A);
  assertEquals(labels(ws), ["."]);
});

Deno.test("createWorkspace: a nested project's files belong only to it", async () => {
  const nested = join(A, "sub");
  const { env } = makeEnv({
    [join(A, "project.yaml")]: PROJECT_YAML,
    [join(A, "req.md")]: DOC_A,
    [join(nested, "project.yaml")]: PROJECT_YAML,
    [join(nested, "req.md")]: DOC_B,
    // A sibling whose name starts with "sub" stays in the parent project.
    [join(A, "sub2", "more.md")]: doc(
      "STK_TEST_0003",
      "01HGW2Q8MNP3RSTVWXYZABCDEH",
    ),
  }, { cwd: A });
  const ws = await createWorkspace(env);
  assertEquals(labels(ws), [".", "sub"]);
  const parent = await ws.projects()[0].project.getCompiled();
  assertExists(parent.entries.get(makeDisplayId("STK_TEST_0001")));
  assertExists(parent.entries.get(makeDisplayId("STK_TEST_0003")));
  assertEquals(parent.entries.get(makeDisplayId("STK_TEST_0002")), undefined);
  assertEquals(ws.ownerOf(join(nested, "req.md"))?.label, "sub");
  assertEquals(ws.ownerOf(join(A, "sub2", "more.md"))?.label, ".");
  assertEquals(ws.ownerOf(resolve("/elsewhere/x.md")), undefined);
});

Deno.test("createWorkspace: no project → softGateMessage set, projects() empty", async () => {
  const OTHER = resolve("/elsewhere");
  const { env } = makeEnv({}, { rootOverrides: [OTHER] });
  const ws = await createWorkspace(env);
  assertEquals(ws.projects(), []);
  assertExists(ws.softGateMessage);
  assertStringIncludes(ws.softGateMessage, "No MarkSpec project found");
  assertStringIncludes(ws.softGateMessage, OTHER);
  assertStringIncludes(ws.softGateMessage, PARENT);
  assertStringIncludes(
    ws.softGateMessage,
    "Also searched below each directory for nested MarkSpec projects.",
  );
});

Deno.test("createWorkspace: one broken project does not hide the others", async () => {
  const { env } = makeEnv({
    ...twoProjects(),
    [join(A, "project.yaml")]: "name: [unclosed\n  : : :\n",
  });
  const ws = await createWorkspace(env);
  assertEquals(labels(ws), ["a", "b"]);
  const result = await ws.projects()[1].project.getCompiled();
  assertExists(result.entries.get(makeDisplayId("STK_TEST_0002")));
});

Deno.test("createWorkspace: labels are computed after realPath", async () => {
  const LINK = resolve("/link");
  const REAL = resolve("/real");
  const toReal = (p: string) => p === LINK ? REAL : p;
  const { env } = makeEnv({
    [join(REAL, "a", "project.yaml")]: PROJECT_YAML,
    [join(REAL, "b", "project.yaml")]: PROJECT_YAML,
  }, { cwd: LINK, realPath: toReal });
  const ws = await createWorkspace(env);
  assertEquals(ws.startRoot, REAL);
  assertEquals(labels(ws), ["a", "b"]);
});

Deno.test("createWorkspace: first candidate with a project wins", async () => {
  const OTHER = resolve("/other");
  const { env } = makeEnv({
    ...twoProjects(),
    [join(OTHER, "project.yaml")]: PROJECT_YAML,
  }, { rootOverrides: [resolve("/empty"), OTHER] });
  const ws = await createWorkspace(env);
  assertEquals(ws.startRoot, OTHER);
  assertEquals(labels(ws), ["."]);
});

Deno.test("select: all, by label, and the single-project dot", async () => {
  const { env } = makeEnv(twoProjects());
  const ws = await createWorkspace(env);
  assertEquals(ws.select(undefined), ws.projects());
  const picked = ws.select("b");
  assertEquals(Array.isArray(picked) ? picked.map((p) => p.label) : picked, [
    "b",
  ]);

  const single = await createWorkspace(
    makeEnv({ [join(A, "project.yaml")]: PROJECT_YAML }, { cwd: A }).env,
  );
  assertEquals(single.select("."), single.projects());

  // One project below a folder that is not itself a project.
  const below = await createWorkspace(
    makeEnv({ [join(A, "project.yaml")]: PROJECT_YAML }).env,
  );
  assertEquals(labels(below), ["a"]);
  assertEquals(below.select("."), below.projects());
});

Deno.test("select: unknown label lists known labels", async () => {
  const { env } = makeEnv(twoProjects());
  const ws = await createWorkspace(env);
  assertEquals(
    ws.select("zzz"),
    'Unknown project "zzz". Known projects: a, b.',
  );
});

Deno.test("rediscover: adds a new project and drops a removed one", async () => {
  const { env, store } = makeEnv(twoProjects());
  const ws = await createWorkspace(env);
  const keptB = ws.projects()[1].project;
  let fired = 0;
  ws.subscribeInvalidation(() => fired++);

  const C = join(PARENT, "c");
  store.delete(join(A, "project.yaml"));
  store.delete(join(A, "req.md"));
  store.set(join(C, "project.yaml"), PROJECT_YAML);
  await ws.rediscover();

  assertEquals(labels(ws), ["b", "c"]);
  // The project for an unchanged root is reused, not reopened.
  assertStrictEquals(ws.projects()[0].project, keptB);
  assertEquals(fired > 0, true);
});

Deno.test("rediscover: a project added below an existing one takes its files", async () => {
  const { env, store } = makeEnv({
    [join(A, "project.yaml")]: PROJECT_YAML,
    [join(A, "req.md")]: DOC_A,
    [join(A, "sub", "req.md")]: DOC_B,
  }, { cwd: A });
  const ws = await createWorkspace(env);
  const parent = ws.projects()[0].project;
  const before = await parent.getCompiled();
  assertExists(before.entries.get(makeDisplayId("STK_TEST_0002")));

  store.set(join(A, "sub", "project.yaml"), PROJECT_YAML);
  await ws.rediscover();
  assertEquals(labels(ws), [".", "sub"]);
  assertStrictEquals(ws.projects()[0].project, parent);
  // Through getCompiled: the moved files must make the cached graph stale.
  const after = await parent.getCompiled();
  assertEquals(after.entries.get(makeDisplayId("STK_TEST_0002")), undefined);
});

Deno.test("subscribeInvalidation: fires when a project recompiles", async () => {
  const { env } = makeEnv(twoProjects());
  const ws = await createWorkspace(env);
  // Compile each project once so only the refresh below counts.
  for (const p of ws.projects()) await p.project.getCompiled();
  let fired = 0;
  const unsubscribe = ws.subscribeInvalidation(() => fired++);
  await ws.projects()[0].project.forceRefresh();
  assertEquals(fired, 1);
  unsubscribe();
  await ws.projects()[0].project.forceRefresh();
  assertEquals(fired, 1);
});

Deno.test("createWorkspace: with several projects, none compiles until used", async () => {
  const { env } = makeEnv(twoProjects());
  const mdReads: string[] = [];
  const countingEnv: ProjectEnv = {
    ...env,
    readFile: (path) => {
      if (path.endsWith(".md")) mdReads.push(path);
      return env.readFile(path);
    },
  };
  const ws = await createWorkspace(countingEnv);
  // Give any background compile the chance to run.
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(mdReads, []);

  await ws.projects()[1].project.getCompiled();
  assertEquals(mdReads.length > 0, true);
  assertEquals(mdReads.every((p) => p.startsWith(B + SEPARATOR)), true);
});

Deno.test("createWorkspace: a lone project starts compiling at once", async () => {
  const { env } = makeEnv({
    [join(A, "project.yaml")]: PROJECT_YAML,
    [join(A, "req.md")]: DOC_A,
  }, { cwd: A });
  const mdReads: string[] = [];
  const countingEnv: ProjectEnv = {
    ...env,
    readFile: (path) => {
      if (path.endsWith(".md")) mdReads.push(path);
      return env.readFile(path);
    },
  };
  const ws = await createWorkspace(countingEnv);
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(mdReads.length > 0, true);
  assertExists(
    (await ws.projects()[0].project.getCompiled()).entries.get(
      makeDisplayId("STK_TEST_0001"),
    ),
  );
});
