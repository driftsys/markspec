/**
 * @module mcp/tools/mod_test
 *
 * Soft-gate dispatch behaviour per ADR-023 §6.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dispatchTool } from "./mod.ts";
import { join } from "@std/path";
import type { Project, ProjectEnv } from "../project.ts";
import { createWorkspace } from "../workspace.ts";
import {
  entryDoc,
  MEMORY_PARENT,
  memoryEnv,
  PROJECT_YAML,
  workspaceOf,
} from "./testing.ts";

function mockProject(detected: boolean): Project {
  return {
    projectRoot: detected ? "/proj" : undefined,
    markspecDetected: detected,
    softGateMessage: "No MarkSpec project found (mock)",
    config: undefined,
    profileChain: null,
    profile: undefined,
    delivers: [],
    getCompiled: () =>
      Promise.reject(new Error("getCompiled must not be called when gated")),
    forceRefresh: () =>
      Promise.reject(new Error("forceRefresh must not be called when gated")),
    subscribeInvalidation: () => () => {},
    readDeliveredDocument: () =>
      Promise.reject(
        new Error("readDeliveredDocument must not be called when gated"),
      ),
  };
}

/** A detected project with an empty compiled graph — for routing smoke tests. */
function emptyDetectedProject(): Project {
  return {
    projectRoot: "/proj",
    markspecDetected: true,
    softGateMessage: "",
    config: undefined,
    profileChain: null,
    profile: undefined,
    delivers: [],
    getCompiled: () =>
      Promise.resolve({
        entries: new Map(),
        links: [],
        forward: new Map(),
        reverse: new Map(),
        diagnostics: [],
        // deno-lint-ignore no-explicit-any
      } as any),
    forceRefresh: () =>
      Promise.reject(new Error("forceRefresh must not be called")),
    subscribeInvalidation: () => () => {},
    readDeliveredDocument: () => Promise.resolve(undefined),
  };
}

Deno.test("dispatchTool: returns soft-gate message when markspecDetected=false", async () => {
  const project = mockProject(false);
  const result = await dispatchTool(
    "entry_search",
    { query: "x" },
    workspaceOf(project),
  );
  assertEquals(result, "No MarkSpec project found (mock)");
});

Deno.test("dispatchTool: gates every tool name (entry_context)", async () => {
  const project = mockProject(false);
  const result = await dispatchTool(
    "entry_context",
    { id: "STK_0001" },
    workspaceOf(project),
  );
  assertStringIncludes(result, "No MarkSpec project found");
});

Deno.test("dispatchTool: gates validate", async () => {
  const project = mockProject(false);
  const result = await dispatchTool("validate", {}, workspaceOf(project));
  assertStringIncludes(result, "No MarkSpec project found");
});

Deno.test("dispatchTool: gates markspec_refresh", async () => {
  const project = mockProject(false);
  const result = await dispatchTool(
    "markspec_refresh",
    {},
    workspaceOf(project),
  );
  assertStringIncludes(result, "No MarkSpec project found");
});

Deno.test("dispatchTool: gates profile_describe", async () => {
  const project = mockProject(false);
  const result = await dispatchTool(
    "profile_describe",
    { name: "Stk" },
    workspaceOf(project),
  );
  assertStringIncludes(result, "No MarkSpec project found");
});

Deno.test("dispatchTool: gates entry_show", async () => {
  const project = mockProject(false);
  const result = await dispatchTool(
    "entry_show",
    { id: "X_0001" },
    workspaceOf(project),
  );
  assertStringIncludes(result, "No MarkSpec project found");
});

Deno.test("dispatchTool: gates entry_list", async () => {
  const project = mockProject(false);
  const result = await dispatchTool("entry_list", {}, workspaceOf(project));
  assertStringIncludes(result, "No MarkSpec project found");
});

Deno.test("dispatchTool: gates entry_neighborhood", async () => {
  const project = mockProject(false);
  const result = await dispatchTool(
    "entry_neighborhood",
    { id: "X_0001" },
    workspaceOf(project),
  );
  assertStringIncludes(result, "No MarkSpec project found");
});

Deno.test("dispatchTool: unknown tool returns error message regardless of gate", async () => {
  const project = mockProject(false);
  let caught: Error | null = null;
  try {
    await dispatchTool("nonexistent", {}, workspaceOf(project));
  } catch (err) {
    caught = err as Error;
  }
  assertEquals(caught?.message.includes("unknown tool"), true);
});

Deno.test("dispatchTool: entry_show routes", async () => {
  const project = emptyDetectedProject();
  const result = await dispatchTool(
    "entry_show",
    { id: "X_0001" },
    workspaceOf(project),
  );
  assertStringIncludes(result, "No entry with display ID X_0001");
});

Deno.test("dispatchTool: entry_list routes (summary default)", async () => {
  const result = await dispatchTool(
    "entry_list",
    {},
    workspaceOf(emptyDetectedProject()),
  );
  assertStringIncludes(result, "Specification overview");
});

Deno.test("dispatchTool: entry_neighborhood routes", async () => {
  const result = await dispatchTool(
    "entry_neighborhood",
    { id: "X_0001" },
    workspaceOf(emptyDetectedProject()),
  );
  assertStringIncludes(result, "No entry with display ID X_0001");
});

Deno.test("dispatchTool: markspec_refresh finds a project added after an empty start", async () => {
  const files: Record<string, string> = {
    [join(MEMORY_PARENT, "notes.md")]: "# Notes\n",
  };
  // Each call reads the current `files`, so files added later are seen.
  const env: ProjectEnv = {
    cwd: () => MEMORY_PARENT,
    rootOverrides: () => [],
    readFile: (path) => memoryEnv(files).readFile(path),
    readDir: (path) => memoryEnv(files).readDir(path),
    homeDir: () => undefined,
    realPath: (path) => Promise.resolve(path),
    stat: (path) => memoryEnv(files).stat(path),
    walk: (root) => memoryEnv(files).walk(root),
  };
  const ws = await createWorkspace(env);
  assertEquals(ws.projects().length, 0);
  files[join(MEMORY_PARENT, "a", "project.yaml")] = PROJECT_YAML;
  files[join(MEMORY_PARENT, "a", "req.md")] = entryDoc(
    "STK_0001",
    "Alpha",
    "01HGW2Q8MNP3RSTVWXYZABCDEF",
  );
  const refreshed = await dispatchTool("markspec_refresh", {}, ws);
  assertEquals(refreshed.includes("No MarkSpec project found"), false);
  const list = await dispatchTool("project_list", {}, ws);
  assertStringIncludes(list, join(MEMORY_PARENT, "a"));
});
