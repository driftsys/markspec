import {
  assert,
  assertEquals,
  assertExists,
  assertMatch,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { Ajv } from "ajv";
import {
  compile,
  type CompileResult,
  type EffectiveProfile,
  loadProfileForCommand,
  makeDisplayId,
} from "../core/mod.ts";
import {
  buildProductTree,
  coreKindOf,
  createDeskHandler,
  type DeskSource,
  type EntryView,
  type ProductTree,
  TAURI_ORIGINS,
  toApiPath,
} from "./api.ts";
import { documentEtag } from "./render.ts";

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

async function realPath(path: string): Promise<string | undefined> {
  try {
    return await Deno.realPath(path);
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
    readFile,
    realPath,
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

/** Entry blocks for the link cycle REQ_0001 <-> REQ_0002. */
function cycleBlocks(): string {
  return `- [REQ_0001] First

  Body.

      Satisfies: REQ_0002

- [REQ_0002] Second

  Body.

      Satisfies: REQ_0001
`;
}

/** Compile one in-memory Markdown document without a profile. */
function compileDocs(markdown: string): Promise<CompileResult> {
  const path = "/graph/doc.md";
  return compile([path], { readFile: () => Promise.resolve(markdown) });
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

Deno.test("desk api: tree reads the product as nodes and edges", async () => {
  const res = await (await handler())(get("/api/v1/tree"));
  assertEquals(res.status, 200);
  const tree = await res.json() as ProductTree;
  await assertMatchesSchema("ProductTree", tree);

  assertEquals(tree.apiVersion, 3);
  assertEquals(tree.project.name, "io.example.braking");
  // Nodes are sorted by display ID even though the fixture compiles in file
  // order.
  const { compiled } = await fixture;
  const compileOrder = [...compiled.entries.keys()] as string[];
  const sortedIds = [...compileOrder].sort();
  assertNotEquals(compileOrder, sortedIds);
  assertEquals(tree.nodes.map((n) => n.displayId), sortedIds);
  // Roots: the hazard and the stakeholder need — nothing above them.
  assertEquals(tree.roots, ["HAZ_BRK_0001", "STK_BRK_0001"]);
  const stk = tree.nodes.find((n) => n.displayId === "STK_BRK_0001")!;
  assertEquals(stk.kind, "Requirement");
  assertEquals(stk.type, "stakeholder-requirement");
  assertEquals(
    tree.nodes.find((n) => n.displayId === "SWT_BRK_0001")?.kind,
    "Test",
  );

  // Edges point from child to parent; refinement sorts before verification.
  const under = (parent: string) =>
    tree.edges.filter((e) => e.to === parent).map((e) => [
      e.from,
      e.relation,
    ]);
  assertEquals(under("SYS_BRK_0001"), [
    ["SRS_BRK_0001", "satisfies"],
    ["SRS_BRK_0002", "satisfies"],
    ["SIT_BRK_0001", "verifies"],
  ]);
  // A DAG node has one edge per parent, with that parent's relation.
  assertEquals(
    tree.edges.filter((e) => e.from === "SYS_BRK_0002").map((e) => [
      e.to,
      e.relation,
    ]),
    [["HAZ_BRK_0001", "derived-from"], ["STK_BRK_0001", "satisfies"]],
  );
  assertEquals(
    tree.nodes.filter((n) => n.displayId === "SYS_BRK_0002").length,
    1,
  );
});

Deno.test("desk api: entry by display ID carries body, attributes, links", async () => {
  const res = await (await handler())(get("/api/v1/entries/SYS_BRK_0001"));
  assertEquals(res.status, 200);
  const entry = await res.json() as EntryView;
  await assertMatchesSchema("EntryView", entry);

  assertEquals(entry.displayId, "SYS_BRK_0001");
  assertEquals(entry.id, "01JBRK00000000000000000003");
  assertEquals(entry.kind, "Requirement");
  assertEquals(entry.location.file, "docs/system.md");
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

Deno.test("buildProductTree: output does not depend on file order", async () => {
  const { profile } = await fixture;
  const files = ["hazards", "software", "stakeholder", "system"].map((f) =>
    join(FIXTURE_ROOT, "docs", `${f}.md`)
  );
  const build = async (paths: string[]) =>
    JSON.stringify(
      buildProductTree(
        await compile(paths, {
          readFile: (p) => Deno.readTextFile(p),
          profile,
        }),
        profile,
      ),
    );
  assertEquals(await build(files), await build([...files].reverse()));
});

Deno.test("desk api: malformed percent-encoding is 400 bad-request", async () => {
  const res = await (await handler())(get("/api/v1/entries/%E0%A4%A"));
  assertEquals(res.status, 400);
  const body = await res.json();
  await assertMatchesSchema("Error", body);
  assertEquals(body.error.code, "bad-request");
});

Deno.test("buildProductTree: entries in a link cycle still appear", async () => {
  const compiled = await compileDocs(`- [REQ_0001] First

  Body.

      Satisfies: REQ_0002

- [REQ_0002] Second

  Body.

      Satisfies: REQ_0001

- [REQ_0003] Child of first

  Body.

      Satisfies: REQ_0001
`);
  const tree = buildProductTree(compiled, undefined);
  // No entry is a natural root; the cycle surfaces at its lowest ID.
  assertEquals(tree.roots, ["REQ_0001"]);
  assertEquals(tree.nodes.map((n) => n.displayId), [
    "REQ_0001",
    "REQ_0002",
    "REQ_0003",
  ]);
  // Both cycle edges are kept; a client must track visited entries.
  assertEquals(tree.edges, [
    { from: "REQ_0002", to: "REQ_0001", relation: "satisfies" },
    { from: "REQ_0003", to: "REQ_0001", relation: "satisfies" },
    { from: "REQ_0001", to: "REQ_0002", relation: "satisfies" },
  ]);
});

Deno.test("buildProductTree: an entry with two parents appears once", async () => {
  const compiled = await compileDocs(`- [REQ_0001] Parent one

  Body.

- [REQ_0002] Parent two

  Body.

- [REQ_0003] Child

  Body.

      Satisfies: REQ_0001
      Satisfies: REQ_0002
`);
  const tree = buildProductTree(compiled, undefined);
  assertEquals(tree.nodes.filter((n) => n.displayId === "REQ_0003").length, 1);
  assertEquals(tree.edges, [
    { from: "REQ_0003", to: "REQ_0001", relation: "satisfies" },
    { from: "REQ_0003", to: "REQ_0002", relation: "satisfies" },
  ]);
  assertEquals(tree.roots, ["REQ_0001", "REQ_0002"]);
});

Deno.test("buildProductTree: duplicate links keep the refinement edge", async () => {
  const compiled = await compileDocs(`- [REQ_0001] Parent

  Body.

- [TST_0001] Child

  Body.

      Verifies: REQ_0001
      Satisfies: REQ_0001
`);
  const tree = buildProductTree(compiled, undefined);
  assertEquals(tree.edges, [
    { from: "TST_0001", to: "REQ_0001", relation: "satisfies" },
  ]);
});

Deno.test("buildProductTree: Satisfies and Derived-from keep the first kind name", async () => {
  const compiled = await compileDocs(`- [REQ_0001] Parent

  Body.

- [REQ_0002] Child

  Body.

      Satisfies: REQ_0001
      Derived-from: REQ_0001
`);
  const tree = buildProductTree(compiled, undefined);
  assertEquals(tree.edges, [
    { from: "REQ_0002", to: "REQ_0001", relation: "derived-from" },
  ]);
});

Deno.test("buildProductTree: a deep diamond stays linear in size", async () => {
  const levels = 40;
  const blocks: string[] = [];
  for (let level = 0; level < levels; level++) {
    for (const side of ["A", "B"]) {
      const trailer = level === 0
        ? ""
        : `\n      Satisfies: REQ_L${level - 1}A\n      Satisfies: REQ_L${
          level - 1
        }B\n`;
      blocks.push(
        `- [REQ_L${level}${side}] Level ${level}${side}\n\n  Body.\n${trailer}`,
      );
    }
  }
  const compiled = await compileDocs(blocks.join("\n"));
  const tree = buildProductTree(compiled, undefined);
  assertEquals(tree.nodes.length, 80);
  assertEquals(tree.edges.length, 156);
  assertEquals(tree.roots, ["REQ_L0A", "REQ_L0B"]);
});

Deno.test("buildProductTree: dangling and self links produce no edge", async () => {
  const compiled = await compileDocs(`- [REQ_0001] Linked to nothing real

  Body.

      Satisfies: REQ_9999
      Satisfies: REQ_0001

- [REQ_0002] Plain

  Body.
`);
  const tree = buildProductTree(compiled, undefined);
  assertEquals(tree.edges, []);
  assertEquals(tree.roots, ["REQ_0001", "REQ_0002"]);
});

Deno.test("buildProductTree: only refinement and verification links are edges", async () => {
  const compiled = await compileDocs(`- [REQ_0001] Parent

  Body.

- [REQ_0002] Other

  Body.

- [REQ_0003] Child

  Body.

      Satisfies: REQ_0001
      Depends-on: REQ_0002

- [REQ_0004] Depends only

  Body.

      Depends-on: REQ_0001
`);
  const tree = buildProductTree(compiled, undefined);
  assertEquals(tree.edges, [
    { from: "REQ_0003", to: "REQ_0001", relation: "satisfies" },
  ]);
  assertEquals(tree.roots, ["REQ_0001", "REQ_0002", "REQ_0004"]);
  await assertMatchesSchema("ProductTree", tree);
});

Deno.test("buildProductTree: cycle root follows the parentless roots", async () => {
  const compiled = await compileDocs(`${cycleBlocks()}
- [REQ_0003] Parentless

  Body.
`);
  const tree = buildProductTree(compiled, undefined);
  assertEquals(tree.roots, ["REQ_0003", "REQ_0001"]);
});

Deno.test("buildProductTree: a descendant of a cycle is not promoted as a root", async () => {
  const compiled = await compileDocs(`${cycleBlocks()}
- [REQ_0000] Child of the cycle

  Body.

      Satisfies: REQ_0001
`);
  const tree = buildProductTree(compiled, undefined);
  assertEquals(tree.roots, ["REQ_0001"]);
});

Deno.test("buildProductTree: each unreached cycle gets one root", async () => {
  const compiled = await compileDocs(`${cycleBlocks()}
- [REQ_0003] Third

  Body.

      Satisfies: REQ_0004

- [REQ_0004] Fourth

  Body.

      Satisfies: REQ_0003
`);
  const tree = buildProductTree(compiled, undefined);
  assertEquals(tree.roots, ["REQ_0001", "REQ_0003"]);
});

Deno.test("buildProductTree: Satisfies before Verifies keeps satisfies", async () => {
  const compiled = await compileDocs(`- [REQ_0001] Parent

  Body.

- [TST_0001] Child

  Body.

      Satisfies: REQ_0001
      Verifies: REQ_0001
`);
  assertEquals(buildProductTree(compiled, undefined).edges, [
    { from: "TST_0001", to: "REQ_0001", relation: "satisfies" },
  ]);
});

Deno.test("buildProductTree: Derived-from before Satisfies keeps derived-from", async () => {
  const compiled = await compileDocs(`- [REQ_0001] Parent

  Body.

- [REQ_0002] Child

  Body.

      Derived-from: REQ_0001
      Satisfies: REQ_0001
`);
  assertEquals(buildProductTree(compiled, undefined).edges, [
    { from: "REQ_0002", to: "REQ_0001", relation: "derived-from" },
  ]);
});

Deno.test("buildProductTree: a cycle with a parent in another cycle is not a root", async () => {
  const compiled = await compileDocs(`- [REQ_0001] One

  Body.

      Satisfies: REQ_0002
      Satisfies: REQ_0003

- [REQ_0002] Two

  Body.

      Satisfies: REQ_0001

- [REQ_0003] Three

  Body.

      Satisfies: REQ_0004

- [REQ_0004] Four

  Body.

      Satisfies: REQ_0003
`);
  assertEquals(buildProductTree(compiled, undefined).roots, ["REQ_0003"]);
});

Deno.test("buildProductTree: a cycle entered elsewhere is rooted at its lowest ID", async () => {
  const compiled = await compileDocs(`- [REQ_0001] Entered child

  Body.

      Satisfies: REQ_0003

- [REQ_0002] Two

  Body.

      Satisfies: REQ_0003

- [REQ_0003] Three

  Body.

      Satisfies: REQ_0002
`);
  assertEquals(buildProductTree(compiled, undefined).roots, ["REQ_0002"]);
});

Deno.test("buildProductTree: parentless entries precede source cycle roots", async () => {
  const compiled = await compileDocs(`- [REQ_0001] A

  Body.

      Satisfies: REQ_0002

- [REQ_0002] B

  Body.

      Satisfies: REQ_0001

- [REQ_0003] C

  Body.

      Satisfies: REQ_0004

- [REQ_0004] D

  Body.

      Satisfies: REQ_0003

- [REQ_0009] Parentless

  Body.
`);
  assertEquals(buildProductTree(compiled, undefined).roots, [
    "REQ_0009",
    "REQ_0001",
    "REQ_0003",
  ]);
});

Deno.test("buildProductTree: edges with the same parent sort by child", async () => {
  const compiled = await compileDocs(`- [REQ_0001] Parent

  Body.

- [REQ_0003] Later child

  Body.

      Satisfies: REQ_0001

- [REQ_0002] Earlier child

  Body.

      Satisfies: REQ_0001
`);
  const tree = buildProductTree(compiled, undefined);
  assertEquals(tree.edges, [
    { from: "REQ_0002", to: "REQ_0001", relation: "satisfies" },
    { from: "REQ_0003", to: "REQ_0001", relation: "satisfies" },
  ]);
});

Deno.test("buildProductTree: origin is formatted on delivered entries only", async () => {
  const compiled = await compileDocs(`- [REQ_0001] Delivered

  Body.

- [REQ_0002] Local

  Body.
`);
  const delivered = compiled.entries.get(makeDisplayId("REQ_0001"))!;
  const entries = new Map(compiled.entries);
  entries.set(delivered.displayId, {
    ...delivered,
    origin: { kind: "profile", profileId: "acme", profileVersion: "1.2.0" },
  });
  const tree = buildProductTree({ ...compiled, entries }, undefined);
  assertEquals(tree.nodes[0].origin, "acme@1.2.0");
  assertEquals("origin" in tree.nodes[1], false);
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
    "Authorization, If-None-Match",
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
  assertEquals(res.headers.get("vary"), "Origin");
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

function preflight(origin: string, headers: HeadersInit = {}): Request {
  return new Request(`${BASE}/api/v1/tree`, {
    method: "OPTIONS",
    headers: { origin, ...headers },
  });
}

Deno.test("desk api: allowedOrigins adds to the Tauri origins, not replaces", async () => {
  const res = await (await handler(["http://localhost:5173"]))(
    preflight("tauri://localhost"),
  );
  assertEquals(res.status, 204);
  await res.body?.cancel();
});

Deno.test("desk api: preflight from https://tauri.localhost is 204", async () => {
  const res = await (await handler())(preflight("https://tauri.localhost"));
  assertEquals(res.status, 204);
  assertEquals(
    res.headers.get("access-control-allow-origin"),
    "https://tauri.localhost",
  );
  await res.body?.cancel();
});

Deno.test("desk api: near-miss Tauri origins are 403 forbidden-origin", async () => {
  const nearMisses = [
    "tauri://localhost/",
    "TAURI://localhost",
    "http://tauri.localhost.evil.example",
    "tauri://localhost:1",
  ];
  for (const origin of nearMisses) {
    const res = await (await handler())(preflight(origin));
    assertEquals(res.status, 403, origin);
    assertEquals((await res.json()).error.code, "forbidden-origin", origin);
  }
});

Deno.test("desk api: Host guard runs before the preflight answer", async () => {
  const res = await (await handler())(
    preflight("tauri://localhost", { host: "evil.example" }),
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.code, "forbidden-host");
});

Deno.test("desk api: 405 from an allowed origin carries CORS headers", async () => {
  const res = await (await handler())(
    get("/api/v1/tree", {
      method: "POST",
      headers: { origin: "tauri://localhost" },
    }),
  );
  assertEquals(res.status, 405);
  assertEquals(
    res.headers.get("access-control-allow-origin"),
    "tauri://localhost",
  );
  assertEquals(res.headers.get("vary"), "Origin");
  await res.body?.cancel();
});

Deno.test("desk api: forbidden-origin 403 carries no CORS headers", async () => {
  const res = await (await handler())(
    get("/api/v1/tree", { headers: { origin: "http://evil.example" } }),
  );
  assertEquals(res.status, 403);
  assertEquals(res.headers.get("access-control-allow-origin"), null);
  await res.body?.cancel();
});

Deno.test("desk api: Origin check runs before the bearer check", async () => {
  const res = await (await handler())(
    new Request(`${BASE}/api/v1/tree`, {
      headers: { origin: "http://evil.example" },
    }),
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.code, "forbidden-origin");
});

Deno.test("desk api: OPTIONS without Origin and with a valid token is 405", async () => {
  const res = await (await handler())(
    get("/api/v1/tree", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 405);
  await res.body?.cancel();
});

// ---------------------------------------------------------------------------
// API v3: documents, rendered entry, source text
// ---------------------------------------------------------------------------

/** Handler over an arbitrary compiled graph, reading files from the fixture. */
async function handlerFor(
  compiled: CompileResult,
  readFileFn: DeskSource["readFile"] = readFile,
) {
  const { profile } = await fixture;
  return createDeskHandler({
    token: TOKEN,
    source: {
      projectRoot: FIXTURE_ROOT,
      profile,
      getCompiled: () => Promise.resolve(compiled),
      readFile: readFileFn,
      realPath: (p) => Promise.resolve(p),
    },
  });
}

/** The fixture graph with every entry of `fileSuffix` marked as upstream. */
async function withUpstreamFile(fileSuffix: string): Promise<CompileResult> {
  const { compiled } = await fixture;
  const entries = new Map(compiled.entries);
  for (const [id, entry] of compiled.entries) {
    if (entry.location.file.endsWith(fileSuffix)) {
      entries.set(id, {
        ...entry,
        origin: { kind: "upstream", upstreamId: "up", version: "1.0.0" },
      });
    }
  }
  return { ...compiled, entries };
}

Deno.test("desk api: documents renders a project Markdown file", async () => {
  const res = await (await handler())(
    get("/api/v1/documents?path=docs/system.md"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  await assertMatchesSchema("DocumentView", body);
  assertEquals(body.path, "docs/system.md");
  assertStringIncludes(body.html, "data-display-id");
  assertEquals(
    body.entries.map((e: { displayId: string }) => e.displayId),
    ["SYS_BRK_0001", "SYS_BRK_0002", "SIT_BRK_0001"],
  );
  assertEquals(body.entries[0].anchor, "entry-SYS_BRK_0001");
});

Deno.test("desk api: documents renders cross-references for known targets", async () => {
  const res = await (await handler())(
    get("/api/v1/documents?path=docs/system.md"),
  );
  const body = await res.json();
  assertStringIncludes(
    body.html,
    '<span class="cross-ref" data-display-id="STK_BRK_0001">STK_BRK_0001</span>',
  );
});

/**
 * A handler over the fixture whose `docs/system.md` text and compiled graph
 * the test can change between requests, as an edit on disk would.
 */
async function editableHandler() {
  const { compiled, profile } = await fixture;
  const systemPath = join(FIXTURE_ROOT, "docs", "system.md");
  const state = {
    text: await Deno.readTextFile(systemPath),
    compiled,
    // Reads of `source.profile`. On `/documents`, only the render reads it.
    profileReads: 0,
  };
  const h = createDeskHandler({
    token: TOKEN,
    allowedOrigins: ["http://localhost:5173"],
    source: {
      projectRoot: FIXTURE_ROOT,
      get profile() {
        state.profileReads++;
        return profile;
      },
      getCompiled: () => Promise.resolve(state.compiled),
      readFile: (p) =>
        p === systemPath ? Promise.resolve(state.text) : readFile(p),
      realPath,
    },
  });
  return { h, state };
}

/** The graph with the title of `displayId` replaced by `title`. */
function withTitle(
  compiled: CompileResult,
  displayId: string,
  title: string,
): CompileResult {
  const entries = new Map(compiled.entries);
  const id = makeDisplayId(displayId);
  entries.set(id, { ...entries.get(id)!, title });
  return { ...compiled, entries };
}

/** The graph without the entry `displayId`. */
function withoutEntry(
  compiled: CompileResult,
  displayId: string,
): CompileResult {
  const entries = new Map(compiled.entries);
  entries.delete(makeDisplayId(displayId));
  return { ...compiled, entries };
}

const SYSTEM_DOC = "/api/v1/documents?path=docs/system.md";

Deno.test("desk api: documents carries a strong ETag", async () => {
  const { h } = await editableHandler();
  const res = await h(get(SYSTEM_DOC));
  assertEquals(res.status, 200);
  await res.body?.cancel();
  const etag = res.headers.get("etag");
  assertExists(etag);
  assertMatch(etag, /^"[0-9a-f]{64}"$/);
});

Deno.test("desk api: documents answers a matching If-None-Match with 304", async () => {
  const { h, state } = await editableHandler();
  const first = await h(get(SYSTEM_DOC));
  await first.body?.cancel();
  const etag = first.headers.get("etag")!;
  const rendered = state.profileReads;
  assert(rendered > 0, "the 200 response renders the document");
  const second = await h(
    get(SYSTEM_DOC, { headers: { "if-none-match": etag } }),
  );
  assertEquals(second.status, 304);
  assertEquals(await second.text(), "");
  assertEquals(state.profileReads, rendered, "a 304 must not render");
  assertEquals(second.headers.get("etag"), etag);
  assertEquals(second.headers.get("cache-control"), "no-store");
});

Deno.test("desk api: documents matches any listed or weak ETag in If-None-Match", async () => {
  const { h } = await editableHandler();
  const first = await h(get(SYSTEM_DOC));
  await first.body?.cancel();
  const etag = first.headers.get("etag")!;
  for (const header of [`"other", ${etag}`, `W/${etag}`, "*"]) {
    const res = await h(
      get(SYSTEM_DOC, { headers: { "if-none-match": header } }),
    );
    assertEquals(res.status, 304, header);
    await res.body?.cancel();
  }
});

Deno.test("desk api: documents returns the new render after the file is edited", async () => {
  const { h, state } = await editableHandler();
  const first = await h(get(SYSTEM_DOC));
  const before = await first.json();
  const etag = first.headers.get("etag")!;
  assert(!before.html.includes("Edited on disk"));
  state.text = `${state.text}\nEdited on disk.\n`;
  const second = await h(
    get(SYSTEM_DOC, { headers: { "if-none-match": etag } }),
  );
  assertEquals(second.status, 200);
  assertNotEquals(second.headers.get("etag"), etag);
  assertStringIncludes((await second.json()).html, "Edited on disk");
});

Deno.test("desk api: the ETag follows the graph's display IDs, not other files' titles", async () => {
  const { h, state } = await editableHandler();
  const etagOf = async () => {
    const res = await h(get(SYSTEM_DOC));
    await res.body?.cancel();
    return res.headers.get("etag")!;
  };
  const original = await etagOf();
  const full = state.compiled;
  // The renderer never reads titles of entries in other files.
  state.compiled = withTitle(full, "SRS_BRK_0001", "Renamed elsewhere");
  assertEquals(await etagOf(), original);
  // A known display ID can become a link anywhere in the text, escaped or
  // not, so adding or removing any entry changes the tag.
  state.compiled = withoutEntry(full, "SRS_BRK_0001");
  assertNotEquals(await etagOf(), original);
  state.compiled = withoutEntry(full, "STK_BRK_0001");
  assertNotEquals(await etagOf(), original);
});

Deno.test("desk api: an escaped display ID in the text is covered by the ETag", async () => {
  const { h, state } = await editableHandler();
  // A Markdown escape renders as the bare character, so the renderer links
  // STK_BRK_0001 here although the raw text never contains that string.
  state.text = "# Escaped\n\nSee STK\\_BRK\\_0001.\n";
  const res = await h(get(SYSTEM_DOC));
  const etag = res.headers.get("etag")!;
  assertStringIncludes(
    (await res.json()).html,
    'data-display-id="STK_BRK_0001"',
  );
  state.compiled = withoutEntry(state.compiled, "STK_BRK_0001");
  const after = await h(
    get(SYSTEM_DOC, { headers: { "if-none-match": etag } }),
  );
  assertEquals(after.status, 200);
  await after.body?.cancel();
});

Deno.test("desk api: preflight allows If-None-Match and responses expose ETag", async () => {
  const { h } = await editableHandler();
  const origin = "http://localhost:5173";
  const preflight = await h(
    new Request(`${BASE}${SYSTEM_DOC}`, {
      method: "OPTIONS",
      headers: { origin },
    }),
  );
  assertEquals(preflight.status, 204);
  assertEquals(
    preflight.headers.get("access-control-allow-headers"),
    "Authorization, If-None-Match",
  );
  const first = await h(get(SYSTEM_DOC, { headers: { origin } }));
  await first.body?.cancel();
  assertEquals(first.headers.get("access-control-expose-headers"), "ETag");
  const etag = first.headers.get("etag")!;
  const second = await h(
    get(SYSTEM_DOC, { headers: { origin, "if-none-match": etag } }),
  );
  assertEquals(second.status, 304);
  assertEquals(second.headers.get("access-control-allow-origin"), origin);
  assertEquals(second.headers.get("access-control-expose-headers"), "ETag");
});

Deno.test("desk api: documents rejects missing path with 400", async () => {
  const res = await (await handler())(get("/api/v1/documents"));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "bad-request");
  await assertMatchesSchema("Error", body);
});

Deno.test("desk api: entries html renders one entry", async () => {
  const res = await (await handler())(get("/api/v1/entries/SYS_BRK_0001/html"));
  assertEquals(res.status, 200);
  const body = await res.json();
  await assertMatchesSchema("EntryHtmlView", body);
  assertEquals(body.displayId, "SYS_BRK_0001");
  assertStringIncludes(body.html, 'data-display-id="SYS_BRK_0001"');
  assertEquals(body.origin, undefined);
});

Deno.test("desk api: entries html resolves a percent-encoded id with a slash", async () => {
  const compiled = await compileDocs(`- [REQ/SUB_0001] Slashed

  Body.
`);
  assert(compiled.entries.has(makeDisplayId("REQ/SUB_0001")));
  const res = await (await handlerFor(compiled))(
    get(`/api/v1/entries/${encodeURIComponent("REQ/SUB_0001")}/html`),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).displayId, "REQ/SUB_0001");
});

Deno.test("desk api: entries html answers 404 for an unknown entry", async () => {
  const res = await (await handler())(get("/api/v1/entries/NOPE_0001/html"));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, "entry-not-found");
});

Deno.test("desk api: entries html carries origin for an upstream entry", async () => {
  const compiled = await withUpstreamFile("hazards.md");
  const res = await (await handlerFor(compiled))(
    get("/api/v1/entries/HAZ_BRK_0001/html"),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  await assertMatchesSchema("EntryHtmlView", body);
  assertEquals(body.origin, "up@1.0.0");
});

Deno.test("desk api: files returns the exact bytes of a project file", async () => {
  const res = await (await handler())(get("/api/v1/files?path=docs/system.md"));
  assertEquals(res.status, 200);
  const body = await res.json();
  await assertMatchesSchema("SourceText", body);
  assertEquals(body.path, "docs/system.md");
  assertEquals(
    body.text,
    await Deno.readTextFile(join(FIXTURE_ROOT, "docs", "system.md")),
  );
});

Deno.test("desk api: documents and files answer 404 for paths outside the allowlist", async () => {
  const noEntries = await compileDocs("# Just prose\n");
  const upstream = await withUpstreamFile("hazards.md");
  const cases: [string, CompileResult | undefined, string][] = [
    ["/api/v1/files", undefined, "../project.yaml"],
    ["/api/v1/files", undefined, join(FIXTURE_ROOT, "docs/system.md")],
    ["/api/v1/files", undefined, "%2e%2e%2fproject.yaml"],
    ["/api/v1/files", undefined, "project.yaml"],
    ["/api/v1/documents", undefined, "../project.yaml"],
    ["/api/v1/documents", undefined, "project.yaml"],
    ["/api/v1/files", noEntries, "docs/system.md"],
    ["/api/v1/files", upstream, "docs/hazards.md"],
    ["/api/v1/documents", upstream, "docs/hazards.md"],
  ];
  for (const [route, graph, path] of cases) {
    const h = graph ? await handlerFor(graph) : await handler();
    const res = await h(get(`${route}?path=${encodeURIComponent(path)}`));
    assertEquals(res.status, 404, `${route} ${path}`);
    const body = await res.json();
    assertEquals(body.error.code, "not-found", `${route} ${path}`);
  }
  // A double-encoded value decodes once by the URL parser: still not allowed.
  const res = await (await handler())(
    get("/api/v1/files?path=%2e%2e%2fproject.yaml"),
  );
  assertEquals(res.status, 404);
  await res.body?.cancel();
});

Deno.test("desk api: documents requires a Markdown path, files accepts source files", async () => {
  const compiled = await fixture.then((f) => f.compiled);
  const [first] = [...compiled.entries.values()];
  const rust = {
    ...first,
    location: { ...first.location, file: join(FIXTURE_ROOT, "src/a.rs") },
  };
  const graph = {
    ...compiled,
    entries: new Map([...compiled.entries, [makeDisplayId("RS_0001"), {
      ...rust,
      displayId: makeDisplayId("RS_0001"),
    }]]),
  };
  const h = await handlerFor(graph, () => Promise.resolve("fn main() {}\n"));
  const files = await h(get("/api/v1/files?path=src/a.rs"));
  assertEquals(files.status, 200);
  assertEquals((await files.json()).text, "fn main() {}\n");
  const docs = await h(get("/api/v1/documents?path=src/a.rs"));
  assertEquals(docs.status, 404);
  await docs.body?.cancel();
});

/** The fixture graph plus one entry located at the absolute path `file`. */
async function withEntryAt(file: string): Promise<CompileResult> {
  const { compiled } = await fixture;
  const [first] = [...compiled.entries.values()];
  const id = makeDisplayId("EXTRA_0001");
  return {
    ...compiled,
    entries: new Map([...compiled.entries, [id, {
      ...first,
      displayId: id,
      location: { ...first.location, file },
    }]]),
  };
}

Deno.test("desk api: an absolute path is never joined to the project root", async () => {
  for (const file of ["/elsewhere/notes.md", "C:/elsewhere/notes.md"]) {
    const graph = await withEntryAt(file);
    const read: string[] = [];
    const h = await handlerFor(graph, (p) => {
      read.push(p);
      return Promise.resolve("# Notes\n");
    });
    for (const route of ["/api/v1/files", "/api/v1/documents"]) {
      const res = await h(get(`${route}?path=${encodeURIComponent(file)}`));
      assertEquals(res.status, 404, `${route} ${file}`);
      assertEquals((await res.json()).error.code, "not-found");
    }
    assertEquals(read, [], file);
  }
});

Deno.test("desk api: files and documents read the resolved real path", async () => {
  const { compiled, profile } = await fixture;
  const resolved = join(FIXTURE_ROOT, "docs", "resolved.md");
  const read: string[] = [];
  const h = createDeskHandler({
    token: TOKEN,
    source: {
      projectRoot: FIXTURE_ROOT,
      profile,
      getCompiled: () => Promise.resolve(compiled),
      readFile: (p) => {
        read.push(p);
        return Promise.resolve("# Resolved\n");
      },
      realPath: (p) =>
        Promise.resolve(
          p === join(FIXTURE_ROOT, "docs", "system.md") ? resolved : p,
        ),
    },
  });
  for (const route of ["/api/v1/files", "/api/v1/documents"]) {
    const res = await h(get(`${route}?path=docs/system.md`));
    assertEquals(res.status, 200, route);
    await res.body?.cancel();
  }
  assertEquals(read, [resolved, resolved]);
});

Deno.test("desk api: a symlink that leaves the project root is 404", async () => {
  const temp = await Deno.makeTempDir();
  try {
    const root = join(temp, "product");
    await Deno.mkdir(join(root, "docs"), { recursive: true });
    await Deno.writeTextFile(join(root, "docs", "inside.md"), "# Inside\n");
    await Deno.writeTextFile(join(temp, "outside.md"), "# Secret\n");
    await Deno.symlink(join(temp, "outside.md"), join(root, "docs", "link.md"));
    const { compiled, profile } = await fixture;
    const [first] = [...compiled.entries.values()];
    const entryAt = (name: string, file: string) =>
      [
        makeDisplayId(name),
        {
          ...first,
          displayId: makeDisplayId(name),
          location: { ...first.location, file },
        },
      ] as const;
    const graph: CompileResult = {
      ...compiled,
      entries: new Map([
        entryAt("IN_0001", join(root, "docs", "inside.md")),
        entryAt("LINK_0001", join(root, "docs", "link.md")),
      ]),
    };
    const h = createDeskHandler({
      token: TOKEN,
      source: {
        projectRoot: root,
        profile,
        getCompiled: () => Promise.resolve(graph),
        readFile,
        realPath,
      },
    });
    const inside = await h(get("/api/v1/files?path=docs/inside.md"));
    assertEquals(inside.status, 200);
    assertEquals((await inside.json()).text, "# Inside\n");
    for (const route of ["/api/v1/files", "/api/v1/documents"]) {
      const res = await h(get(`${route}?path=docs/link.md`));
      assertEquals(res.status, 404, route);
      assertEquals((await res.json()).error.code, "not-found");
    }
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
});

Deno.test("toApiPath: converts Windows separators", () => {
  assertEquals(toApiPath("C:\\p", "C:\\p\\docs\\a.md"), "docs/a.md");
  assertEquals(toApiPath("/p", "/p/docs/a.md"), "docs/a.md");
  assertEquals(toApiPath("/p/", "docs\\a.md"), "docs/a.md");
});

Deno.test("desk api: entry location uses forward slashes for Windows paths", async () => {
  const { compiled, profile } = await fixture;
  const entries = new Map(compiled.entries);
  for (const [id, entry] of compiled.entries) {
    entries.set(id, {
      ...entry,
      location: {
        ...entry.location,
        file: `C:\\proj\\${
          entry.location.file.slice(FIXTURE_ROOT.length + 1)
            .replace(/\//g, "\\")
        }`,
      },
    });
  }
  const handle = createDeskHandler({
    token: TOKEN,
    source: {
      projectRoot: "C:\\proj",
      profile,
      getCompiled: () => Promise.resolve({ ...compiled, entries }),
      readFile,
      realPath,
    },
  });
  const res = await handle(get("/api/v1/entries/SYS_BRK_0001"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.location.file, "docs/system.md");
});

Deno.test("desk api: tree and entry carry origin for upstream entries", async () => {
  const compiled = await withUpstreamFile("hazards.md");
  const h = await handlerFor(compiled);
  const tree = await (await h(get("/api/v1/tree"))).json();
  const node = tree.nodes.find((n: { displayId: string }) =>
    n.displayId === "HAZ_BRK_0001"
  );
  assertEquals(node.origin, "up@1.0.0");
  const entry = await (await h(get("/api/v1/entries/HAZ_BRK_0001"))).json();
  assertEquals(entry.origin, "up@1.0.0");
});

Deno.test("desk api: ETag fields cannot run into each other", async () => {
  const { compiled } = await fixture;
  assertNotEquals(
    await documentEtag(3, compiled, "a", [], "bc"),
    await documentEtag(3, compiled, "ab", [], "c"),
  );
});

// ---------------------------------------------------------------------------
// /tree revalidation (#842)
// ---------------------------------------------------------------------------

Deno.test("desk api: tree carries a strong ETag", async () => {
  const res = await (await handler())(get("/api/v1/tree"));
  assertEquals(res.status, 200);
  await res.body?.cancel();
  const etag = res.headers.get("etag");
  assertExists(etag);
  assertMatch(etag, /^"[0-9a-f]{64}"$/);
});

Deno.test("desk api: tree answers a matching If-None-Match with 304", async () => {
  const h = await handler();
  const first = await h(get("/api/v1/tree"));
  await first.body?.cancel();
  const etag = first.headers.get("etag")!;
  for (const header of [etag, `"other", ${etag}`, `W/${etag}`, "*"]) {
    const res = await h(
      get("/api/v1/tree", { headers: { "if-none-match": header } }),
    );
    assertEquals(res.status, 304, header);
    assertEquals(await res.text(), "");
    assertEquals(res.headers.get("etag"), etag);
    assertEquals(res.headers.get("cache-control"), "no-store");
  }
});

Deno.test("desk api: tree ETag changes when an entry is removed", async () => {
  const { h, state } = await editableHandler();
  const first = await h(get("/api/v1/tree"));
  const before = await first.json() as ProductTree;
  const etag = first.headers.get("etag")!;
  const entries = new Map(state.compiled.entries);
  entries.delete(makeDisplayId("SYS_BRK_0001"));
  state.compiled = { ...state.compiled, entries };
  const second = await h(
    get("/api/v1/tree", { headers: { "if-none-match": etag } }),
  );
  assertEquals(second.status, 200);
  const after = await second.json() as ProductTree;
  assertNotEquals(second.headers.get("etag"), etag);
  assert(before.nodes.some((n) => n.displayId === "SYS_BRK_0001"));
  assert(!after.nodes.some((n) => n.displayId === "SYS_BRK_0001"));
});

Deno.test("desk api: tree ETag keeps the tag for an unchanged graph", async () => {
  const { h, state } = await editableHandler();
  const first = await h(get("/api/v1/tree"));
  await first.body?.cancel();
  const etag = first.headers.get("etag")!;
  // A new graph object with the same content, as an mtime-refreshed compile
  // of unchanged files produces.
  state.compiled = { ...state.compiled };
  const second = await h(
    get("/api/v1/tree", { headers: { "if-none-match": etag } }),
  );
  assertEquals(second.status, 304);
  await second.body?.cancel();
});
