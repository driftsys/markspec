/**
 * @module reporter/mod_test
 *
 * Unit tests for the reporter module — traceability matrix, coverage
 * computation, CSV escaping, scope filtering, and empty-input guards.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { report } from "./mod.ts";
import type { CompileResult } from "../compiler/mod.ts";
import type { DisplayId, Entry, Link } from "../model/mod.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Build a minimal Entry for use in tests. */
function makeEntry(
  id: string,
  title: string,
  opts: {
    file?: string;
    type?: string;
    labels?: string;
    origin?: { profileId: string; profileVersion: string };
  } = {},
): Entry {
  const rawAttributes: Array<{ key: string; value: string }> = [];
  if (opts.labels) {
    rawAttributes.push({ key: "Labels", value: opts.labels });
  }
  return {
    displayId: id as DisplayId,
    title,
    shape: "Authored" as const,
    source: { kind: "markdown" } as const,
    location: { file: opts.file ?? "test.md", line: 1, column: 1 },
    body: "",
    rawAttributes,
    typedAttributes: new Map(),
    type: opts.type,
    bodyTokens: [],
    origin: opts.origin
      ? {
        kind: "profile" as const,
        profileId: opts.origin.profileId,
        profileVersion: opts.origin.profileVersion,
      }
      : undefined,
  };
}

/** Build a Link between two entries. */
function makeLink(
  from: string,
  to: string,
  kind: Link["kind"] = "satisfies",
): Link {
  return {
    from: from as DisplayId,
    to: to as DisplayId,
    kind,
    location: { file: "test.md", line: 1, column: 1 },
  };
}

/** Build a CompileResult from a list of entries and links. */
function makeResult(
  entries: Entry[],
  links: Link[] = [],
): CompileResult {
  const entriesMap = new Map<DisplayId, Entry>(
    entries.map((e) => [e.displayId, e]),
  );
  const forward = new Map<DisplayId, readonly Link[]>();
  const reverse = new Map<DisplayId, readonly Link[]>();

  for (const link of links) {
    const fwd = forward.get(link.from) ?? [];
    forward.set(link.from, [...fwd, link]);
    const rev = reverse.get(link.to) ?? [];
    reverse.set(link.to, [...rev, link]);
  }

  return {
    entries: entriesMap,
    links,
    forward,
    reverse,
    documents: new Map(),
    diagnostics: [],
    typeRegistry: { bindings: new Map(), typedefs: new Map() },
  };
}

// ---------------------------------------------------------------------------
// CSV escape tests
// ---------------------------------------------------------------------------

Deno.test("reporter CSV: entry with comma in title is double-quoted", () => {
  const result = makeResult([
    makeEntry("REQ_001", "Brake system, primary"),
  ]);
  const output = report(result, { kind: "traceability", format: "csv" });
  assertStringIncludes(output, '"Brake system, primary"');
});

Deno.test("reporter CSV: entry with double-quote in title uses doubled quotes", () => {
  const result = makeResult([
    makeEntry("REQ_001", 'The "main" system'),
  ]);
  const output = report(result, { kind: "traceability", format: "csv" });
  assertStringIncludes(output, '"The ""main"" system"');
});

Deno.test("reporter CSV: entry with leading/trailing whitespace preserves whitespace", () => {
  const result = makeResult([
    makeEntry("REQ_001", "  spaced title  "),
  ]);
  const output = report(result, { kind: "traceability", format: "csv" });
  // No special characters → not quoted; whitespace preserved verbatim
  assertStringIncludes(output, "  spaced title  ");
});

Deno.test("reporter CSV: entry with embedded newline in title is double-quoted", () => {
  const result = makeResult([
    makeEntry("REQ_001", "Title\nwith newline"),
  ]);
  const output = report(result, { kind: "traceability", format: "csv" });
  assertStringIncludes(output, '"Title\nwith newline"');
});

