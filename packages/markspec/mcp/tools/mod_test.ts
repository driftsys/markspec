/**
 * @module mcp/tools/mod_test
 *
 * Soft-gate dispatch behaviour per ADR-023 §6.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { dispatchTool } from "./mod.ts";
import { join } from "@std/path";
import type { Project, ProjectEnv } from "../project.ts";
import {
  createWorkspace,
  type McpWorkspace,
  type WorkspaceProject,
} from "../workspace.ts";
import { entryUri } from "../uri.ts";
import {
  entryDoc,
  MEMORY_PARENT,
  memoryEnv,
  PROJECT_YAML,
  twoProjectFiles,
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

// ---------------------------------------------------------------------------
// Several projects: a project whose answer is empty gets no section
// ---------------------------------------------------------------------------

/** Two projects: `a` holds STK_0001 "Alpha" and a local profile that
 * declares the `widget-spec` type; `b` holds STK_0002 "Beta" and uses the
 * default profile. */
function twoProjectWorkspace() {
  const files = twoProjectFiles(
    entryDoc("STK_0001", "Alpha", "01HGW2Q8MNP3RSTVWXYZABCDEF"),
    entryDoc("STK_0002", "Beta", "01HGW2Q8MNP3RSTVWXYZABCDEG"),
  );
  files[join(MEMORY_PARENT, "a", ".markspec.yaml")] =
    "profiles:\n  - ./profile\n";
  files[join(MEMORY_PARENT, "a", "profile", "markspec.yaml")] =
    `id: widget-profile
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    widget-spec:
      extends: Requirement
      description: A widget specification
`;
  return createWorkspace(memoryEnv(files));
}

/** Assert `text` has a section for project a and none for project b. */
function onlyProjectA(text: string): void {
  assertStringIncludes(text, "## Project: a");
  assertEquals(text.includes("## Project: b"), false, text);
}

Deno.test("dispatchTool: entry_search lists only the projects with hits", async () => {
  const ws = await twoProjectWorkspace();
  const text = await dispatchTool("entry_search", { query: "Alpha" }, ws);
  assertStringIncludes(text, "(project: a, score");
  assertEquals(text.includes("project: b"), false, text);
  assertEquals(text.includes("## Project:"), false, text);
});

Deno.test("dispatchTool: entry_show drops a project without the entry", async () => {
  const ws = await twoProjectWorkspace();
  onlyProjectA(await dispatchTool("entry_show", { id: "STK_0001" }, ws));
});

Deno.test("dispatchTool: entry_context drops a project without the entry", async () => {
  const ws = await twoProjectWorkspace();
  onlyProjectA(await dispatchTool("entry_context", { id: "STK_0001" }, ws));
});

Deno.test("dispatchTool: entry_neighborhood drops a project without the entry", async () => {
  const ws = await twoProjectWorkspace();
  onlyProjectA(
    await dispatchTool("entry_neighborhood", { id: "STK_0001" }, ws),
  );
});

Deno.test("dispatchTool: profile_describe drops a project whose profile has no match", async () => {
  const ws = await twoProjectWorkspace();
  const text = await dispatchTool(
    "profile_describe",
    { kind: "type", name: "widget-spec" },
    ws,
  );
  onlyProjectA(text);
  assertStringIncludes(text, "A widget specification");
});

Deno.test("dispatchTool: markspec_refresh with a project argument and no project returns the soft gate", async () => {
  const ws = await createWorkspace(memoryEnv({
    [join(MEMORY_PARENT, "notes.md")]: "# Notes\n",
  }));
  const text = await dispatchTool("markspec_refresh", { project: "x" }, ws);
  assertStringIncludes(text, "No MarkSpec project found");
  assertEquals(text.includes("Unknown project"), false);
});

// ---------------------------------------------------------------------------
// entry_search: the limit applies once across all selected projects (#851)
// ---------------------------------------------------------------------------

/** Three projects `a`, `b`, `c`. For the query "brake", the scores are:
 * a: STK_0001 "Brakes" 3; b: STK_0003 "Brake" 5, STK_0004 "Brake pedal" 5;
 * c: STK_0005 "Brake light" 5, STK_0006 "Brakes" 3. */
