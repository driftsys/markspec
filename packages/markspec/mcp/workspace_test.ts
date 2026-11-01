/**
 * @module mcp/workspace_test
 *
 * Unit tests for the multi-project MCP workspace. Uses an in-memory
 * `ProjectEnv` so no filesystem access is required.
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { join, resolve, SEPARATOR } from "@std/path";
import { makeDisplayId } from "../core/mod.ts";
import type { ProjectEnv } from "./project.ts";
import { memoryEnv, stubWorkspace } from "./tools/testing.ts";
import {
  createWorkspace,
  createWorkspaceLoader,
  type McpWorkspace,
} from "./workspace.ts";

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
  const env = memoryEnv(twoProjects());
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
  const env = memoryEnv({
    [join(A, "project.yaml")]: PROJECT_YAML,
    [join(A, "req.md")]: DOC_A,
  }, { cwd: A });
  const ws = await createWorkspace(env);
  assertEquals(ws.startRoot, A);
  assertEquals(labels(ws), ["."]);
});

Deno.test("createWorkspace: a nested project's files belong only to it", async () => {
  const nested = join(A, "sub");
  const env = memoryEnv({
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
  const env = memoryEnv({}, { rootOverrides: [OTHER] });
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
  const env = memoryEnv({
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
  const env = memoryEnv({
    [join(REAL, "a", "project.yaml")]: PROJECT_YAML,
    [join(REAL, "b", "project.yaml")]: PROJECT_YAML,
  }, { cwd: LINK, realPath: toReal });
  const ws = await createWorkspace(env);
  assertEquals(ws.startRoot, REAL);
  assertEquals(labels(ws), ["a", "b"]);
});

Deno.test("createWorkspace: first candidate with a project wins", async () => {
  const OTHER = resolve("/other");
  const env = memoryEnv({
    ...twoProjects(),
    [join(OTHER, "project.yaml")]: PROJECT_YAML,
  }, { rootOverrides: [resolve("/empty"), OTHER] });
  const ws = await createWorkspace(env);
  assertEquals(ws.startRoot, OTHER);
  assertEquals(labels(ws), ["."]);
});

Deno.test("select: all, by label, and the single-project dot", async () => {
  const env = memoryEnv(twoProjects());
  const ws = await createWorkspace(env);
  assertEquals(ws.select(undefined), ws.projects());
  const picked = ws.select("b");
  assertEquals(Array.isArray(picked) ? picked.map((p) => p.label) : picked, [
    "b",
  ]);

  const single = await createWorkspace(
    memoryEnv({ [join(A, "project.yaml")]: PROJECT_YAML }, { cwd: A }),
  );
  assertEquals(single.select("."), single.projects());

  // One project below a folder that is not itself a project.
  const below = await createWorkspace(
    memoryEnv({ [join(A, "project.yaml")]: PROJECT_YAML }),
  );
  assertEquals(labels(below), ["a"]);
  assertEquals(below.select("."), below.projects());
});

Deno.test("select: unknown label lists known labels", async () => {
  const env = memoryEnv(twoProjects());
  const ws = await createWorkspace(env);
  assertEquals(
    ws.select("zzz"),
    'Unknown project "zzz". Known projects: a, b.',
  );
});

Deno.test("rediscover: adds a new project and drops a removed one", async () => {
  const env = memoryEnv(twoProjects());
  const ws = await createWorkspace(env);
  const keptB = ws.projects()[1].project;
  let fired = 0;
  ws.subscribeInvalidation(() => fired++);

  const C = join(PARENT, "c");
  const { store } = env;
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
  const env = memoryEnv({
    [join(A, "project.yaml")]: PROJECT_YAML,
    [join(A, "req.md")]: DOC_A,
    [join(A, "sub", "req.md")]: DOC_B,
  }, { cwd: A });
  const ws = await createWorkspace(env);
  const parent = ws.projects()[0].project;
  const before = await parent.getCompiled();
  assertExists(before.entries.get(makeDisplayId("STK_TEST_0002")));

  env.store.set(join(A, "sub", "project.yaml"), PROJECT_YAML);
  await ws.rediscover();
  assertEquals(labels(ws), [".", "sub"]);
  assertStrictEquals(ws.projects()[0].project, parent);
  // Through getCompiled: the moved files must make the cached graph stale.
  const after = await parent.getCompiled();
  assertEquals(after.entries.get(makeDisplayId("STK_TEST_0002")), undefined);
});

Deno.test("subscribeInvalidation: fires when a project recompiles", async () => {
  const env = memoryEnv(twoProjects());
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
  const env = memoryEnv(twoProjects());
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
  const env = memoryEnv({
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

Deno.test("createWorkspace: no downward scan from the home folder", async () => {
  // The home folder holds its own project and one below it: only the home
  // project is served.
  const env = memoryEnv({
    [join(PARENT, "project.yaml")]: PROJECT_YAML,
    [join(PARENT, "req.md")]: DOC_A,
    [join(B, "project.yaml")]: PROJECT_YAML,
    [join(B, "req.md")]: DOC_B,
  }, { homeDir: PARENT });
  const ws = await createWorkspace(env);
  assertEquals(labels(ws), ["."]);
});

Deno.test("createWorkspace: the home folder is compared after realPath", async () => {
  const LINK = resolve("/home-link");
  const env = memoryEnv(twoProjects(), {
    homeDir: LINK,
    realPath: (p) => p === LINK ? PARENT : p,
  });
  const ws = await createWorkspace(env);
  assertEquals(labels(ws), []);
});

Deno.test("createWorkspace: a candidate folder listed twice is scanned once", async () => {
  const env = memoryEnv({}, { rootOverrides: [PARENT] });
  const listed: string[] = [];
  const countingEnv: ProjectEnv = {
    ...env,
    readDir: (dir) => {
      listed.push(dir);
      return env.readDir(dir);
    },
  };
  const ws = await createWorkspace(countingEnv);
  assertEquals(listed.filter((d) => d === PARENT).length, 1);
  assertExists(ws.softGateMessage);
  // The searched folder is named once in the soft-gate text.
  assertEquals(ws.softGateMessage.split(PARENT).length - 1, 1);
});

// ---------------------------------------------------------------------------
// createWorkspaceLoader: retry after a failed discovery (#855)
// ---------------------------------------------------------------------------

/** A discover function whose attempts the test settles by hand. */
function manualDiscover(): {
  attempts: PromiseWithResolvers<McpWorkspace>[];
  discover: () => Promise<McpWorkspace>;
} {
  const attempts: PromiseWithResolvers<McpWorkspace>[] = [];
  return {
    attempts,
    discover: () => {
      const attempt = Promise.withResolvers<McpWorkspace>();
      attempts.push(attempt);
      return attempt.promise;
    },
  };
}

