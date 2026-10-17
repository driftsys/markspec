import { assert, assertEquals, assertExists } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { Ajv } from "ajv";
import {
  compile,
  type CompileResult,
  type EffectiveProfile,
  loadProfileForCommand,
} from "../core/mod.ts";
import {
  buildProductTree,
  coreKindOf,
  createDeskHandler,
  type DeskSource,
  type EntryView,
  type ProductTree,
  TAURI_ORIGINS,
  type TreeNode,
} from "./api.ts";

const FIXTURE_ROOT = fromFileUrl(
  new URL("../../../tests/fixtures/desk-project", import.meta.url),
);
const SCHEMA_URL = new URL("../../../schemas/desk-api.json", import.meta.url);
const TOKEN = "test-token-0123456789";
const BASE = "http://127.0.0.1:4100";

async function readFile(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
}

/** Compile the fixture project with its own profile, once per test file. */
const fixture: Promise<{ compiled: CompileResult; profile: EffectiveProfile }> =
  (async () => {
    const chain = (await loadProfileForCommand(FIXTURE_ROOT, readFile)).chain;
    assertExists(chain, "fixture profile should load");
    const files = ["hazards", "software", "stakeholder", "system"].map((f) =>
      join(FIXTURE_ROOT, "docs", `${f}.md`)
    );
    const compiled = await compile(files, {
      readFile: (p) => Deno.readTextFile(p),
      profile: chain.effective,
    });
    return { compiled, profile: chain.effective };
  })();

async function handler(allowedOrigins?: readonly string[]) {
  const { compiled, profile } = await fixture;
  const source: DeskSource = {
    projectRoot: FIXTURE_ROOT,
    projectName: "io.example.braking",
    profile,
    getCompiled: () => Promise.resolve(compiled),
  };
  return createDeskHandler({ source, token: TOKEN, allowedOrigins });
}

function get(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...init.headers },
  });
}

/** Validate a response body against a component schema of desk-api.json. */
async function assertMatchesSchema(component: string, body: unknown) {
  const doc = JSON.parse(await Deno.readTextFile(SCHEMA_URL));
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addSchema(doc, "desk-api.json");
  const validate = ajv.getSchema(
    `desk-api.json#/components/schemas/${component}`,
  );
  assertExists(validate, `schema component ${component}`);
  const ok = validate(body);
  assert(ok, JSON.stringify(validate.errors, null, 2));
}

function findNode(
  nodes: readonly TreeNode[],
  displayId: string,
): TreeNode | undefined {
  for (const node of nodes) {
    if (node.displayId === displayId) return node;
    const hit = findNode(node.children, displayId);
    if (hit) return hit;
  }
  return undefined;
}

Deno.test("desk api: rejects a request without a token", async () => {
  const res = await (await handler())(
    new Request(`${BASE}/api/v1/tree`),
  );
  assertEquals(res.status, 401);
  await assertMatchesSchema("Error", await res.json());
});

