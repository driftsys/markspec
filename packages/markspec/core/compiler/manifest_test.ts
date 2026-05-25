import { assertEquals, assertExists } from "@std/assert";
import { buildManifest } from "./manifest.ts";
import { makeDisplayId } from "../model/mod.ts";
import type { CompileResult } from "./mod.ts";
import type { DisplayId, Entry, Link, ProjectConfig } from "../model/mod.ts";

function makeEntry(displayId: string, type?: string): Entry {
  return {
    displayId: makeDisplayId(displayId),
    title: `Title for ${displayId}`,
    body: "",
    rawAttributes: [],
    id: undefined,
    type,
    shape: "Authored",
    location: { file: "test.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    typedAttributes: new Map(),
    bodyTokens: [],
  };
}

function makeLink(from: string, to: string): Link {
  return {
    from: makeDisplayId(from),
    to: makeDisplayId(to),
    kind: "satisfies",
    location: { file: "test.md", line: 1, column: 1 },
  };
}

const BASE_CONFIG: ProjectConfig = {
  name: "test-project",
  version: "1.0.0",
  labels: [],
  parents: [],
  parentFallback: "https://example.com",
  captionConventions: {},
};

function makeResult(
  entries: Entry[],
  links: Link[],
): CompileResult {
  const entryMap = new Map(entries.map((e) => [e.displayId, e]));
  const forward = new Map<DisplayId, Link[]>();
  const reverse = new Map<DisplayId, Link[]>();
  for (const link of links) {
    if (!forward.has(link.from)) forward.set(link.from, []);
    forward.get(link.from)!.push(link);
    if (!reverse.has(link.to)) reverse.set(link.to, []);
    reverse.get(link.to)!.push(link);
  }
  return {
    entries: entryMap,
    links,
    forward,
    reverse,
    documents: new Map(),
    diagnostics: [],
    typeRegistry: { bindings: new Map(), typedefs: new Map() },
  };
}

Deno.test("buildManifest: markspecSchemaVersion is 1", () => {
  const result = makeResult([], []);
  const manifest = buildManifest(
    result,
    BASE_CONFIG,
    "/project/root",
    undefined,
    "0.4.0",
  );
  assertEquals(manifest.markspecSchemaVersion, 1);
});

Deno.test("buildManifest: generator block", () => {
  const result = makeResult([], []);
  const manifest = buildManifest(
    result,
    BASE_CONFIG,
    "/project/root",
    undefined,
    "0.4.0",
  );
  assertEquals(manifest.generator.release, "0.4.0");
  assertEquals(manifest.generator.coreSchema, 1);
});

Deno.test("buildManifest: project block from config and projectRoot", () => {
  const result = makeResult([], []);
  const manifest = buildManifest(
    result,
    BASE_CONFIG,
    "/my/project",
    undefined,
    "0.4.0",
  );
  assertEquals(manifest.project.name, "test-project");
  assertEquals(manifest.project.root, "/my/project");
});

Deno.test("buildManifest: counts.entries matches result.entries.size", () => {
  const entries = [
    makeEntry("STK_0001"),
    makeEntry("STK_0002"),
    makeEntry("SRS_0001"),
  ];
  const result = makeResult(entries, []);
  const manifest = buildManifest(
    result,
    BASE_CONFIG,
    "/project",
    undefined,
    "0.4.0",
  );
  assertEquals(manifest.counts.entries, 3);
});

Deno.test("buildManifest: counts.edges matches result.links.length", () => {
  const entries = [makeEntry("STK_0001"), makeEntry("STK_0002")];
  const link = makeLink("STK_0002", "STK_0001");
  const result = makeResult(entries, [link]);
  const manifest = buildManifest(
    result,
    BASE_CONFIG,
    "/project",
    undefined,
    "0.4.0",
  );
  assertEquals(manifest.counts.edges, 1);
});

Deno.test("buildManifest: counts.byType groups by entry.type", () => {
  const entries = [
    makeEntry("STK_0001", "stakeholder-requirement"),
    makeEntry("STK_0002", "stakeholder-requirement"),
    makeEntry("SRS_0001", "software-requirement"),
    makeEntry("TST_0001", undefined),
  ];
  const result = makeResult(entries, []);
  const manifest = buildManifest(
    result,
    BASE_CONFIG,
    "/project",
    undefined,
    "0.4.0",
  );
  assertEquals(manifest.counts.byType["stakeholder-requirement"], 2);
  assertEquals(manifest.counts.byType["software-requirement"], 1);
  assertEquals(manifest.counts.byType["unknown"], 1);
});

Deno.test("buildManifest: entries indirection block is degenerate form", () => {
  const result = makeResult([], []);
  const manifest = buildManifest(
    result,
    BASE_CONFIG,
    "/project",
    undefined,
    "0.4.0",
  );
  assertEquals(manifest.entries.format, "inline");
  assertEquals(manifest.entries.file, "compiled.json");
});

Deno.test("buildManifest: edges indirection block is degenerate form", () => {
  const result = makeResult([], []);
  const manifest = buildManifest(
    result,
    BASE_CONFIG,
    "/project",
    undefined,
    "0.4.0",
  );
  assertEquals(manifest.edges.format, "inline");
  assertEquals(manifest.edges.file, "compiled.json");
});

Deno.test("buildManifest: sqliteMirror is null", () => {
  const result = makeResult([], []);
  const manifest = buildManifest(
    result,
    BASE_CONFIG,
    "/project",
    undefined,
    "0.4.0",
  );
  assertEquals(manifest.sqliteMirror, null);
});

Deno.test("buildManifest: federation from config.parents", () => {
  const config: ProjectConfig = {
    ...BASE_CONFIG,
    parents: [
      "https://upstream.example.com/api",
      "https://other.example.com/api",
    ],
  };
  const result = makeResult([], []);
  const manifest = buildManifest(
    result,
    config,
    "/project",
    undefined,
    "0.4.0",
  );
  assertEquals(manifest.federation, [
    "https://upstream.example.com/api",
    "https://other.example.com/api",
  ]);
});

Deno.test("buildManifest: federation is empty array when no parents", () => {
  const result = makeResult([], []);
  const manifest = buildManifest(
    result,
    BASE_CONFIG,
    "/project",
    undefined,
    "0.4.0",
  );
  assertEquals(manifest.federation, []);
});

Deno.test("buildManifest: reserved is empty object", () => {
  const result = makeResult([], []);
  const manifest = buildManifest(
    result,
    BASE_CONFIG,
    "/project",
    undefined,
    "0.4.0",
  );
  assertExists(manifest.reserved);
  assertEquals(Object.keys(manifest.reserved).length, 0);
});

Deno.test("buildManifest: project.name is empty string when config.name is empty", () => {
  const config: ProjectConfig = { ...BASE_CONFIG, name: "" };
  const result = makeResult([], []);
  const manifest = buildManifest(
    result,
    config,
    "/project",
    undefined,
    "0.4.0",
  );
  assertEquals(manifest.project.name, "");
});
