/**
 * @module mcp/tools/search_test
 *
 * Unit tests for the entry_search ranking algorithm and Markdown render.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Entry } from "../../core/mod.ts";
import { makeDisplayId } from "../../core/mod.ts";
import { renderSearchResults, scoreEntries } from "./search.ts";

function mk(displayId: string, title: string): Entry {
  return {
    displayId: makeDisplayId(displayId),
    title,
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "/proj/x.md", line: 1, column: 1 },
    source: "markdown",
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
