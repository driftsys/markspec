/**
 * @module mcp/tools/fan_out_test
 *
 * Unit tests for the per-project fan-out helper.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  createWorkspace,
  type McpWorkspace,
  type WorkspaceProject,
} from "../workspace.ts";
import { perProject, projectArgOf } from "./fan_out.ts";
import { dispatchTool } from "./mod.ts";
import { listResourceDescriptors } from "../resources/mod.ts";
import {
  entryDoc,
  MEMORY_PARENT,
  memoryEnv,
  PROJECT_YAML,
  twoProjectFiles,
} from "./testing.ts";

const DOC_A = entryDoc("STK_0001", "Alpha", "01HGW2Q8MNP3RSTVWXYZABCDEF");
const DOC_B = entryDoc("STK_0002", "Beta", "01HGW2Q8MNP3RSTVWXYZABCDEG");

function twoProjects() {
  return createWorkspace(memoryEnv(twoProjectFiles(DOC_A, DOC_B)));
}

function oneProject() {
  return createWorkspace(memoryEnv({
    [join(MEMORY_PARENT, "project.yaml")]: PROJECT_YAML,
    [join(MEMORY_PARENT, "req.md")]: DOC_A,
  }));
}

Deno.test("perProject: single project returns render output unchanged", async () => {
  const ws = await oneProject();
  const text = await perProject(
    ws,
    undefined,
    () => Promise.resolve("Hello.\n"),
    "Nothing.\n",
  );
  assertEquals(text, "Hello.\n");
  const empty = await perProject(
    ws,
    undefined,
    () => Promise.resolve(undefined),
    "Nothing.\n",
  );
  assertEquals(empty, "Nothing.\n");
});

Deno.test("perProject: two projects get headings", async () => {
  const ws = await twoProjects();
  const text = await perProject(
    ws,
    undefined,
    (wp) => Promise.resolve(`Text ${wp.label}.\n`),
    "Nothing.\n",
  );
  assertEquals(
    text,
    "## Project: a\n\nText a.\n\n## Project: b\n\nText b.\n",
  );
});

Deno.test("perProject: empty results are dropped", async () => {
  const ws = await twoProjects();
  const text = await perProject(
    ws,
    undefined,
    (wp) => Promise.resolve(wp.label === "a" ? undefined : "Text b.\n"),
    "Nothing.\n",
  );
  assertEquals(text, "## Project: b\n\nText b.\n");
  const none = await perProject(
    ws,
    undefined,
    () => Promise.resolve(undefined),
    "Nothing.\n",
  );
  assertEquals(none, "Nothing.\n");
});

Deno.test('perProject: project "." equals no argument', async () => {
  const ws = await oneProject();
  const render = () => Promise.resolve("Hello.\n");
  assertEquals(
    await perProject(ws, ".", render, "Nothing.\n"),
    await perProject(ws, undefined, render, "Nothing.\n"),
  );
});

Deno.test("perProject: unknown label returns error", async () => {
  const ws = await twoProjects();
  const text = await perProject(
    ws,
    "zz",
    () => Promise.resolve("Hello.\n"),
    "Nothing.\n",
  );
  assertEquals(text, 'Unknown project "zz". Known projects: a, b.');
});

Deno.test("perProject: project label narrows to one project", async () => {
  const ws = await twoProjects();
  const text = await perProject(
    ws,
    "b",
    (wp) => Promise.resolve(`Text ${wp.label}.\n`),
    "Nothing.\n",
  );
  assertEquals(text, "Text b.\n");
});

/** Two real projects `a` and `b`, where project `b`'s `getCompiled()`
 * rejects. */
async function twoProjectsOneBroken(): Promise<McpWorkspace> {
  const ws = await twoProjects();
  const list: WorkspaceProject[] = ws.projects().map((wp) =>
    wp.label === "b"
      ? {
        label: wp.label,
        project: Object.create(wp.project, {
          getCompiled: {
            value: () => Promise.reject(new Error("disk read failed")),
          },
        }),
      }
      : wp
  );
  return {
    startRoot: ws.startRoot,
    projects: () => list,
    softGateMessage: undefined,
    select(label?: string) {
      if (label === undefined) return list;
      const match = list.filter((p) => p.label === label);
      return match.length > 0 ? match : `Unknown project "${label}".`;
    },
    ownerOf: () => undefined,
    canonicalPath: (path) => Promise.resolve(path),
    rediscover: () => Promise.resolve(),
    subscribeInvalidation: () => () => {},
  };
}

Deno.test("dispatchTool: a failing project gets an error section, the others still answer", async () => {
  const ws = await twoProjectsOneBroken();
  const text = await dispatchTool("entry_search", { query: "Alpha" }, ws);
  assertStringIncludes(text, "## Project: a\n\n");
  assertStringIncludes(text, "STK_0001");
  assertStringIncludes(text, "## Project: b\n\nError: ");
  assertStringIncludes(text, "disk read failed");
});

Deno.test("dispatchTool: with one selected project the error propagates", async () => {
  const ws = await twoProjectsOneBroken();
  await assertRejects(
    () => dispatchTool("entry_search", { query: "Alpha", project: "b" }, ws),
    Error,
    "disk read failed",
  );
});

Deno.test("listResourceDescriptors: a failing project is skipped", async () => {
  const ws = await twoProjectsOneBroken();
  const uris = (await listResourceDescriptors(ws)).map((d) => d.uri);
  assertEquals(uris.includes("markspec://entry/STK_0001"), true);
  assertEquals(uris.includes("markspec://entry/STK_0002"), false);
});

Deno.test("projectArgOf: a null project argument means all projects", () => {
  assertEquals(projectArgOf({ project: null }), undefined);
  assertEquals(projectArgOf({}), undefined);
  assertEquals(projectArgOf({ project: "a" }), "a");
});