Deno.test("createWorkspaceLoader: the call after a failed attempt starts a new one and keeps its workspace", async () => {
  const { attempts, discover } = manualDiscover();
  const load = createWorkspaceLoader(discover, () => {});
  const first = load();
  attempts[0].reject(new Error("startup failed"));
  await assertRejects(() => first, Error, "startup failed");
  assertEquals(attempts.length, 1);

  const retry = load();
  assertEquals(attempts.length, 2);
  const workspace = stubWorkspace([], { startRoot: "/work" });
  attempts[1].resolve(workspace);
  assertStrictEquals(await retry, workspace);

  // Later calls use that workspace; no further attempt starts.
  assertStrictEquals(await load(), workspace);
  assertStrictEquals(await load(), workspace);
  assertEquals(attempts.length, 2);
});

Deno.test("createWorkspaceLoader: calls made during one attempt share it", async () => {
  const { attempts, discover } = manualDiscover();
  const load = createWorkspaceLoader(discover, () => {});
  // Two calls during the startup attempt.
  const startupA = load();
  const startupB = load();
  assertEquals(attempts.length, 1);
  attempts[0].reject(new Error("startup failed"));
  await assertRejects(() => startupA, Error, "startup failed");
  await assertRejects(() => startupB, Error, "startup failed");

  // Two calls during the retry.
  const retryA = load();
  const retryB = load();
  assertEquals(attempts.length, 2);
  const workspace = stubWorkspace([], { startRoot: "/work" });
  attempts[1].resolve(workspace);
  assertStrictEquals(await retryA, workspace);
  assertStrictEquals(await retryB, workspace);
  assertEquals(attempts.length, 2);
});

Deno.test("createWorkspaceLoader: a failed retry rejects its callers and the next call retries again", async () => {
  const { attempts, discover } = manualDiscover();
  const load = createWorkspaceLoader(discover, () => {});
  const startup = load();
  attempts[0].reject(new Error("startup failed"));
  await assertRejects(() => startup, Error, "startup failed");

  const waitA = load();
  const waitB = load();
  attempts[1].reject(new Error("retry failed"));
  await assertRejects(() => waitA, Error, "retry failed");
  await assertRejects(() => waitB, Error, "retry failed");
  assertEquals(attempts.length, 2);

  const next = load();
  assertEquals(attempts.length, 3);
  const workspace = stubWorkspace([], { startRoot: "/work" });
  attempts[2].resolve(workspace);
  assertStrictEquals(await next, workspace);
});

Deno.test("createWorkspaceLoader: onReady runs once, for the attempt that succeeds", async () => {
  const { attempts, discover } = manualDiscover();
  const ready: McpWorkspace[] = [];
  const load = createWorkspaceLoader(discover, (w) => ready.push(w));
  const startup = load();
  attempts[0].reject(new Error("startup failed"));
  await assertRejects(() => startup, Error, "startup failed");
  const retry = load();
  attempts[1].reject(new Error("retry failed"));
  await assertRejects(() => retry, Error, "retry failed");
  assertEquals(ready, []);

  const workspace = stubWorkspace([], { startRoot: "/work" });
  const success = load();
  attempts[2].resolve(workspace);
  await success;
  await load();
  await load();
  assertEquals(ready.length, 1);
  assertStrictEquals(ready[0], workspace);
});

Deno.test("createWorkspaceLoader: the call after onReady throws starts a new attempt", async () => {
  const { attempts, discover } = manualDiscover();
  let readyCalls = 0;
  const load = createWorkspaceLoader(discover, () => {
    readyCalls++;
    if (readyCalls === 1) throw new Error("wiring failed");
  });
  const first = load();
  attempts[0].resolve(stubWorkspace([], { startRoot: "/work" }));
  await assertRejects(() => first, Error, "wiring failed");

  const workspace = stubWorkspace([], { startRoot: "/work" });
  const second = load();
  assertEquals(attempts.length, 2);
  attempts[1].resolve(workspace);
  assertStrictEquals(await second, workspace);
});

Deno.test("createWorkspaceLoader: a failed attempt that nobody waits for is not an unhandled rejection", async () => {
  const { attempts, discover } = manualDiscover();
  const load = createWorkspaceLoader(discover, () => {});
  load();
  attempts[0].reject(new Error("startup failed"));
  // Deno fails the test on an unhandled rejection once the event loop runs.
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(attempts.length, 1);
});
