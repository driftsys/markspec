/**
 * @module mcp/project_test
 *
 * Unit tests for the MCP project-context cache.
 *
 * Uses an in-memory ProjectEnv shim so no filesystem access is required.
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { join, resolve } from "@std/path";
import {
  checkFileStaleness,
  createProject,
  type ProjectEnv,
} from "./project.ts";

/** Platform-native project root used by `makeEnv`'s cwd. */
const PROJ = resolve("/proj");
const PROJECT_YAML_PATH = join(PROJ, "project.yaml");
const REQ_MD_PATH = join(PROJ, "req.md");
const EXTRA_MD_PATH = join(PROJ, "extra.md");

/** Build a ProjectEnv that serves a fixed file map. */
function makeEnv(files: Record<string, { content: string; mtime: number }>): {
  env: ProjectEnv;
  bumpMtime: (path: string, content: string, mtime: number) => void;
  removeFile: (path: string) => void;
} {
  const store = new Map(Object.entries(files));
  return {
    env: {
      cwd: () => PROJ,
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
    [PROJECT_YAML_PATH]: { content: PROJECT_YAML, mtime: 1 },
    [REQ_MD_PATH]: { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  assertEquals(proj.projectRoot, PROJ);
});

Deno.test("createProject: returns null when no project.yaml", async () => {
  const { env } = makeEnv({
    [REQ_MD_PATH]: { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  assertEquals(proj.projectRoot, undefined);
});

Deno.test("getCompiled: compiles and caches result", async () => {
  const { env } = makeEnv({
    [PROJECT_YAML_PATH]: { content: PROJECT_YAML, mtime: 1 },
    [REQ_MD_PATH]: { content: REQ_DOC, mtime: 1 },
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
    [PROJECT_YAML_PATH]: { content: PROJECT_YAML, mtime: 1 },
    [REQ_MD_PATH]: { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  const r1 = await proj.getCompiled();
  assertEquals(r1.entries.size, 1);

  // Mutate the file and bump mtime above the compiledAt timestamp.
  const updatedDoc = REQ_DOC + `\n- [STK_TEST_0002] Another

  Body.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;
  bumpMtime(REQ_MD_PATH, updatedDoc, Date.now() + 1000);

  const r2 = await proj.getCompiled();
  assertEquals(r2.entries.size, 2);
});

Deno.test("getCompiled: recompiles when a new file appears", async () => {
  const { env, bumpMtime } = makeEnv({
    [PROJECT_YAML_PATH]: { content: PROJECT_YAML, mtime: 1 },
    [REQ_MD_PATH]: { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  await proj.getCompiled();

  bumpMtime(
    EXTRA_MD_PATH,
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
    [PROJECT_YAML_PATH]: { content: PROJECT_YAML, mtime: 1 },
    [REQ_MD_PATH]: { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  const r1 = await proj.getCompiled();
  const r2 = await proj.forceRefresh();
  // Different object — recompile happened.
  assertEquals(r1 !== r2, true);
});

Deno.test("getCompiled: recovers from a transient compile error", async () => {
  // Build an env where the first compile fails (walk throws), then the
  // underlying problem clears and a subsequent getCompiled() succeeds.
  // This verifies that runCompile()'s finally resets `inFlight`, so the
  // cache doesn't get jammed into a permanent error state.
  const { env } = makeEnv({
    [PROJECT_YAML_PATH]: { content: PROJECT_YAML, mtime: 1 },
    [REQ_MD_PATH]: { content: REQ_DOC, mtime: 1 },
  });
  let failNextWalk = true;
  const wrappedEnv: ProjectEnv = {
    ...env,
    walk: function (root: string) {
      if (failNextWalk) {
        failNextWalk = false;
        return (async function* () {
          throw new Error("simulated walk failure");
          // deno-lint-ignore no-unreachable
          yield "";
        })();
      }
      return env.walk(root);
    },
  };

  const proj = await createProject(wrappedEnv);

  // First call: the background compile failed, so this should reject with
  // the simulated error.
  await assertRejects(
    () => proj.getCompiled(),
    Error,
    "simulated walk failure",
  );

  // Second call: the in-flight slot must have been reset, so this should
  // start a fresh compile and succeed.
  const result = await proj.getCompiled();
  assertExists(result);
  assertEquals(result.entries.size, 1);
});

Deno.test("subscribeInvalidation: fires handlers after recompile", async () => {
  const { env, bumpMtime } = makeEnv({
    [PROJECT_YAML_PATH]: { content: PROJECT_YAML, mtime: 1 },
    [REQ_MD_PATH]: { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  await proj.getCompiled();

  let fired = 0;
  proj.subscribeInvalidation(() => {
    fired++;
  });

  await proj.forceRefresh();
  bumpMtime(REQ_MD_PATH, REQ_DOC + "\n", Date.now() + 2000);
  await proj.getCompiled();

  assertEquals(fired, 2);
});

// ---------------------------------------------------------------------------
// SHA256 content-hash gate tests
// ---------------------------------------------------------------------------

/** Compute SHA-256 hex using the same Web Crypto global the production code uses. */
async function testSha256(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(buf);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.test("checkFileStaleness: same content, mtime bumped → NOT stale", async () => {
  const storedHash = await testSha256(REQ_DOC);

  const result = await checkFileStaleness(
    1,
    storedHash,
    2, // mtime changed
    () => Promise.resolve(REQ_DOC), // same content
  );
  assertEquals(result, false);
});

Deno.test("checkFileStaleness: different content, mtime bumped → stale", async () => {
  const storedHash = await testSha256(REQ_DOC);

  const result = await checkFileStaleness(
    1,
    storedHash,
    2, // mtime changed
    () => Promise.resolve(REQ_DOC + "\n# extra content"), // different
  );
  assertEquals(result, true);
});

Deno.test("checkFileStaleness: same mtime → NOT stale (fast path, no read)", async () => {
  let readCalled = false;
  const result = await checkFileStaleness(
    1,
    "somehash",
    1, // mtime unchanged
    () => {
      readCalled = true;
      return Promise.resolve(REQ_DOC);
    },
  );
  assertEquals(result, false);
  assertEquals(
    readCalled,
    false,
    "readContent must not be called on mtime fast path",
  );
});

Deno.test("checkFileStaleness: no stored hash → stale", async () => {
  const result = await checkFileStaleness(
    1,
    undefined, // no stored hash (first run / legacy cache)
    2, // mtime changed
    () => Promise.resolve(REQ_DOC),
  );
  assertEquals(result, true);
});

Deno.test("getCompiled: same content, mtime bumped → NOT stale (SHA256 gate)", async () => {
  const { env, bumpMtime } = makeEnv({
    [PROJECT_YAML_PATH]: { content: PROJECT_YAML, mtime: 1 },
    [REQ_MD_PATH]: { content: REQ_DOC, mtime: 1 },
  });
  const proj = await createProject(env);
  const r1 = await proj.getCompiled();
  assertEquals(r1.entries.size, 1);

  // Bump mtime but keep same content (simulates `git checkout` touching mtime).
  bumpMtime(REQ_MD_PATH, REQ_DOC, Date.now() + 1000);

  const r2 = await proj.getCompiled();
  assertEquals(r2.entries.size, 1);
  assertEquals(r2, r1, "cached result returned — no recompile triggered");
});
