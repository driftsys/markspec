/**
 * @module mcp/resources/mod_test
 *
 * Unit tests for the resources/list and resources/read dispatch.
 *
 * Builds a minimal Project shim and asserts the descriptor list and the
 * routing logic in readResource.
 */

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type {
  CompileResult,
  DeliveredDocument,
  DisplayId,
  Entry,
  ProfileChain,
} from "../../core/mod.ts";
import { makeDisplayId } from "../../core/mod.ts";
import type { Project } from "../project.ts";
import { deliveredUri } from "../uri.ts";
import { listResourceDescriptors, readResource } from "./mod.ts";

function mkProject(
  entries: Entry[],
  delivers: readonly DeliveredDocument[] = [],
): Project {
  const entriesMap = new Map<DisplayId, Entry>();
  for (const e of entries) entriesMap.set(e.displayId, e);
  const result: CompileResult = {
    entries: entriesMap,
    links: [],
    forward: new Map(),
    reverse: new Map(),
    documents: new Map(),
    diagnostics: [],
    typeRegistry: { bindings: new Map(), typedefs: new Map() },
  };
  const chain: ProfileChain | null = null;
  const fileContents = new Map(delivers.map((d) => [d.absPath, `# ${d.path}`]));
  return {
    projectRoot: "/proj",
    markspecDetected: true,
    softGateMessage: "",
    config: undefined,
    profileChain: chain,
    profile: undefined,
    delivers,
    getCompiled: () => Promise.resolve(result),
    forceRefresh: () => Promise.resolve(result),
    subscribeInvalidation: () => () => {},
    readDeliveredDocument: (profileId, relPath) => {
      const doc = delivers.find(
        (d) => d.profileId === profileId && d.path === relPath,
      );
      if (!doc) return Promise.resolve(undefined);
      return Promise.resolve(fileContents.get(doc.absPath));
    },
  };
}

const E1: Entry = {
  displayId: makeDisplayId("STK_TEST_0001"),
  title: "First entry",
  body: "",
  rawAttributes: [],
  typedAttributes: new Map(),
  shape: "Authored",
  location: { file: "/proj/x.md", line: 1, column: 1 },
  source: { kind: "markdown" },
  bodyTokens: [],
};

Deno.test("listResourceDescriptors: includes profile + entries + per-entry", async () => {
  const project = mkProject([E1]);
  const list = await listResourceDescriptors(project);
  assertEquals(list.length, 3);
  assertEquals(list[0].uri, "markspec://profile");
  assertEquals(list[1].uri, "markspec://entries");
  assertEquals(list[2].uri, "markspec://entry/STK_TEST_0001");
});

Deno.test("readResource: routes profile URI", async () => {
  const project = mkProject([E1]);
  const r = await readResource("markspec://profile", project);
  assertStringIncludes(r.text, "# MarkSpec Profile");
});

Deno.test("readResource: routes entries URI", async () => {
  const project = mkProject([E1]);
  const r = await readResource("markspec://entries", project);
  assertStringIncludes(r.text, "# Entries (1)");
});

Deno.test("readResource: routes entry URI", async () => {
  const project = mkProject([E1]);
  const r = await readResource(
    "markspec://entry/STK_TEST_0001",
    project,
  );
  assertStringIncludes(r.text, "# STK_TEST_0001 — First entry");
});

Deno.test("readResource: rejects unknown URI", async () => {
  const project = mkProject([E1]);
  await assertRejects(
    () => readResource("markspec://unknown", project),
    Error,
    "unknown resource URI",
  );
});

Deno.test("readResource: rejects missing entry", async () => {
  const project = mkProject([E1]);
  await assertRejects(
    () => readResource("markspec://entry/NOPE_0001", project),
    Error,
    "entry not found",
  );
});

// ---------------------------------------------------------------------------
// Delivered documents (ADR-030)
// ---------------------------------------------------------------------------

const DOC1: DeliveredDocument = {
  profileId: "platform-arch",
  profileVersion: "1.2.0",
  path: "reference/platform.md",
  absPath: "/profiles/platform-arch/reference/platform.md",
  corpus: true,
  description: "Reference platform architecture",
};

const DOC2: DeliveredDocument = {
  profileId: "platform-arch",
  profileVersion: "1.2.0",
  path: "reference/guide.md",
  absPath: "/profiles/platform-arch/reference/guide.md",
  corpus: false,
};

Deno.test("listResourceDescriptors: includes delivered docs with manifest description", async () => {
  const project = mkProject([E1], [DOC1, DOC2]);
  const list = await listResourceDescriptors(project);
  const delivered = list.filter((d) =>
    d.uri.startsWith("markspec://delivered/")
  );
  assertEquals(delivered.length, 2);

  const doc1 = delivered.find((d) =>
    d.uri === deliveredUri("platform-arch", "reference/platform.md")
  );
  assertEquals(doc1?.description, "Reference platform architecture");
  assertEquals(doc1?.mimeType, "text/markdown");

  // DOC2 has no manifest description — falls back to a generated one that
  // names the delivering profile and the doc's corpus/reference role.
  const doc2 = delivered.find((d) =>
    d.uri === deliveredUri("platform-arch", "reference/guide.md")
  );
  assertStringIncludes(doc2?.description ?? "", "platform-arch");
});

Deno.test("readResource: routes a delivered URI to the raw file text", async () => {
  const project = mkProject([E1], [DOC1]);
  const uri = deliveredUri("platform-arch", "reference/platform.md");
  const r = await readResource(uri, project);
  assertEquals(r.mimeType, "text/markdown");
  assertStringIncludes(r.text, "# reference/platform.md");
});

Deno.test("readResource: rejects an unknown delivered path", async () => {
  const project = mkProject([E1], [DOC1]);
  const uri = deliveredUri("platform-arch", "reference/missing.md");
  await assertRejects(
    () => readResource(uri, project),
    Error,
    "delivered document not found",
  );
});

function gatedProject(): Project {
  return {
    projectRoot: undefined,
    markspecDetected: false,
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

Deno.test("readResource: returns soft-gate text when markspecDetected=false", async () => {
  const project = gatedProject();
  const result = await readResource("markspec://entries", project);
  assertEquals(result.mimeType, "text/plain");
  assertEquals(result.text, "No MarkSpec project found (mock)");
});

Deno.test("readResource: soft-gate fires for any URI when gated", async () => {
  const project = gatedProject();
  const result = await readResource("markspec://entry/STK_0001", project);
  assertEquals(result.text, "No MarkSpec project found (mock)");
});

Deno.test("readResource: soft-gate fires for a delivered URI when gated", async () => {
  const project = gatedProject();
  const uri = deliveredUri("platform-arch", "reference/platform.md");
  const result = await readResource(uri, project);
  assertEquals(result.text, "No MarkSpec project found (mock)");
});

Deno.test("listResourceDescriptors: returns empty list when gated", async () => {
  const project = gatedProject();
  const list = await listResourceDescriptors(project);
  assertEquals(list, []);
});