Deno.test("reporter CSV: entry with no special characters is not quoted", () => {
  const result = makeResult([
    makeEntry("REQ_001", "Plain title"),
  ]);
  const output = report(result, { kind: "traceability", format: "csv" });
  // Should appear without surrounding quotes
  assertStringIncludes(output, "REQ_001,Plain title,");
});

// ---------------------------------------------------------------------------
// Traceability matrix tests
// ---------------------------------------------------------------------------

Deno.test("reporter traceability md: A satisfies B — A row shows B in Satisfies column", () => {
  const a = makeEntry("SWE_001", "Software req A");
  const b = makeEntry("SYS_001", "System req B");
  const link = makeLink("SWE_001", "SYS_001");
  const result = makeResult([a, b], [link]);

  const output = report(result, { kind: "traceability", format: "md" });
  // A's row should have SYS_001 in the Satisfies column
  assertStringIncludes(output, "SWE_001");
  assertStringIncludes(output, "SYS_001");
  // The row for SWE_001 should reference SYS_001 as what it satisfies
  const aRow = output.split("\n").find((line) => line.includes("SWE_001"));
  assertStringIncludes(aRow ?? "", "SYS_001");
});

Deno.test("reporter traceability md: B shows A in Satisfied-by column (reverse link)", () => {
  const a = makeEntry("SWE_001", "Software req A");
  const b = makeEntry("SYS_001", "System req B");
  const link = makeLink("SWE_001", "SYS_001");
  const result = makeResult([a, b], [link]);

  const output = report(result, { kind: "traceability", format: "md" });
  // B's row (SYS_001) should have SWE_001 in the Satisfied-by column
  const bRow = output.split("\n").find((line) => line.includes("SYS_001"));
  assertStringIncludes(bRow ?? "", "SWE_001");
});

Deno.test("reporter traceability md: entry with no links shows em-dash in Satisfies", () => {
  const result = makeResult([
    makeEntry("STK_001", "Stakeholder req"),
  ]);
  const output = report(result, { kind: "traceability", format: "md" });
  // Em-dash (—) for empty Satisfies and Satisfied-by
  assertStringIncludes(output, "—");
});

Deno.test("reporter traceability md: header row is present", () => {
  const result = makeResult([makeEntry("REQ_001", "A requirement")]);
  const output = report(result, { kind: "traceability", format: "md" });
  assertStringIncludes(output, "ID");
  assertStringIncludes(output, "Title");
  assertStringIncludes(output, "Satisfies");
  assertStringIncludes(output, "Satisfied-by");
});

// ---------------------------------------------------------------------------
// Origin column (ADR-030): corpus provenance in the traceability matrix
// ---------------------------------------------------------------------------

Deno.test("reporter traceability md: corpus entry renders profileId@profileVersion in Origin column", () => {
  const entry = makeEntry("PLT_0001", "Platform core service", {
    origin: { profileId: "p", profileVersion: "1.0.0" },
  });
  const result = makeResult([entry]);

  const output = report(result, { kind: "traceability", format: "md" });

  assertStringIncludes(output, "Origin");
  const row = output.split("\n").find((line) => line.includes("PLT_0001"));
  assertStringIncludes(row ?? "", "p@1.0.0");
});

Deno.test("reporter traceability md: project entry renders 'project' in Origin column", () => {
  const entry = makeEntry("STK_0001", "Stakeholder req");
  const result = makeResult([entry]);

  const output = report(result, { kind: "traceability", format: "md" });

  const row = output.split("\n").find((line) => line.includes("STK_0001"));
  assertStringIncludes(row ?? "", "project");
});

Deno.test("reporter traceability csv: header includes Origin column between Type and Satisfies", () => {
  const result = makeResult([makeEntry("REQ_001", "A requirement")]);
  const output = report(result, { kind: "traceability", format: "csv" });
  assertStringIncludes(output, "ID,Title,Type,Origin,Satisfies,Satisfied-by");
});