Deno.test("desk api: rejects a wrong token of the same length", async () => {
  const wrong = TOKEN.replace(/.$/, "X");
  const res = await (await handler())(
    new Request(`${BASE}/api/v1/tree`, {
      headers: { authorization: `Bearer ${wrong}` },
    }),
  );
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

Deno.test("desk api: rejects a non-loopback Host (DNS rebinding)", async () => {
  const res = await (await handler())(
    get("/api/v1/tree", { headers: { host: "evil.example:4100" } }),
  );
  assertEquals(res.status, 403);
  await res.body?.cancel();
});

Deno.test("desk api: only GET is allowed", async () => {
  const res = await (await handler())(get("/api/v1/tree", { method: "POST" }));
  assertEquals(res.status, 405);
  await res.body?.cancel();
});

Deno.test("desk api: unknown route is 404", async () => {
  const res = await (await handler())(get("/api/v1/nope"));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, "not-found");
});

Deno.test("desk api: tree reads the product top-down", async () => {
  const res = await (await handler())(get("/api/v1/tree"));
  assertEquals(res.status, 200);
  const tree = await res.json() as ProductTree;
  await assertMatchesSchema("ProductTree", tree);

  assertEquals(tree.project.name, "io.example.braking");
  // Roots: the hazard and the stakeholder need — nothing above them.
  assertEquals(tree.nodes.map((n) => n.displayId), [
    "HAZ_BRK_0001",
    "STK_BRK_0001",
  ]);
  const stk = tree.nodes[1];
  assertEquals(stk.kind, "Requirement");
  assertEquals(stk.type, "stakeholder-requirement");
  assertEquals(stk.relation, undefined);

  // Refinement before verification among siblings.
  const sys = findNode(stk.children, "SYS_BRK_0001")!;
  assertEquals(sys.children.map((c) => [c.displayId, c.relation]), [
    ["SRS_BRK_0001", "satisfies"],
    ["SRS_BRK_0002", "satisfies"],
    ["SIT_BRK_0001", "verifies"],
  ]);
  assertEquals(findNode(sys.children, "SWT_BRK_0001")?.kind, "Test");

  // A DAG node appears under each parent, with that parent's relation.
  assertEquals(
    findNode(tree.nodes[0].children, "SYS_BRK_0002")?.relation,
    "derived-from",
  );
  assertEquals(findNode(stk.children, "SYS_BRK_0002")?.relation, "satisfies");
});

Deno.test("desk api: entry by display ID carries body, attributes, links", async () => {
  const res = await (await handler())(get("/api/v1/entries/SYS_BRK_0001"));
  assertEquals(res.status, 200);
  const entry = await res.json() as EntryView;
  await assertMatchesSchema("EntryView", entry);

  assertEquals(entry.displayId, "SYS_BRK_0001");
  assertEquals(entry.id, "01JBRK00000000000000000003");
  assertEquals(entry.kind, "Requirement");
  assertEquals(entry.location.file, join("docs", "system.md"));
  assertEquals(entry.links.outgoing, [
    {
      kind: "satisfies",
      displayId: "STK_BRK_0001",
      title: "Stop before a detected obstacle",
    },
  ]);
  assertEquals(
    entry.links.incoming.map((l) => `${l.kind}:${l.displayId}`),
    [
      "satisfies:SRS_BRK_0001",
      "satisfies:SRS_BRK_0002",
      "verifies:SIT_BRK_0001",
    ],
  );
  assert(entry.body.includes("200 ms"));
});

Deno.test("desk api: entry is also addressable by its Id", async () => {
  const res = await (await handler())(
    get("/api/v1/entries/01JBRK00000000000000000002"),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).displayId, "HAZ_BRK_0001");
});

Deno.test("desk api: unknown entry is 404 entry-not-found", async () => {
  const res = await (await handler())(get("/api/v1/entries/STK_BRK_9999"));
  assertEquals(res.status, 404);
  const body = await res.json();
  await assertMatchesSchema("Error", body);
  assertEquals(body.error.code, "entry-not-found");
});

Deno.test("coreKindOf: walks profile extends to the core type", async () => {
  const { profile } = await fixture;
  assertEquals(coreKindOf("software-test", profile), "Test");
  assertEquals(coreKindOf("hazard", profile), "Risk");
  assertEquals(coreKindOf("Requirement", profile), "Requirement");
  assertEquals(coreKindOf(undefined, profile), undefined);
  assertEquals(coreKindOf("Requirement", undefined), "Requirement");
});

Deno.test("buildProductTree: output is deterministic", async () => {
  const { compiled, profile } = await fixture;
  assertEquals(
    JSON.stringify(buildProductTree(compiled, profile)),
    JSON.stringify(buildProductTree(compiled, profile)),
  );
});

Deno.test("desk api: malformed percent-encoding is 400 bad-request", async () => {
  const res = await (await handler())(get("/api/v1/entries/%E0%A4%A"));
  assertEquals(res.status, 400);
  const body = await res.json();
  await assertMatchesSchema("Error", body);
  assertEquals(body.error.code, "bad-request");
});

Deno.test("buildProductTree: entries in a link cycle still appear", async () => {
  const docs: Record<string, string> = {
    "/cycle/a.md": `- [REQ_0001] First

  Body.

      Satisfies: REQ_0002

- [REQ_0002] Second

  Body.

      Satisfies: REQ_0001

- [REQ_0003] Child of first

  Body.

      Satisfies: REQ_0001
`,
  };
  const compiled = await compile(Object.keys(docs), {
    readFile: (p) => Promise.resolve(docs[p]),
  });
  const tree = buildProductTree(compiled, undefined);
  // No entry is a natural root; the cycle surfaces at its lowest ID.
  assertEquals(tree.nodes.map((n) => n.displayId), ["REQ_0001"]);
  for (const id of ["REQ_0001", "REQ_0002", "REQ_0003"]) {
    assertExists(findNode(tree.nodes, id), `${id} in tree`);
  }
});

