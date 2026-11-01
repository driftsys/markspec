/**
 * @module mcp/server_test
 *
 * Structural assertions on SERVER_INSTRUCTIONS per ADR-023 §4. The text
 * itself is not testable for LLM-behavioural effect — these tests catch
 * accidental regressions to the trigger grammar (TRIGGER / PREFER / SKIP)
 * and the locked vocabulary anchors.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { DeliveredDocument, ProfileChain } from "../core/mod.ts";
import { join, SEPARATOR } from "@std/path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Project, ProjectEnv } from "./project.ts";
import { listResourceDescriptors, readResource } from "./resources/mod.ts";
import {
  compiledEntryIds,
  SERVER_INSTRUCTIONS,
  startServer,
} from "./server.ts";
import {
  entryDoc,
  MEMORY_PARENT,
  memoryEnv,
  PROJECT_YAML,
  stubWorkspace,
  twoProjectFiles,
} from "./tools/testing.ts";
import { deliveredUri, entryUri, PROFILE_URI } from "./uri.ts";
import { createWorkspace } from "./workspace.ts";

Deno.test("SERVER_INSTRUCTIONS: contains TRIGGER block", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "TRIGGER when");
});

Deno.test("SERVER_INSTRUCTIONS: contains PREFER over block", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "PREFER over");
});

Deno.test("SERVER_INSTRUCTIONS: contains SKIP when block", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "SKIP when");
});

Deno.test("SERVER_INSTRUCTIONS: lists the display-ID regex anchor", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "[A-Z]{2,}_[A-Z0-9_]+");
});

Deno.test("SERVER_INSTRUCTIONS: names grep/Read/Glob in PREFER over", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "grep");
  assertStringIncludes(SERVER_INSTRUCTIONS, "Read");
  assertStringIncludes(SERVER_INSTRUCTIONS, "Glob");
});

Deno.test("SERVER_INSTRUCTIONS: references the soft-gate phrase verbatim", () => {
  // SKIP rule keys on this exact phrase — see ADR-023 §6.3.
  assertStringIncludes(SERVER_INSTRUCTIONS, "No MarkSpec project found");
});

Deno.test("SERVER_INSTRUCTIONS: lists locked vocabulary nouns", () => {
  // Spot-check that the noun list survives — the full vocabulary is
  // documented in ADR-023 §3.
  for (
    const noun of [
      "requirements",
      "specifications",
      "ICD",
      "architecture",
      "verification",
      "validation",
      "ASIL",
      "EARS",
      "traceability",
    ]
  ) {
    assertStringIncludes(SERVER_INSTRUCTIONS, noun);
  }
});

// ---------------------------------------------------------------------------
// Resources across several projects
// ---------------------------------------------------------------------------

Deno.test("resources: entry URI listed once and read from both projects", async () => {
  const workspace = await createWorkspace(memoryEnv(twoProjectFiles(
    entryDoc("STK_0001", "Alpha", "01HGW2Q8MNP3RSTVWXYZABCDEF"),
    entryDoc("STK_0001", "Beta", "01HGW2Q8MNP3RSTVWXYZABCDEG"),
  )));
  const list = await listResourceDescriptors(workspace);
  const entryUris = list.filter((d) => d.uri === entryUri("STK_0001"));
  assertEquals(entryUris.length, 1);

  const read = await readResource(entryUri("STK_0001"), workspace);
  assertStringIncludes(read.text, "## Project: a");
  assertStringIncludes(read.text, "## Project: b");
  assertStringIncludes(read.text, "Alpha");
  assertStringIncludes(read.text, "Beta");
});

/** A stub project that delivers `path` from `profileId` with `text`. */
function deliveringProject(
  root: string,
  chainIds: readonly string[],
  doc: DeliveredDocument,
  text: string,
): Project {
  const chain = {
    tiers: chainIds.map((id) => ({ id })),
    effective: { delivers: [doc] },
  } as unknown as ProfileChain;
  return {
    projectRoot: root,
    markspecDetected: true,
    softGateMessage: "",
    config: undefined,
    profileChain: chain,
    profile: undefined,
    delivers: chainIds.includes(doc.profileId) ? [doc] : [],
    getCompiled: () => Promise.reject(new Error("not used")),
    forceRefresh: () => Promise.reject(new Error("not used")),
    subscribeInvalidation: () => () => {},
    readDeliveredDocument: (profileId, relPath) =>
      Promise.resolve(
        chainIds.includes(profileId) && relPath === doc.path ? text : undefined,
      ),
  };
}

