/**
 * @module mcp/tools/fan_out_test
 *
 * Unit tests for the per-project fan-out helper.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createWorkspace } from "../workspace.ts";
import { perProject } from "./fan_out.ts";
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