// ---------------------------------------------------------------------------
// Origin policy and CORS preflight (#824)
// ---------------------------------------------------------------------------

Deno.test("desk api: TAURI_ORIGINS lists the three Tauri webview origins", () => {
  assertEquals([...TAURI_ORIGINS], [
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
  ]);
});

Deno.test("desk api: preflight from a Tauri origin is 204 with CORS headers", async () => {
  const res = await (await handler())(
    new Request(`${BASE}/api/v1/tree`, {
      method: "OPTIONS",
      headers: { origin: "tauri://localhost" },
    }),
  );
  assertEquals(res.status, 204);
  assertEquals(await res.text(), "");
  assertEquals(
    res.headers.get("access-control-allow-origin"),
    "tauri://localhost",
  );
  assertEquals(res.headers.get("access-control-allow-methods"), "GET, OPTIONS");
  assertEquals(
    res.headers.get("access-control-allow-headers"),
    "Authorization",
  );
  assertEquals(res.headers.get("access-control-max-age"), "600");
  assertEquals(res.headers.get("vary"), "Origin");
  assertEquals(res.headers.get("cache-control"), "no-store");
});

Deno.test("desk api: preflight from an unknown origin is 403 forbidden-origin", async () => {
  const res = await (await handler())(
    new Request(`${BASE}/api/v1/tree`, {
      method: "OPTIONS",
      headers: { origin: "http://evil.example" },
    }),
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.code, "forbidden-origin");
});

Deno.test("desk api: GET from an unknown origin is 403 forbidden-origin", async () => {
  const res = await (await handler())(
    get("/api/v1/tree", { headers: { origin: "http://evil.example" } }),
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "forbidden-origin");
  assertEquals(body.error.message, "Origin is not allowed");
});

Deno.test("desk api: GET from an allowed origin carries CORS headers", async () => {
  const res = await (await handler())(
    get("/api/v1/tree", { headers: { origin: "http://tauri.localhost" } }),
  );
  assertEquals(res.status, 200);
  assertEquals(
    res.headers.get("access-control-allow-origin"),
    "http://tauri.localhost",
  );
  assertEquals(res.headers.get("vary"), "Origin");
  await res.body?.cancel();
});

Deno.test("desk api: 401 from an allowed origin is readable by the UI", async () => {
  const res = await (await handler())(
    new Request(`${BASE}/api/v1/tree`, {
      headers: { origin: "tauri://localhost" },
    }),
  );
  assertEquals(res.status, 401);
  assertEquals(
    res.headers.get("access-control-allow-origin"),
    "tauri://localhost",
  );
  await res.body?.cancel();
});

Deno.test("desk api: Origin null is 403 forbidden-origin", async () => {
  const res = await (await handler())(
    get("/api/v1/tree", { headers: { origin: "null" } }),
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.code, "forbidden-origin");
});

Deno.test("desk api: allowedOrigins adds an origin to the allowlist", async () => {
  const preflight = () =>
    new Request(`${BASE}/api/v1/tree`, {
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173" },
    });
  const allowed = await (await handler(["http://localhost:5173"]))(preflight());
  assertEquals(allowed.status, 204);
  assertEquals(
    allowed.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );
  const denied = await (await handler())(preflight());
  assertEquals(denied.status, 403);
  await denied.body?.cancel();
});

Deno.test("desk api: a request without Origin gets no CORS headers", async () => {
  const res = await (await handler())(get("/api/v1/tree"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), null);
  await res.body?.cancel();
});

Deno.test("desk api: OPTIONS without Origin is not a preflight", async () => {
  const res = await (await handler())(
    new Request(`${BASE}/api/v1/tree`, { method: "OPTIONS" }),
  );
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

Deno.test("desk api: 404 from an allowed origin carries CORS headers", async () => {
  const res = await (await handler())(
    get("/api/v1/nope", { headers: { origin: "tauri://localhost" } }),
  );
  assertEquals(res.status, 404);
  assertEquals(
    res.headers.get("access-control-allow-origin"),
    "tauri://localhost",
  );
  assertEquals(res.headers.get("vary"), "Origin");
  await res.body?.cancel();
});
