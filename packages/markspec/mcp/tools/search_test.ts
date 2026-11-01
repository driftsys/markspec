/**
 * @module mcp/tools/search_test
 *
 * Unit tests for the entry_search ranking algorithm and Markdown render.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Entry } from "../../core/mod.ts";
import { makeDisplayId } from "../../core/mod.ts";
import {
  ENTRY_SEARCH_DESCRIPTOR,
  rankAcrossProjects,
  renderProjectSearchResults,
  renderSearchResults,
  scoreEntries,
} from "./search.ts";

function mk(displayId: string, title: string): Entry {
  return {
    displayId: makeDisplayId(displayId),
    title,
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "/proj/x.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  };
}

Deno.test("scoreEntries: prefix match on displayId scores highest", () => {
  const hits = scoreEntries(
    [mk("STK_AEB_0001", "Brake"), mk("XYZ_AEB_0001", "Braking sensor")],
    "stk_aeb",
    10,
  );
  assertEquals(hits[0].entry.displayId, "STK_AEB_0001");
});

Deno.test("scoreEntries: substring match on displayId beats title", () => {
  const hits = scoreEntries(
    [mk("FOO_BAR_0001", "Unrelated"), mk("XXX_AEB_0001", "Aeb in title")],
    "aeb",
    10,
  );
  assertEquals(hits[0].entry.displayId, "XXX_AEB_0001");
});

Deno.test("scoreEntries: token coverage in title scores", () => {
  const hits = scoreEntries(
    [
      mk("X_0001", "Apply continuous braking force"),
      mk("X_0002", "Sensor debouncing"),
    ],
    "braking",
    10,
  );
  assertEquals(hits[0].entry.displayId, "X_0001");
});

Deno.test("scoreEntries: drops zero-score entries", () => {
  const hits = scoreEntries(
    [mk("X_0001", "Sensor debouncing"), mk("X_0002", "Braking force")],
    "braking",
    10,
  );
  assertEquals(hits.length, 1);
  assertEquals(hits[0].entry.displayId, "X_0002");
});

Deno.test("scoreEntries: respects limit", () => {
  const entries = Array.from(
    { length: 30 },
    (_, i) => mk(`X_${String(i).padStart(4, "0")}`, `Braking ${i}`),
  );
  const hits = scoreEntries(entries, "braking", 5);
  assertEquals(hits.length, 5);
});

Deno.test("renderSearchResults: empty hits message", () => {
  const md = renderSearchResults([], "nope");
  assertStringIncludes(md, "No matches for");
});

Deno.test("renderSearchResults: links each hit", () => {
  const md = renderSearchResults(
    [
      { entry: mk("STK_AEB_0001", "Stop on collision"), score: 11 },
      { entry: mk("VAL_AEB_0001", "Vehicle stops"), score: 6 },
    ],
    "braking",
  );
  assertStringIncludes(
    md,
    "[STK_AEB_0001](markspec://entry/STK_AEB_0001) — Stop on collision",
  );
  assertStringIncludes(md, "score 11");
});

Deno.test("ENTRY_SEARCH_DESCRIPTOR.description: has TRIGGER/PREFER/SKIP blocks", () => {
  const desc = ENTRY_SEARCH_DESCRIPTOR.description;
  assertStringIncludes(desc, "TRIGGER when:");
  assertStringIncludes(desc, "PREFER over:");
  assertStringIncludes(desc, "SKIP when:");
});

Deno.test("ENTRY_SEARCH_DESCRIPTOR.description: names user-facing nouns", () => {
  const desc = ENTRY_SEARCH_DESCRIPTOR.description;
  assertStringIncludes(desc, "requirements");
  assertStringIncludes(desc, "specifications");
  assertStringIncludes(desc, "ICD");
});

Deno.test("ENTRY_SEARCH_DESCRIPTOR.description: names anti-fallback tools", () => {
  const desc = ENTRY_SEARCH_DESCRIPTOR.description;
  assertStringIncludes(desc, "grep");
});

Deno.test("ENTRY_SEARCH_DESCRIPTOR.description: keys on canonical soft-gate phrase", () => {
  assertStringIncludes(
    ENTRY_SEARCH_DESCRIPTOR.description,
    "No MarkSpec project found",
  );
});

Deno.test("rankAcrossProjects: keeps the best hits of all projects, in total", () => {
  const a = scoreEntries([mk("A_0001", "Brakings")], "braking", 10);
  const b = scoreEntries(
    [mk("B_0001", "Braking"), mk("B_0002", "Braking force")],
    "braking",
    10,
  );
  const c = scoreEntries([mk("C_0001", "Braking")], "braking", 10);
  const ranked = rankAcrossProjects(
    [{ label: "a", hits: a }, { label: "b", hits: b }, {
      label: "c",
      hits: c,
    }],
    3,
  );
  // a's hit scores lowest and loses although its project comes first;
  // b's hits tie with c's and project order breaks the tie.
  assertEquals(
    ranked.map(({ label, hit }) => `${label}:${hit.entry.displayId}`),
    ["b:B_0001", "b:B_0002", "c:C_0001"],
  );
});

Deno.test("rankAcrossProjects: orders by score, not by project", () => {
  const a = scoreEntries([mk("A_0001", "Brakings")], "braking", 10);
  const b = scoreEntries([mk("B_0001", "Braking")], "braking", 10);
  const ranked = rankAcrossProjects(
    [{ label: "a", hits: a }, { label: "b", hits: b }],
    10,
  );
  assertEquals(ranked.map(({ label }) => label), ["b", "a"]);
});

Deno.test("renderProjectSearchResults: tags each hit and lists errors after the hits", () => {
  const b = scoreEntries([mk("B_0001", "Braking")], "braking", 10);
  const text = renderProjectSearchResults(
    [{ label: "b", hit: b[0] }],
    "braking",
    [{ label: "a", message: "boom" }],
  );
  assertEquals(
    text,
    `# Search results for "braking" (1 match)\n\n- [B_0001](markspec://entry/B_0001) — Braking (project: b, score ${
      b[0].score
    })\n\nErrors:\n\n- Error in project a: boom\n`,
  );
});

Deno.test("renderProjectSearchResults: no hit and no error is the empty answer", () => {
  assertEquals(
    renderProjectSearchResults([], "x", []),
    renderSearchResults([], "x"),
  );
});

Deno.test("ENTRY_SEARCH_DESCRIPTOR: says the limit is the total across projects", () => {
  assertStringIncludes(
    ENTRY_SEARCH_DESCRIPTOR.description,
    "'limit' is the total number of matches across all projects",
  );
});