Deno.test("reporter traceability csv: corpus entry row includes profileId@profileVersion", () => {
  const entry = makeEntry("PLT_0001", "Platform core service", {
    origin: { profileId: "p", profileVersion: "1.0.0" },
  });
  const result = makeResult([entry]);

  const output = report(result, { kind: "traceability", format: "csv" });

  const row = output.split("\n").find((line) => line.startsWith("PLT_0001,"));
  assertStringIncludes(row ?? "", ",p@1.0.0,");
});

Deno.test("reporter traceability csv: project entry row includes 'project'", () => {
  const result = makeResult([makeEntry("REQ_001", "A requirement")]);
  const output = report(result, { kind: "traceability", format: "csv" });
  const row = output.split("\n").find((line) => line.startsWith("REQ_001,"));
  assertStringIncludes(row ?? "", ",project,");
});

Deno.test("reporter traceability json: returns valid JSON array", () => {
  const a = makeEntry("REQ_001", "Requirement A");
  const b = makeEntry("REQ_002", "Requirement B");
  const link = makeLink("REQ_001", "REQ_002");
  const result = makeResult([a, b], [link]);

  const output = report(result, { kind: "traceability", format: "json" });
  const parsed = JSON.parse(output);
  assertEquals(Array.isArray(parsed), true);
  assertEquals(parsed.length, 2);
  const aRow = parsed.find(
    (r: { id: string }) => r.id === "REQ_001",
  );
  assertEquals(aRow?.satisfies, "REQ_002");
});

// ---------------------------------------------------------------------------
// Coverage computation tests
// ---------------------------------------------------------------------------

Deno.test("reporter coverage md: entry with outgoing satisfies is counted under With Satisfies", () => {
  // SWE_001 satisfies STK_001 — SWE_001 has outgoing link so it is NOT an orphan;
  // STK_001 has no outgoing link so it IS an orphan (no Satisfies of its own).
  const stk = makeEntry("STK_001", "Stakeholder req");
  const swe = makeEntry("SWE_001", "Software req");
  const link = makeLink("SWE_001", "STK_001");
  const result = makeResult([stk, swe], [link]);

  const output = report(result, { kind: "coverage", format: "md" });
  assertStringIncludes(output, "Coverage Report");
  // SWE_001 has outgoing Satisfies → With Satisfies: 1
  assertStringIncludes(output, "With Satisfies: 1");
  // STK_001 has no outgoing Satisfies → Without Satisfies: 1
  assertStringIncludes(output, "Without Satisfies (orphans): 1");
  // STK_001 appears in orphans list
  assertStringIncludes(output, "STK_001");
  // SWE_001 is NOT an orphan
  assertEquals(
    output.split("Orphan entries")[1]?.includes("SWE_001") ?? false,
    false,
  );
});

Deno.test("reporter coverage md: partial — some entries have no incoming links", () => {
  const stk = makeEntry("STK_001", "Stakeholder req");
  const swe = makeEntry("SWE_001", "Software req");
  // No links — swe is an orphan
  const result = makeResult([stk, swe], []);

  const output = report(result, { kind: "coverage", format: "md" });
  // Both entries have no satisfies link → both are orphans
  assertStringIncludes(output, "Orphan entries");
  assertStringIncludes(output, "STK_001");
  assertStringIncludes(output, "SWE_001");
});

Deno.test("reporter coverage md: 0% — no entries have incoming links", () => {
  const a = makeEntry("SYS_001", "System req");
  const b = makeEntry("SYS_002", "Another req");
  const result = makeResult([a, b], []);

  const output = report(result, { kind: "coverage", format: "md" });
  // The reporter uses bold Markdown: "- Without Satisfies (orphans): 2"
  assertStringIncludes(output, "Without Satisfies (orphans): 2");
});

Deno.test("reporter coverage json: stats include total and byType", () => {
  const a = makeEntry("REQ_001", "A", { type: "Requirement" });
  const b = makeEntry("REQ_002", "B", { type: "Requirement" });
  const result = makeResult([a, b], []);

  const output = report(result, { kind: "coverage", format: "json" });
  const parsed = JSON.parse(output);
  assertEquals(parsed.total, 2);
  assertEquals(typeof parsed.byType, "object");
  assertEquals(parsed.byType["Requirement"], 2);
});

