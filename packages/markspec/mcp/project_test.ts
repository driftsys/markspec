/**
 * @module mcp/project_test
 *
 * Unit tests for the MCP project-context cache.
 *
 * Uses an in-memory ProjectEnv shim so no filesystem access is required.
 */

import { assertEquals, assertExists } from "@std/assert";
import { createProject, type ProjectEnv } from "./project.ts";

/** Build a ProjectEnv that serves a fixed file map. */
function makeEnv(files: Record<string, { content: string; mtime: number }>): {
  env: ProjectEnv;
  bumpMtime: (path: string, content: string, mtime: number) => void;
  removeFile: (path: string) => void;
} {
  const store = new Map(Object.entries(files));
  return {
    env: {
      cwd: () => "/proj",
      readFile: (path) => {
        const f = store.get(path);
        return Promise.resolve(f?.content);
      },
      stat: (path) => {
        const f = store.get(path);
        if (!f) return Promise.reject(new Error(`ENOENT: ${path}`));
        return Promise.resolve({ mtime: f.mtime });
      },
      walk: async function* () {
        for (const path of store.keys()) yield path;
      },
    },
    bumpMtime(path, content, mtime) {
      store.set(path, { content, mtime });
    },
    removeFile(path) {
      store.delete(path);
    },
  };
}

const PROJECT_YAML = `name: test\nversion: 0.0.1\n`;

const REQ_DOC = `- [STK_TEST_0001] Test entry

  Body.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

Deno.test("createProject: discovers root from project.yaml", async () => {
  const { env } = makeEnv({
    "/proj/project.yaml": { content: PROJECT_YAML, mtime: 1 },
    "/proj/req.md": { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  assertEquals(proj.projectRoot, "/proj");
});

Deno.test("createProject: returns null when no project.yaml", async () => {
  const { env } = makeEnv({
    "/proj/req.md": { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  assertEquals(proj.projectRoot, undefined);
});

Deno.test("getCompiled: compiles and caches result", async () => {
  const { env } = makeEnv({
    "/proj/project.yaml": { content: PROJECT_YAML, mtime: 1 },
    "/proj/req.md": { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  const r1 = await proj.getCompiled();
  assertExists(r1);
  assertEquals(r1.entries.size, 1);

  // Second call must return the same object (cached).
  const r2 = await proj.getCompiled();
  assertEquals(r1, r2);
});

Deno.test("getCompiled: recompiles when file mtime changes", async () => {
  const { env, bumpMtime } = makeEnv({
    "/proj/project.yaml": { content: PROJECT_YAML, mtime: 1 },
    "/proj/req.md": { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  const r1 = await proj.getCompiled();
  assertEquals(r1.entries.size, 1);

  // Mutate the file and bump mtime above the compiledAt timestamp.
  const updatedDoc = REQ_DOC + `\n- [STK_TEST_0002] Another

  Body.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;
  bumpMtime("/proj/req.md", updatedDoc, Date.now() + 1000);

  const r2 = await proj.getCompiled();
  assertEquals(r2.entries.size, 2);
});

Deno.test("getCompiled: recompiles when a new file appears", async () => {
  const { env, bumpMtime } = makeEnv({
    "/proj/project.yaml": { content: PROJECT_YAML, mtime: 1 },
    "/proj/req.md": { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  await proj.getCompiled();

  bumpMtime(
    "/proj/extra.md",
    `- [STK_TEST_0002] Another

  Body.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`,
    Date.now() + 1000,
  );

  const r2 = await proj.getCompiled();
  assertEquals(r2.entries.size, 2);
});

Deno.test("forceRefresh: recompiles even with no changes", async () => {
  const { env } = makeEnv({
    "/proj/project.yaml": { content: PROJECT_YAML, mtime: 1 },
    "/proj/req.md": { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  const r1 = await proj.getCompiled();
  const r2 = await proj.forceRefresh();
  // Different object — recompile happened.
  assertEquals(r1 !== r2, true);
});

Deno.test("subscribeInvalidation: fires handlers after recompile", async () => {
  const { env, bumpMtime } = makeEnv({
    "/proj/project.yaml": { content: PROJECT_YAML, mtime: 1 },
    "/proj/req.md": { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  await proj.getCompiled();

  let fired = 0;
  proj.subscribeInvalidation(() => {
    fired++;
  });

  await proj.forceRefresh();
  bumpMtime("/proj/req.md", REQ_DOC + "\n", Date.now() + 2000);
  await proj.getCompiled();

  assertEquals(fired, 2);
});
