/**
 * @module core/gates/mod_test
 *
 * Unit tests for the composite-`check` gate stages (#659). The gates are pure
 * functions over already-gathered inputs; these tests exercise each branch in
 * isolation. The end-to-end wiring (scope policy, merge order, `--strict`,
 * exit codes) is covered by `tests/e2e/check_project_test.ts`.
 */

import { assertEquals } from "@std/assert";
import { format } from "../formatter/mod.ts";
import { parseFile } from "../parser/mod.ts";
import {
  extractEdgeQuads,
  type GeneratedCache,
  hashCanonicalEdges,
  type Lockfile,
  parseLockfile,
  type ParseLockfileResult,
} from "../lock/mod.ts";
import { fmtDriftGate, lockfileDriftGate, proseLintGate } from "./mod.ts";

// ---------------------------------------------------------------------------
// fmtDriftGate
// ---------------------------------------------------------------------------

const CLEAN_REQ = `# Requirements

- [REQ-0001] Response time

  The system shall respond within 200 ms.

      Id: 01REQ000000000000000000001
      Type: Requirement
`;

Deno.test("fmtDriftGate: a formatter-clean file emits nothing", async () => {
  // Feed the formatter's own output back so it is clean by construction.
  const formatted = format(CLEAN_REQ, { file: "req.md" }).output;
  const parsed = await parseFile(formatted, { file: "req.md" });
  const diags = await fmtDriftGate(
    new Map([["req.md", formatted]]),
    parsed.entries,
    [],
    undefined,
  );
  assertEquals(diags, []);
});

Deno.test("fmtDriftGate: a file missing Id: fails with MSL-F010", async () => {
  const content = `# Doc

- [REQ-0002] Unformatted

  The system shall respond within 200 ms.

      Type: Requirement
`;
  const parsed = await parseFile(content, { file: "u.md" });
  const diags = await fmtDriftGate(
    new Map([["u.md", content]]),
    parsed.entries,
    [],
    undefined,
  );
  assertEquals(diags.some((d) => d.code === "MSL-F010"), true);
});

Deno.test("fmtDriftGate: a non-canonical ULID reference fails with MSL-F011, not F010", async () => {
  // REQ-0001 declares ULID 01REQ...001; SREQ-0001 references it *by ULID*.
  // The SREQ file is formatter-clean (no F010) but canonicalizeRefs would
  // rewrite the ULID to the display ID REQ-0001 (F011).
  const reqFormatted = format(CLEAN_REQ, { file: "req.md" }).output;
  const sreq = format(
    `# System Requirements

- [SREQ-0001] Derived response time

  The system shall forward responses within 100 ms.

      Id: 01SREQ00000000000000000001
      Type: Requirement
      Satisfies: 01REQ000000000000000000001
`,
    { file: "sreq.md" },
  ).output;

  const reqEntries = (await parseFile(reqFormatted, { file: "req.md" }))
    .entries;
  const sreqEntries = (await parseFile(sreq, { file: "sreq.md" })).entries;

  const diags = await fmtDriftGate(
    new Map([["sreq.md", sreq]]),
    [...reqEntries, ...sreqEntries],
    [],
    undefined,
  );
  assertEquals(diags.some((d) => d.code === "MSL-F011"), true);
  assertEquals(diags.some((d) => d.code === "MSL-F010"), false);
});

// ---------------------------------------------------------------------------
// lockfileDriftGate
// ---------------------------------------------------------------------------

/** Minimal intact lockfile carrying only the fields the gate reads. */
function lockfileWithCache(cache: GeneratedCache): Lockfile {
  return {
    schema: 1,
    meta: { markspecSchema: 1, lockedAt: "2026-01-01T00:00:00Z" },
    upstreams: [],
    boundEntries: [],
    edges: [],
    generatedCache: cache,
  };
}

const SATISFIES_GRAPH = `# Requirements

- [REQ-0001] Response time

  The system shall respond within 200 ms.

      Id: 01REQ000000000000000000001
      Type: Requirement

- [SREQ-0001] Derived response time

  The system shall forward responses within 100 ms.

      Id: 01SREQ00000000000000000001
      Type: Requirement
      Satisfies: REQ-0001
`;

Deno.test("lockfileDriftGate: a malformed lockfile surfaces the parser's diagnostics", async () => {
  const lockParse = parseLockfile("this is not toml {{{");
  assertEquals(lockParse.lockfile, undefined);
  assertEquals(lockParse.diagnostics.length > 0, true);
  const diags = await lockfileDriftGate(lockParse, "/x/markspec.lock", []);
  assertEquals(diags, [...lockParse.diagnostics]);
});

Deno.test("lockfileDriftGate: an in-sync lockfile emits nothing", async () => {
  const parsed = await parseFile(SATISFIES_GRAPH, { file: "reqs.md" });
  const quads = extractEdgeQuads(parsed.entries);
  const edgesHash = await hashCanonicalEdges(quads);
  const lockParse: ParseLockfileResult = {
    lockfile: lockfileWithCache({ edgesHash, edgesCount: quads.length }),
    diagnostics: [],
  };
  const diags = await lockfileDriftGate(
    lockParse,
    "/x/markspec.lock",
    parsed.entries,
  );
  assertEquals(diags, []);
});

Deno.test("lockfileDriftGate: a stale edge hash fails with MSL-L212 at the lockfile location", async () => {
  const parsed = await parseFile(SATISFIES_GRAPH, { file: "reqs.md" });
  const lockPath = "/x/markspec.lock";
  const lockParse: ParseLockfileResult = {
    // A hash that cannot match the real graph → drift.
    lockfile: lockfileWithCache({ edgesHash: "0".repeat(64), edgesCount: 0 }),
    diagnostics: [],
  };
  const diags = await lockfileDriftGate(lockParse, lockPath, parsed.entries);
  assertEquals(diags.length, 1);
  assertEquals(diags[0].code, "MSL-L212");
  assertEquals(diags[0].location?.file, lockPath);
});

// ---------------------------------------------------------------------------
// proseLintGate
// ---------------------------------------------------------------------------

Deno.test("proseLintGate: a vague requirement emits MSL-Q with the projected schema", async () => {
  // "as appropriate" is a vague quantifier — a Requirement-typed authored
  // entry is prose-scoped without a profile.
  const content = `# Doc

- [REQ-0003] Vague requirement

  The system shall respond as appropriate.

      Id: 01REQ000000000000000000003
      Type: Requirement
`;
  const parsed = await parseFile(content, { file: "vague.md" });
  const diags = await proseLintGate(parsed.entries, undefined);
  const q = diags.find((d) => d.code.startsWith("MSL-Q"));
  assertEquals(q !== undefined, true);
  // LintDiagnostic extras must not leak into the projected Diagnostic.
  assertEquals("slug" in q!, false);
  assertEquals("group" in q!, false);
  assertEquals("scoreContribution" in q!, false);
});