Deno.test("resources: delivered doc read from first project in label order", async () => {
  const doc: DeliveredDocument = {
    profileId: "platform-arch",
    profileVersion: "1.0.0",
    path: "reference/platform.md",
    absPath: "/cache/platform-arch/reference/platform.md",
    corpus: false,
  };
  const uri = deliveredUri("platform-arch", "reference/platform.md");

  // Both projects include the profile: the first label wins.
  const both = stubWorkspace([
    {
      label: "a",
      project: deliveringProject("/work/a", ["platform-arch"], doc, "from a"),
    },
    {
      label: "b",
      project: deliveringProject("/work/b", ["platform-arch"], doc, "from b"),
    },
  ]);
  assertEquals((await readResource(uri, both)).text, "from a");

  // Only the second project includes the profile: it is read from there.
  const second = stubWorkspace([
    { label: "a", project: deliveringProject("/work/a", ["other"], doc, "x") },
    {
      label: "b",
      project: deliveringProject("/work/b", ["platform-arch"], doc, "from b"),
    },
  ]);
  assertEquals((await readResource(uri, second)).text, "from b");
});

Deno.test("resources: delivered doc skips a project that shares the profile but not the path", async () => {
  const doc: DeliveredDocument = {
    profileId: "platform-arch",
    profileVersion: "2.0.0",
    path: "reference/new.md",
    absPath: "/cache/platform-arch/reference/new.md",
    corpus: false,
  };
  const olderDoc: DeliveredDocument = {
    ...doc,
    profileVersion: "1.0.0",
    path: "reference/old.md",
    absPath: "/cache/platform-arch/reference/old.md",
  };
  const uri = deliveredUri("platform-arch", "reference/new.md");
  // Project a pins an older version of the profile that does not deliver
  // the path; project b delivers it.
  const ws = stubWorkspace([
    {
      label: "a",
      project: deliveringProject("/work/a", ["platform-arch"], olderDoc, "a"),
    },
    {
      label: "b",
      project: deliveringProject("/work/b", ["platform-arch"], doc, "from b"),
    },
  ]);
  assertEquals((await readResource(uri, ws)).text, "from b");
});

// ---------------------------------------------------------------------------
// Startup and notifications
// ---------------------------------------------------------------------------

/** Resolve to `"pending"` when `p` has not settled within `ms`. Clears its
 * timer, so a test never ends with a timer still pending. */
