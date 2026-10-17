import {
  assert,
  assertEquals,
  assertExists,
  assertNotEquals,
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

  assertEquals(tree.apiVersion, 2);
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
