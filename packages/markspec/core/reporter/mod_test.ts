/**
 * @module reporter/mod_test
 *
 * Unit tests for traceability matrix and coverage reports.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { report } from "./mod.ts";
import type { CompileResult } from "../compiler/mod.ts";
import type { Entry, Link } from "../model/mod.ts";

/** Build a minimal CompileResult for testing. */
function makeResult(
  entries: Entry[],
  links: Link[] = [],
): CompileResult {
  const entryMap = new Map(entries.map((e) => [e.displayId, e]));
  const forward = new Map<string, Link[]>();
  const reverse = new Map<string, Link[]>();
  for (const link of links) {
    if (!forward.has(link.from)) forward.set(link.from, []);
    forward.get(link.from)!.push(link);
    if (!reverse.has(link.to)) reverse.set(link.to, []);
    reverse.get(link.to)!.push(link);
  }
  return { entries: entryMap, links, forward, reverse, diagnostics: [] };
}

function entry(id: string, type?: string, attrs: { key: string; value: string }[] = []): Entry {
  return {
    displayId: id,
    title: `Title of ${id}`,
    body: "Body.",
    attributes: attrs,
    id: type ? `${type}_01HGW2Q8MNP3` : undefined,
    entryType: type,
    location: { file: "test.md", line: 1, column: 1 },
    source: "markdown",
  };
}

const loc = { file: "test.md", line: 1, column: 1 };

// ---------------------------------------------------------------------------
// Traceability matrix
// ---------------------------------------------------------------------------

Deno.test("report: traceability matrix with links", () => {
  const sys = entry("SYS_BRK_0042", "SYS");
  const srs = entry("SRS_BRK_0001", "SRS");
  const link: Link = {
    from: "SRS_BRK_0001",
    to: "SYS_BRK_0042",
    kind: "satisfies",
    location: loc,
  };
  const result = makeResult([sys, srs], [link]);

  const output = report(result, { kind: "traceability", format: "md" });
  assertStringIncludes(output, "SYS_BRK_0042");
  assertStringIncludes(output, "SRS_BRK_0001");
  // SRS row should show Satisfies = SYS
  assertStringIncludes(output, "SYS_BRK_0042");
  // SYS row should show Satisfied-by = SRS
  const lines = output.split("\n");
  const sysRow = lines.find((l) => l.includes("SYS_BRK_0042"));
  assertStringIncludes(sysRow!, "SRS_BRK_0001");
});

Deno.test("report: traceability matrix entry with no links shows dashes", () => {
  const e = entry("SRS_BRK_0001", "SRS");
  const result = makeResult([e]);

  const output = report(result, { kind: "traceability", format: "md" });
  assertStringIncludes(output, "\u2014"); // em-dash for empty cells
});

Deno.test("report: traceability JSON format", () => {
  const e = entry("SRS_BRK_0001", "SRS");
  const result = makeResult([e]);

  const output = report(result, { kind: "traceability", format: "json" });
  const parsed = JSON.parse(output);
  assertEquals(Array.isArray(parsed), true);
  assertEquals(parsed[0].id, "SRS_BRK_0001");
});

Deno.test("report: traceability CSV format", () => {
  const e = entry("SRS_BRK_0001", "SRS");
  const result = makeResult([e]);

  const output = report(result, { kind: "traceability", format: "csv" });
  assertStringIncludes(output, "ID,Title,Type");
  assertStringIncludes(output, "SRS_BRK_0001");
});

// ---------------------------------------------------------------------------
// Coverage report
// ---------------------------------------------------------------------------

Deno.test("report: coverage with all entries covered", () => {
  const stk = entry("STK_BRK_0001", "STK");
  const sys = entry("SYS_BRK_0001", "SYS");
  const srs = entry("SRS_BRK_0001", "SRS");
  const links: Link[] = [
    { from: "SYS_BRK_0001", to: "STK_BRK_0001", kind: "satisfies", location: loc },
    { from: "SRS_BRK_0001", to: "SYS_BRK_0001", kind: "satisfies", location: loc },
  ];
  const result = makeResult([stk, sys, srs], links);

  const output = report(result, { kind: "coverage", format: "md" });
  assertStringIncludes(output, "Total entries:** 3");
  assertStringIncludes(output, "With Satisfies: 2");
});

Deno.test("report: coverage lists orphans", () => {
  const e = entry("SRS_BRK_0001", "SRS");
  const result = makeResult([e]);

  const output = report(result, { kind: "coverage", format: "md" });
  assertStringIncludes(output, "SRS_BRK_0001");
  assertStringIncludes(output, "Orphan");
});

Deno.test("report: coverage JSON format", () => {
  const e = entry("SRS_BRK_0001", "SRS");
  const result = makeResult([e]);

  const output = report(result, { kind: "coverage", format: "json" });
  const parsed = JSON.parse(output);
  assertEquals(parsed.total, 1);
  assertEquals(parsed.gaps.orphans.includes("SRS_BRK_0001"), true);
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

Deno.test("report: scope filter matches domain", () => {
  const brk = entry("SRS_BRK_0001", "SRS");
  const steer = entry("SRS_STEER_0001", "SRS");
  const result = makeResult([brk, steer]);

  const output = report(result, {
    kind: "traceability",
    format: "json",
    scope: "BRK",
  });
  const parsed = JSON.parse(output);
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].id, "SRS_BRK_0001");
});

Deno.test("report: label filter matches entry labels", () => {
  const a = entry("SRS_BRK_0001", "SRS", [
    { key: "Id", value: "SRS_01HGW2Q8MNP3" },
    { key: "Labels", value: "ASIL-B" },
  ]);
  const b = entry("SRS_BRK_0002", "SRS", [
    { key: "Id", value: "SRS_01HGW2R9QLP4" },
    { key: "Labels", value: "ASIL-D" },
  ]);
  const result = makeResult([a, b]);

  const output = report(result, {
    kind: "traceability",
    format: "json",
    label: "ASIL-B",
  });
  const parsed = JSON.parse(output);
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].id, "SRS_BRK_0001");
});