async function settledWithin(p: Promise<unknown>, ms: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((r) => {
    timer = setTimeout(() => r("pending"), ms);
  });
  try {
    return await Promise.race([
      p.then(() => "settled", () => "settled"),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The `project_list` text for the two projects of {@linkcode twoProjectEnv}
 * before either has compiled.
 */
const TWO_PROJECTS_LISTED =
  `- a — ${
    join(MEMORY_PARENT, "a")
  } — profile: @markspec/profile-default — not compiled yet\n` +
  `- b — ${
    join(MEMORY_PARENT, "b")
  } — profile: @markspec/profile-default — not compiled yet\n`;

Deno.test("startServer: initialize completes while discovery is still running", async () => {
  const base = memoryEnv(twoProjectFiles(
    entryDoc("STK_0001", "Alpha", "01HGW2Q8MNP3RSTVWXYZABCDEF"),
    entryDoc("STK_0002", "Beta", "01HGW2Q8MNP3RSTVWXYZABCDEG"),
  ));
  // Every directory listing waits for `release`, so discovery cannot end
  // before the test allows it.
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => release = r);
  const env: ProjectEnv = {
    ...base,
    readDir: async function* (dir) {
      await gate;
      yield* base.readDir(dir);
    },
  };
  const [clientTransport, serverTransport] = InMemoryTransport
    .createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  try {
    assertEquals(
      await settledWithin(
        startServer({ env, transport: serverTransport }),
        1000,
      ),
      "settled",
    );
    assertEquals(
      await settledWithin(client.connect(clientTransport), 1000),
      "settled",
    );
    // A tool call waits for discovery.
    const call = client.callTool({ name: "project_list", arguments: {} });
    assertEquals(await settledWithin(call, 20), "pending");
    // tools/list does not wait for the pending discovery.
    assertEquals(await settledWithin(client.listTools(), 1000), "settled");
    release();
    const result = await call as { content: { text: string }[] };
    assertEquals(result.content[0].text, TWO_PROJECTS_LISTED);
  } finally {
    release();
    await client.close();
  }
});

// ---------------------------------------------------------------------------
// Retry after a failed discovery (#855)
// ---------------------------------------------------------------------------

/** The shape of a `tools/call` result in these tests. */
interface ToolResult {
  isError?: boolean;
  content: { text: string }[];
}

/** The prefix of the line the server logs when discovery fails. */
const DISCOVERY_FAILED = "MarkSpec project discovery failed:";

/**
 * `base`, with discovery failing on its first `failures` attempts. Each
 * discovery attempt reads the root overrides once, so `attempts()` counts
 * the attempts (a `markspec_refresh` rediscovery counts too).
 */
function failingDiscoveryEnv(
  base: ProjectEnv,
  failures: number,
): { env: ProjectEnv; attempts: () => number } {
  let attempts = 0;
  const env: ProjectEnv = {
    ...base,
    rootOverrides: () => {
      attempts++;
      if (attempts <= failures) {
        throw new Error(`discovery attempt ${attempts} failed`);
      }
      return base.rootOverrides();
    },
  };
  return { env, attempts: () => attempts };
}

/** Two sibling projects `a` and `b`, one entry each. */
function twoProjectEnv(): ProjectEnv {
  return memoryEnv(twoProjectFiles(
    entryDoc("STK_0001", "Alpha", "01HGW2Q8MNP3RSTVWXYZABCDEF"),
    entryDoc("STK_0002", "Beta", "01HGW2Q8MNP3RSTVWXYZABCDEG"),
  ));
}

/**
 * Run `body` with `console.error` captured, and return the number of
 * discovery-failure lines the server logged.
 */
async function countDiscoveryFailures(
  body: () => Promise<void>,
): Promise<number> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await body();
  } finally {
    console.error = original;
  }
  return lines.filter((l) => l.startsWith(DISCOVERY_FAILED)).length;
}

/**
 * Start the server on `env` over an in-memory transport, connect `client`,
 * and wait until the startup discovery attempt has settled (the in-memory
 * environment does no real I/O, so one macrotask is enough).
 */
async function connect(env: ProjectEnv, client: Client): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport
    .createLinkedPair();
  await startServer({ env, transport: serverTransport });
  await client.connect(clientTransport);
  await new Promise((r) => setTimeout(r, 0));
}

Deno.test("startServer: each request after a failed discovery retries it until one succeeds", async () => {
  const { env, attempts } = failingDiscoveryEnv(twoProjectEnv(), 3);
  const client = new Client({ name: "test", version: "0.0.0" });
  const failures = await countDiscoveryFailures(async () => {
    try {
      await connect(env, client);
      assertEquals(attempts(), 1);

      // tools/list answers after a failure and starts no discovery.
      const tools = await client.listTools();
      assertEquals(
        tools.tools.some((t: { name: string }) => t.name === "project_list"),
        true,
      );
      assertEquals(attempts(), 1);

      // The retry fails again: a tool call reports it as isError.
      const failed = await client.callTool({
        name: "project_list",
        arguments: {},
      }) as ToolResult;
      assertEquals(failed.isError, true);
      assertStringIncludes(
        failed.content[0].text,
        "discovery attempt 2 failed",
      );
      assertEquals(attempts(), 2);

      // The next retry fails too: a resource request rejects.
      await assertRejects(
        () => client.listResources(),
        Error,
        "discovery attempt 3 failed",
      );
      assertEquals(attempts(), 3);

      // The next retry succeeds, and later requests use that workspace.
      const listed = await client.callTool({
        name: "project_list",
        arguments: {},
      }) as ToolResult;
      assertEquals(listed.isError, undefined);
      assertEquals(listed.content[0].text, TWO_PROJECTS_LISTED);
      const resources = await client.listResources();
      assertEquals(resources.resources.length > 0, true);
      assertEquals(attempts(), 4);
    } finally {
      await client.close();
    }
  });
  assertEquals(failures, 3);
});