function threeProjectFiles(): Record<string, string> {
  const doc = (...entries: string[]) => entries.join("\n");
  return {
    [join(MEMORY_PARENT, "a", "project.yaml")]: PROJECT_YAML,
    [join(MEMORY_PARENT, "a", "req.md")]: doc(
      entryDoc("STK_0001", "Brakes", "01HGW2Q8MNP3RSTVWXYZABCDEF"),
      entryDoc("STK_0002", "Wiper", "01HGW2Q8MNP3RSTVWXYZABCDEG"),
    ),
    [join(MEMORY_PARENT, "b", "project.yaml")]: PROJECT_YAML,
    [join(MEMORY_PARENT, "b", "req.md")]: doc(
      entryDoc("STK_0003", "Brake", "01HGW2Q8MNP3RSTVWXYZABCDEH"),
      entryDoc("STK_0004", "Brake pedal", "01HGW2Q8MNP3RSTVWXYZABCDEJ"),
    ),
    [join(MEMORY_PARENT, "c", "project.yaml")]: PROJECT_YAML,
    [join(MEMORY_PARENT, "c", "req.md")]: doc(
      entryDoc("STK_0005", "Brake light", "01HGW2Q8MNP3RSTVWXYZABCDEK"),
      entryDoc("STK_0006", "Brakes", "01HGW2Q8MNP3RSTVWXYZABCDEM"),
    ),
  };
}

/** One rendered search hit line of a several-project answer. */
function hitLine(id: string, title: string, label: string, score: number) {
  return `- [${id}](${
    entryUri(id)
  }) — ${title} (project: ${label}, score ${score})`;
}

/** The number of hit lines in a search answer. */
function hitCount(text: string): number {
  return text.split("\n").filter((line) => line.startsWith("- [")).length;
}

Deno.test("dispatchTool: entry_search limit is the total across three projects", async () => {
  const ws = await createWorkspace(memoryEnv(threeProjectFiles()));
  const text = await dispatchTool(
    "entry_search",
    { query: "brake", limit: 2 },
    ws,
  );
  assertEquals(hitCount(text), 2, text);
  // b's two hits tie at score 5 with c's STK_0005; label order breaks
  // the tie.
  assertEquals(
    text,
    `# Search results for "brake" (2 matches)\n\n${
      hitLine("STK_0003", "Brake", "b", 5)
    }\n${hitLine("STK_0004", "Brake pedal", "b", 5)}\n`,
  );
});

Deno.test("dispatchTool: entry_search ranks hits across projects in one list", async () => {
  const ws = await createWorkspace(memoryEnv(threeProjectFiles()));
  const text = await dispatchTool("entry_search", { query: "brake" }, ws);
  // One list in score order: a's STK_0001 (3) comes after c's STK_0005
  // (5) although a comes first in label order. Grouped output would put
  // a's hit first.
  assertEquals(
    text,
    `# Search results for "brake" (5 matches)\n\n` +
      [
        hitLine("STK_0003", "Brake", "b", 5),
        hitLine("STK_0004", "Brake pedal", "b", 5),
        hitLine("STK_0005", "Brake light", "c", 5),
        hitLine("STK_0001", "Brakes", "a", 3),
        hitLine("STK_0006", "Brakes", "c", 3),
      ].join("\n") + "\n",
  );
  assertEquals(text.includes("## Project:"), false, text);
});

/** Two projects whose tied hits have display IDs that sort opposite to the
 * project labels: `a` holds Z_0001, `b` holds A_0001, both at score 5. */
function reversedIdFiles(): Record<string, string> {
  return {
    [join(MEMORY_PARENT, "a", "project.yaml")]: PROJECT_YAML,
    [join(MEMORY_PARENT, "a", "req.md")]: entryDoc(
      "Z_0001",
      "Brake",
      "01HGW2Q8MNP3RSTVWXYZABCDEF",
    ),
    [join(MEMORY_PARENT, "b", "project.yaml")]: PROJECT_YAML,
    [join(MEMORY_PARENT, "b", "req.md")]: entryDoc(
      "A_0001",
      "Brake",
      "01HGW2Q8MNP3RSTVWXYZABCDEG",
    ),
  };
}

