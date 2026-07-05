/**
 * @module lsp/code_lens_test
 *
 * Unit tests for {@linkcode buildCodeLenses} — pure helper that emits
 * the `CodeLens[]` payload for `textDocument/codeLens`.
 */

import { assertEquals } from "@std/assert";
import { buildCodeLenses } from "./code_lens.ts";
import type { Attribute, DisplayId, Entry, Ulid } from "../core/mod.ts";

/** Fixture: a minimal Entry with the fields the helper reads. */
function fakeEntry(opts: {
  displayId: string;
  title: string;
  file: string;
  line: number;
  satisfies?: string;
}): Entry {
  const attrs: Attribute[] = [];
  if (opts.satisfies !== undefined) {
    // NB: deviation from prompt — the current `Attribute` shape carries
    // only {key, value}; the prompt's fixture included a `location` field
    // the type does not have. The helper never reads it, so dropping it
    // is semantically equivalent.
    attrs.push({
      key: "Satisfies",
      value: opts.satisfies,
    });
  }
  return {
    shape: "Authored",
    displayId: opts.displayId as DisplayId,
    title: opts.title,
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF" as Ulid,
    body: "",
    rawAttributes: attrs,
    typedAttributes: new Map(),
    type: undefined,
    location: { file: opts.file, line: opts.line, column: 1 },
    labels: [],
    // deno-lint-ignore no-explicit-any
  } as any;
}

/** Identity URI resolver — keeps test assertions readable. */
const idUri = (path: string): string => `file://${path}`;

Deno.test("buildCodeLenses: empty input returns empty array", () => {
  assertEquals(buildCodeLenses([], [], idUri), []);
});

Deno.test("buildCodeLenses: entry with no dependents and no Satisfies emits no lenses", () => {
  const entry = fakeEntry({
    displayId: "STK_001",
    title: "Lonely entry",
    file: "/proj/r.md",
    line: 1,
  });
  assertEquals(buildCodeLenses([entry], [entry], idUri), []);
});

Deno.test("buildCodeLenses: entry with 1 dependent yields singular '1 dependent' lens", () => {
  const target = fakeEntry({
    displayId: "STK_001",
    title: "Target",
    file: "/proj/r.md",
    line: 1,
  });
  const child = fakeEntry({
    displayId: "SAD_001",
    title: "Child",
    file: "/proj/r.md",
    line: 10,
    satisfies: "STK_001",
  });
  const allEntries = [target, child];
  const lenses = buildCodeLenses([target], allEntries, idUri);
  const depLens = lenses.find((l) => l.command?.title.startsWith("↑"));
  assertEquals(depLens?.command?.title, "↑ 1 dependent");
  assertEquals(depLens?.command?.command, "markspec.openReferences");
  assertEquals(depLens?.command?.arguments, [
    "file:///proj/r.md",
    { line: 0, character: 0 },
    [{ uri: "file:///proj/r.md", line: 9, character: 0 }],
  ]);
});

Deno.test("buildCodeLenses: entry with N>1 dependents yields plural lens", () => {
  const target = fakeEntry({
    displayId: "STK_001",
    title: "Target",
    file: "/proj/r.md",
    line: 1,
  });
  const a = fakeEntry({
    displayId: "SAD_A",
    title: "A",
    file: "/proj/r.md",
    line: 10,
    satisfies: "STK_001",
  });
  const b = fakeEntry({
    displayId: "SAD_B",
    title: "B",
    file: "/proj/r.md",
    line: 20,
    satisfies: "STK_001",
  });
  const lenses = buildCodeLenses([target], [target, a, b], idUri);
  const depLens = lenses.find((l) => l.command?.title.startsWith("↑"));
  assertEquals(depLens?.command?.title, "↑ 2 dependents");
  assertEquals(depLens?.command?.arguments?.[2], [
    { uri: "file:///proj/r.md", line: 9, character: 0 },
    { uri: "file:///proj/r.md", line: 19, character: 0 },
  ]);
});

Deno.test("buildCodeLenses: dependent lens locations resolve across files", () => {
  const target = fakeEntry({
    displayId: "XREQ_001",
    title: "Target",
    file: "/proj/xreq.md",
    line: 5,
  });
  const child = fakeEntry({
    displayId: "FREQ_001",
    title: "Child",
    file: "/proj/freq.md",
    line: 20,
    satisfies: "XREQ_001",
  });
  const lenses = buildCodeLenses([target], [target, child], idUri);
  const depLens = lenses.find((l) => l.command?.title.startsWith("↑"));
  assertEquals(depLens?.command?.arguments, [
    "file:///proj/xreq.md",
    { line: 4, character: 0 },
    [{ uri: "file:///proj/freq.md", line: 19, character: 0 }],
  ]);
});

Deno.test("buildCodeLenses: entry with Satisfies to resolved target emits '↓ Satisfies: ID — Title'", () => {
  const target = fakeEntry({
    displayId: "STK_001",
    title: "Target requirement",
    file: "/proj/r.md",
    line: 1,
  });
  const child = fakeEntry({
    displayId: "SAD_001",
    title: "Child",
    file: "/proj/r.md",
    line: 10,
    satisfies: "STK_001",
  });
  const lenses = buildCodeLenses([child], [target, child], idUri);
  const satLens = lenses.find((l) => l.command?.title.startsWith("↓"));
  assertEquals(
    satLens?.command?.title,
    "↓ Satisfies: STK_001 — Target requirement",
  );
  assertEquals(satLens?.command?.command, "markspec.openDefinition");
  assertEquals(satLens?.command?.arguments, [
    "file:///proj/r.md",
    { line: 0, character: 0 },
  ]);
});