Deno.test("startServer: requests that arrive during a retry share it", async () => {
  const failing = failingDiscoveryEnv(twoProjectEnv(), 1);
  // Every directory listing waits for `release`, so the retry cannot end
  // before both requests have arrived.
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => release = r);
  const env: ProjectEnv = {
    ...failing.env,
    readDir: async function* (dir) {
      await gate;
      yield* failing.env.readDir(dir);
    },
  };
  const client = new Client({ name: "test", version: "0.0.0" });
  const failures = await countDiscoveryFailures(async () => {
    try {
      await connect(env, client);
      assertEquals(failing.attempts(), 1);
      const call = client.callTool({ name: "project_list", arguments: {} });
      const list = client.listResources();
      assertEquals(await settledWithin(call, 20), "pending");
      assertEquals(await settledWithin(list, 20), "pending");
      // tools/list does not wait for the pending retry.
      assertEquals(await settledWithin(client.listTools(), 1000), "settled");
      assertEquals(failing.attempts(), 2);
      release();
      const result = await call as ToolResult;
      assertEquals(result.isError, undefined);
      assertEquals(result.content[0].text, TWO_PROJECTS_LISTED);
      assertEquals((await list).resources.length > 0, true);
      // One retry served both requests.
      assertEquals(failing.attempts(), 2);
    } finally {
      release();
      await client.close();
    }
  });
  assertEquals(failures, 1);
});

Deno.test("startServer: markspec_refresh after a failed discovery runs it again and answers", async () => {
  const { env, attempts } = failingDiscoveryEnv(twoProjectEnv(), 1);
  const client = new Client({ name: "test", version: "0.0.0" });
  const failures = await countDiscoveryFailures(async () => {
    try {
      await connect(env, client);
      assertEquals(attempts(), 1);
      const result = await client.callTool({
        name: "markspec_refresh",
        arguments: {},
      }) as ToolResult;
      assertEquals(result.isError, undefined);
      const text = result.content[0].text;
      assertStringIncludes(text, "## Project: a");
      assertStringIncludes(text, "## Project: b");
      assertStringIncludes(text, "Refreshed. 1 entries, 0 links.");
      // Discovery ran twice for this call: the retry, then the tool's own
      // rediscovery.
      assertEquals(attempts(), 3);
    } finally {
      await client.close();
    }
  });
  assertEquals(failures, 1);
});

Deno.test("startServer: notifications are wired once, for the discovery that succeeds", async () => {
  const { env } = failingDiscoveryEnv(twoProjectEnv(), 2);
  const client = new Client({ name: "test", version: "0.0.0" });
  let listChanged = 0;
  client.setNotificationHandler(ResourceListChangedNotificationSchema, () => {
    listChanged++;
  });
  await countDiscoveryFailures(async () => {
    try {
      await connect(env, client);
      const failed = await client.callTool({
        name: "project_list",
        arguments: {},
      }) as ToolResult;
      assertEquals(failed.isError, true);
      // The retry succeeds; two more requests use its workspace.
      for (let i = 0; i < 3; i++) {
        const ok = await client.callTool({
          name: "project_list",
          arguments: {},
        }) as ToolResult;
        assertEquals(ok.isError, undefined);
      }
      listChanged = 0;
      // One recompile of one project: one invalidation of the workspace.
      const refreshed = await client.callTool({
        name: "markspec_refresh",
        arguments: { project: "a" },
      }) as ToolResult;
      assertEquals(refreshed.isError, undefined);
      // Let every notification sent by that invalidation arrive.
      await new Promise((r) => setTimeout(r, 50));
      assertEquals(listChanged, 1);
    } finally {
      await client.close();
    }
  });
});