Deno.test("reporter coverage csv: contains Metric,Value header", () => {
  const result = makeResult([makeEntry("REQ_001", "A requirement")]);
  const output = report(result, { kind: "coverage", format: "csv" });
  assertStringIncludes(output, "Metric,Value");
  assertStringIncludes(output, "Total entries,1");
});

// ---------------------------------------------------------------------------
// Scope filter tests
// ---------------------------------------------------------------------------

Deno.test("reporter scope filter: SYS prefix with underscores matches 'SYS' scope", () => {
  const sys = makeEntry("SYS_AEB_0001", "System req");
  const swe = makeEntry("SWE_AEB_0001", "Software req");
  const result = makeResult([sys, swe], []);

  const output = report(result, {
    kind: "traceability",
    format: "md",
    scope: "SYS",
  });
  assertStringIncludes(output, "SYS_AEB_0001");
  // SWE entry should be filtered out
  assertEquals(output.includes("SWE_AEB_0001"), false);
});

Deno.test("reporter scope filter: hyphenated IDs also match scope correctly", () => {
  const req = makeEntry("REQ-001", "A requirement");
  const sys = makeEntry("SYS_001", "A system req");
  const result = makeResult([req, sys], []);

  const output = report(result, {
    kind: "coverage",
    format: "md",
    scope: "SYS",
  });
  // REQ-001 should not match 'SYS' scope
  assertEquals(output.includes("REQ-001"), false);
  // SYS_001 should match — use bold Markdown format
  assertStringIncludes(output, "**Total entries:** 1");
});

Deno.test("reporter scope filter: REQ hyphen IDs not filtered by SYS scope", () => {
  const req001 = makeEntry("REQ-001", "Req one");
  const req002 = makeEntry("REQ-002", "Req two");
  const result = makeResult([req001, req002], []);

  const output = report(result, {
    kind: "traceability",
    format: "md",
    scope: "SYS",
  });
  // Neither REQ-001 nor REQ-002 matches the SYS scope
  assertEquals(output.includes("REQ-001"), false);
  assertEquals(output.includes("REQ-002"), false);
  // No data rows → just the header + separator
  const lines = output.split("\n").filter((l) => l.trim().startsWith("|"));
  // Only header + separator rows (2 lines), no data rows
  assertEquals(lines.length, 2);
});

// ---------------------------------------------------------------------------
// Empty input tests
// ---------------------------------------------------------------------------

Deno.test("reporter traceability md: empty input produces only header (no crash)", () => {
  const result = makeResult([]);
  const output = report(result, { kind: "traceability", format: "md" });
  // Should produce a valid Markdown table header and separator, but no data rows
  assertStringIncludes(output, "ID");
  assertStringIncludes(output, "Satisfies");
  // Should not crash
  const lines = output.split("\n").filter((l) => l.trim().startsWith("|"));
  // Only header + separator, no data rows
  assertEquals(lines.length, 2);
});

Deno.test("reporter traceability json: empty input produces empty array", () => {
  const result = makeResult([]);
  const output = report(result, { kind: "traceability", format: "json" });
  const parsed = JSON.parse(output);
  assertEquals(parsed, []);
});

Deno.test("reporter coverage md: empty input produces report with zero totals", () => {
  const result = makeResult([]);
  const output = report(result, { kind: "coverage", format: "md" });
  assertStringIncludes(output, "Coverage Report");
  assertStringIncludes(output, "**Total entries:** 0");
});

Deno.test("reporter coverage json: empty input produces zero-count stats", () => {
  const result = makeResult([]);
  const output = report(result, { kind: "coverage", format: "json" });
  const parsed = JSON.parse(output);
  assertEquals(parsed.total, 0);
  assertEquals(parsed.withSatisfies, 0);
  assertEquals(parsed.withoutSatisfies, 0);
});