Deno.test("buildCodeLenses: entry with Satisfies to unresolved ID emits lens with ID only", () => {
  const child = fakeEntry({
    displayId: "SAD_001",
    title: "Child",
    file: "/proj/r.md",
    line: 10,
    satisfies: "MISSING_999",
  });
  const lenses = buildCodeLenses([child], [child], idUri);
  const satLens = lenses.find((l) => l.command?.title.startsWith("↓"));
  assertEquals(satLens?.command?.title, "↓ Satisfies: MISSING_999");
  assertEquals(satLens?.command?.command, "markspec.openDefinition");
  assertEquals(satLens?.command?.arguments, []);
});

Deno.test("buildCodeLenses: entry with multiple Satisfies values yields one lens each", () => {
  const targetA = fakeEntry({
    displayId: "STK_A",
    title: "A",
    file: "/proj/r.md",
    line: 1,
  });
  const targetB = fakeEntry({
    displayId: "STK_B",
    title: "B",
    file: "/proj/r.md",
    line: 2,
  });
  const child = fakeEntry({
    displayId: "SAD_001",
    title: "Child",
    file: "/proj/r.md",
    line: 10,
    satisfies: "STK_A, STK_B",
  });
  const lenses = buildCodeLenses([child], [targetA, targetB, child], idUri);
  const satLenses = lenses.filter((l) => l.command?.title.startsWith("↓"));
  assertEquals(satLenses.length, 2);
  assertEquals(satLenses[0].command?.title, "↓ Satisfies: STK_A — A");
  assertEquals(satLenses[1].command?.title, "↓ Satisfies: STK_B — B");
});

// --- upstream entries (#783) ---
//
// Federated-upstream entries carry a tree-relative location.file (e.g.
// "docs/x.md") — pathToUri (@std/path toFileUrl, or any well-behaved
// implementation) cannot convert a relative path. This stub THROWS on a
// relative path, so any of these tests would fail if an unguarded relative
// path reached it — the linchpin proving no relative path reaches
// pathToUri at all.
const throwingPathToUri = (p: string): string => {
  if (!p.startsWith("/")) {
    throw new Error(`relative path reached pathToUri: ${p}`);
  }
  return "file://" + p;
};

/** Build an upstream-origin fixture on top of {@linkcode fakeEntry}. */
function fakeUpstreamEntry(opts: {
  displayId: string;
  title: string;
  file: string;
  line: number;
  satisfies?: string;
}): Entry {
  return {
    ...fakeEntry(opts),
    origin: { kind: "upstream", upstreamId: "product", version: "v1" },
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("buildCodeLenses: local entry Satisfies an upstream target — no throw, non-clickable Satisfies lens keeps the resolved title", () => {
  const upstreamTarget = fakeUpstreamEntry({
    displayId: "PRODUCT_SYS_0001",
    title: "Upstream target",
    file: "docs/x.md",
    line: 1,
  });
  const child = fakeEntry({
    displayId: "SAD_001",
    title: "Child",
    file: "/proj/r.md",
    line: 10,
    satisfies: "PRODUCT_SYS_0001",
  });
  const lenses = buildCodeLenses(
    [child],
    [upstreamTarget, child],
    throwingPathToUri,
  );
  const satLens = lenses.find((l) => l.command?.title.startsWith("↓"));
  assertEquals(
    satLens?.command?.title,
    "↓ Satisfies: PRODUCT_SYS_0001 — Upstream target",
  );
  assertEquals(satLens?.command?.arguments, []);
});

Deno.test("buildCodeLenses: upstream entry among dependents is excluded from dependents referenceLocations (no throw)", () => {
  const target = fakeEntry({
    displayId: "STK_001",
    title: "Target",
    file: "/proj/r.md",
    line: 1,
  });
  const upstreamDependent = fakeUpstreamEntry({
    displayId: "PRODUCT_SYS_0002",
    title: "Upstream child",
    file: "docs/x.md",
    line: 5,
    satisfies: "STK_001",
  });
  const localDependent = fakeEntry({
    displayId: "SAD_001",
    title: "Local child",
    file: "/proj/r.md",
    line: 10,
    satisfies: "STK_001",
  });
  const lenses = buildCodeLenses(
    [target],
    [target, upstreamDependent, localDependent],
    throwingPathToUri,
  );
  const depLens = lenses.find((l) => l.command?.title.startsWith("↑"));
  // referenceLocations excludes the upstream dependent; depCount (a
  // display count from incomingCount) still counts both, per the brief's
  // documented acceptable mismatch.
  assertEquals(depLens?.command?.arguments?.[2], [
    { uri: "file:///proj/r.md", line: 9, character: 0 },
  ]);
});

Deno.test("buildCodeLenses: multiple entries each get their own lens set", () => {
  const a = fakeEntry({
    displayId: "STK_A",
    title: "A",
    file: "/proj/r.md",
    line: 1,
  });
  const b = fakeEntry({
    displayId: "SAD_B",
    title: "B",
    file: "/proj/r.md",
    line: 10,
    satisfies: "STK_A",
  });
  const lenses = buildCodeLenses([a, b], [a, b], idUri);
  assertEquals(lenses.length, 2);
  const aLens = lenses.find((l) => l.range.start.line === 0);
  assertEquals(aLens?.command?.title, "↑ 1 dependent");
  const bLens = lenses.find((l) => l.range.start.line === 9);
  assertEquals(bLens?.command?.title, "↓ Satisfies: STK_A — A");
});