Deno.test("startServer: resources/read after a failed discovery rejects, then a retry answers", async () => {
  const { env, attempts } = failingDiscoveryEnv(twoProjectEnv(), 2);
  const client = new Client({ name: "test", version: "0.0.0" });
  const failures = await countDiscoveryFailures(async () => {
    try {
      await connect(env, client);
      assertEquals(attempts(), 1);
      // The retry fails again: the read rejects with the discovery error.
      await assertRejects(
        () => client.readResource({ uri: PROFILE_URI }),
        Error,
        "discovery attempt 2 failed",
      );
      assertEquals(attempts(), 2);
      // The next retry succeeds, and the read answers from its workspace.
      const read = await client.readResource({ uri: PROFILE_URI });
      assertEquals(read.contents[0].uri, PROFILE_URI);
      assertStringIncludes(
        String(read.contents[0].text),
        "@markspec/profile-default",
      );
      assertEquals(attempts(), 3);
    } finally {
      await client.close();
    }
  });
  assertEquals(failures, 2);
});

Deno.test("startServer: an invalidation after the client disconnected does not reject unhandled", async () => {
  // One project, so the workspace compiles it eagerly. Reading the entry
  // document waits for `release`, so the compile, and the notifications it
  // sends, end only after the client has disconnected.
  const base = memoryEnv({
    [join(MEMORY_PARENT, "a", "project.yaml")]: PROJECT_YAML,
    [join(MEMORY_PARENT, "a", "req.md")]: entryDoc(
      "STK_0001",
      "Alpha",
      "01HGW2Q8MNP3RSTVWXYZABCDEF",
    ),
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => release = r);
  let compileFinished = false;
  const env: ProjectEnv = {
    ...base,
    readFile: async (path) => {
      if (path.endsWith(".md")) await gate;
      return base.readFile(path);
    },
    // The compile takes its file snapshot after it has read the entry
    // document, just before it fires the invalidation handlers.
    stat: (path) => {
      if (path.endsWith(".md")) compileFinished = true;
      return base.stat(path);
    },
  };
  const rejections: unknown[] = [];
  const onRejection = (e: PromiseRejectionEvent) => {
    e.preventDefault();
    rejections.push(e.reason);
  };
  globalThis.addEventListener("unhandledrejection", onRejection);
  const client = new Client({ name: "test", version: "0.0.0" });
  try {
    await connect(env, client);
    // project_list waits for discovery, so the notifications are wired.
    const listed = await client.callTool({
      name: "project_list",
      arguments: {},
    }) as ToolResult;
    assertEquals(listed.isError, undefined);
    await client.close();
    release();
    for (let i = 0; i < 200 && !compileFinished; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assertEquals(compileFinished, true);
    // Let every send rejection of that invalidation surface.
    await new Promise((r) => setTimeout(r, 50));
    assertEquals(rejections.map(String), []);
  } finally {
    release();
    globalThis.removeEventListener("unhandledrejection", onRejection);
    await client.close();
  }
});

Deno.test("compiledEntryIds: reads only the projects that already compiled", async () => {
  const base = memoryEnv(twoProjectFiles(
    entryDoc("STK_0001", "Alpha", "01HGW2Q8MNP3RSTVWXYZABCDEF"),
    entryDoc("STK_0002", "Beta", "01HGW2Q8MNP3RSTVWXYZABCDEG"),
  ));
  const mdReads: string[] = [];
  const env: ProjectEnv = {
    ...base,
    readFile: (path) => {
      if (path.endsWith(".md")) mdReads.push(path);
      return base.readFile(path);
    },
  };
  const workspace = await createWorkspace(env);
  assertEquals(workspace.projects().map((p) => p.label), ["a", "b"]);
  await workspace.projects()[0].project.getCompiled();
  mdReads.length = 0;
  const ids = await compiledEntryIds(workspace);
  assertEquals([...ids], ["STK_0001"]);
  // Project b was never used, so the notification path did not compile it.
  assertEquals(
    mdReads.filter((p) => p.includes(`${SEPARATOR}b${SEPARATOR}`)),
    [],
  );
});