Deno.test("dispatchTool: entry_search ties follow project label order, not display ID order", async () => {
  const ws = await createWorkspace(memoryEnv(reversedIdFiles()));
  const both = await dispatchTool("entry_search", { query: "brake" }, ws);
  assertEquals(
    both,
    `# Search results for "brake" (2 matches)\n\n${
      hitLine("Z_0001", "Brake", "a", 5)
    }\n${hitLine("A_0001", "Brake", "b", 5)}\n`,
  );
  // The limit cuts through the tie: project a's hit stays.
  const one = await dispatchTool(
    "entry_search",
    { query: "brake", limit: 1 },
    ws,
  );
  assertEquals(
    one,
    `# Search results for "brake" (1 match)\n\n${
      hitLine("Z_0001", "Brake", "a", 5)
    }\n`,
  );
});

/** The three-project workspace, with project `b` failing to compile. */
async function threeProjectsBBroken(): Promise<McpWorkspace> {
  const ws = await createWorkspace(memoryEnv(threeProjectFiles()));
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
  return { ...ws, select: () => list };
}

Deno.test("dispatchTool: entry_search lists a failing project after the hits and uses no part of the limit", async () => {
  const text = await dispatchTool(
    "entry_search",
    { query: "brake", limit: 2 },
    await threeProjectsBBroken(),
  );
  // c's STK_0005 (5) wins; a's STK_0001 and c's STK_0006 tie at 3 and the
  // label order keeps a's.
  assertEquals(
    text,
    `# Search results for "brake" (2 matches)\n\n${
      hitLine("STK_0005", "Brake light", "c", 5)
    }\n${hitLine("STK_0001", "Brakes", "a", 3)}\n` +
      "\nErrors:\n\n- Error in project b: disk read failed\n",
  );
});

Deno.test("dispatchTool: entry_search lists two failing projects after the hits and keeps the full limit", async () => {
  const ws = await createWorkspace(memoryEnv(threeProjectFiles()));
  const messages: Record<string, string> = {
    a: "disk read failed",
    c: "parse crashed",
  };
  const list: WorkspaceProject[] = ws.projects().map((wp) =>
    wp.label in messages
      ? {
        label: wp.label,
        project: Object.create(wp.project, {
          getCompiled: {
            value: () => Promise.reject(new Error(messages[wp.label])),
          },
        }),
      }
      : wp
  );
  const text = await dispatchTool(
    "entry_search",
    { query: "brake", limit: 2 },
    { ...ws, select: () => list },
  );
  // Only b answers; both of its hits fit although two projects failed.
  assertEquals(
    text,
    `# Search results for "brake" (2 matches)\n\n${
      hitLine("STK_0003", "Brake", "b", 5)
    }\n${hitLine("STK_0004", "Brake pedal", "b", 5)}\n` +
      "\nErrors:\n\n- Error in project a: disk read failed\n" +
      "- Error in project c: parse crashed\n",
  );
});

Deno.test("dispatchTool: entry_search with no hit and a failing project shows the error", async () => {
  const text = await dispatchTool(
    "entry_search",
    { query: "zzz" },
    await threeProjectsBBroken(),
  );
  assertEquals(
    text,
    "# Search results\n\nNo matches for `zzz`.\n" +
      "\nErrors:\n\n- Error in project b: disk read failed\n",
  );
});

Deno.test("dispatchTool: entry_search with one selected project is unchanged", async () => {
  const ws = await createWorkspace(memoryEnv(threeProjectFiles()));
  const text = await dispatchTool(
    "entry_search",
    { query: "brake", limit: 1, project: "c" },
    ws,
  );
  assertEquals(
    text,
    `# Search results for "brake" (1 match)\n\n- [STK_0005](${
      entryUri("STK_0005")
    }) — Brake light (score 5)\n`,
  );
});

Deno.test("dispatchTool: entry_search with no hit in any project keeps the empty answer", async () => {
  const ws = await createWorkspace(memoryEnv(threeProjectFiles()));
  const text = await dispatchTool("entry_search", { query: "zzz" }, ws);
  assertEquals(text, "# Search results\n\nNo matches for `zzz`.\n");
});
