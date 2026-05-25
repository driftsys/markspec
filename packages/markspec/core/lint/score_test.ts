/**
 * @module core/lint/score_test
 *
 * Unit tests for computeScoreRollup.
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";
import type { LintDiagnostic } from "./types.ts";
import { ANTI_PATTERN_NOTE, computeScoreRollup } from "./score.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeEntry(displayId: string, file = "/x.md"): Entry {
  return {
    displayId: makeDisplayId(displayId),
    title: "Test entry",
    body: "The system shall do something.",
    bodyAst: [],
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Type", value: "Requirement" },
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ["Type", ["Requirement"]],
    ]),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    type: "Requirement",
    shape: "Authored",
    location: { file, line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  } as unknown as Entry;
}

function fakeDiag(
  code: string,
  slug: string,
  weight: number,
  file: string,
  line = 1,
): LintDiagnostic {
  return {
    code,
    slug,
    group: "incose",
    severity: "warning",
    scoreContribution: weight,
    message: `${slug}: test`,
    location: { file, line, column: 1 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("score: per-entry score = Σ contributions", () => {
  const entry = fakeEntry("STK_0001");
  const diags = [
    fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/x.md"),
    fakeDiag("MSL-Q304", "incose-r9-open-ended", 1, "/x.md"),
  ];
  const roll = computeScoreRollup(diags, [entry]);
  assertEquals(roll.perEntry[0].score, 4);
  assertEquals(roll.perEntry[0].displayId, "STK_0001");
});

Deno.test("score: contributions sorted weight DESC, code ASC", () => {
  const entry = fakeEntry("STK_0001");
  const diags = [
    fakeDiag("MSL-Q304", "incose-r9-open-ended", 1, "/x.md"), // w=1
    fakeDiag("MSL-Q500", "xref-glossary-undefined", 3, "/x.md"), // w=3
    fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/x.md"), // w=3
  ];
  const roll = computeScoreRollup(diags, [entry]);
  const c = roll.perEntry[0].contributions;
  assertEquals(c[0].code, "MSL-Q302"); // weight 3, code-ASC tie → Q302
  assertEquals(c[1].code, "MSL-Q500"); // weight 3
  assertEquals(c[2].code, "MSL-Q304"); // weight 1
});

Deno.test("score: occurrences counts repeated firings", () => {
  const entry = fakeEntry("STK_0001");
  const diags = [
    fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/x.md"),
    fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/x.md"),
  ];
  const roll = computeScoreRollup(diags, [entry]);
  assertEquals(roll.perEntry[0].score, 6);
  assertEquals(roll.perEntry[0].contributions[0].occurrences, 2);
});

Deno.test("score: bandCounts cover all 5 bands always", () => {
  // 5 entries with scores 0, 2, 5, 9, 21 → bands 0:1, 1-3:1, 4-7:1, 8-15:1, 16+:1.
  const entries = ["STK_0001", "STK_0002", "STK_0003", "STK_0004", "STK_0005"]
    .map((id, i) => fakeEntry(id, `/${i}.md`));
  const diags: LintDiagnostic[] = [];
  // Entry 2 (file /1.md): score 2 (one w=2 fictional)
  diags.push(fakeDiag("MSL-QXXX", "fictional", 2, "/1.md"));
  // Entry 3 (file /2.md): score 5 (one w=3, two w=1)
  diags.push(fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/2.md"));
  diags.push(fakeDiag("MSL-Q304", "incose-r9-open-ended", 1, "/2.md"));
  diags.push(fakeDiag("MSL-Q304", "incose-r9-open-ended", 1, "/2.md"));
  // Entry 4 (file /3.md): score 9
  diags.push(fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/3.md"));
  diags.push(fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/3.md"));
  diags.push(fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/3.md"));
  // Entry 5 (file /4.md): score 21 (7 × 3)
  for (let k = 0; k < 7; k++) {
    diags.push(fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/4.md"));
  }
  // No diagnostics for entry 1 (file /0.md) → score 0.
  const roll = computeScoreRollup(diags, entries);
  assertEquals(roll.rollup.bandCounts["0"], 1);
  assertEquals(roll.rollup.bandCounts["1-3"], 1);
  assertEquals(roll.rollup.bandCounts["4-7"], 1);
  assertEquals(roll.rollup.bandCounts["8-15"], 1);
  assertEquals(roll.rollup.bandCounts["16+"], 1);
});

Deno.test("score: mean rounded to 1 decimal, includes 0-score entries", () => {
  // 3 entries: scores 0, 1, 2 → mean 1.0.
  const entries = [
    fakeEntry("STK_001", "/a.md"),
    fakeEntry("STK_002", "/b.md"),
    fakeEntry("STK_003", "/c.md"),
  ];
  const diags = [
    fakeDiag("MSL-Q304", "incose-r9-open-ended", 1, "/b.md"),
    fakeDiag("MSL-Q304", "incose-r9-open-ended", 1, "/c.md"),
    fakeDiag("MSL-Q304", "incose-r9-open-ended", 1, "/c.md"),
  ];
  const roll = computeScoreRollup(diags, entries);
  assertEquals(roll.rollup.mean, 1.0);
});

Deno.test("score: anti-pattern note is the exact ADR-021 string", () => {
  const roll = computeScoreRollup([], [fakeEntry("STK_0001")]);
  assertEquals(
    roll.antiPatternNote,
    "Optimize the requirements, not the score. The score is a smoke detector, not a KPI.",
  );
  // Also verify via exported constant.
  assertEquals(roll.antiPatternNote, ANTI_PATTERN_NOTE);
});

Deno.test("score: deterministic — same input → same output", () => {
  const entries = [fakeEntry("STK_0001"), fakeEntry("STK_0002", "/y.md")];
  const diags = [fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/x.md")];
  const a = computeScoreRollup(diags, entries);
  const b = computeScoreRollup(diags, entries);
  assertEquals(JSON.stringify(a), JSON.stringify(b));
});

Deno.test("score: perEntry sorted by displayId for determinism", () => {
  const entries = [
    fakeEntry("STK_0003", "/c.md"),
    fakeEntry("STK_0001", "/a.md"),
    fakeEntry("STK_0002", "/b.md"),
  ];
  const roll = computeScoreRollup([], entries);
  assertEquals(
    roll.perEntry.map((e) => e.displayId),
    ["STK_0001", "STK_0002", "STK_0003"],
  );
});

Deno.test("score: empty diagnostics and empty entries → mean 0 and all bands 0", () => {
  const roll = computeScoreRollup([], []);
  assertEquals(roll.rollup.mean, 0);
  assertEquals(Object.keys(roll.rollup.bandCounts).length, 5);
  for (const count of Object.values(roll.rollup.bandCounts)) {
    assertEquals(count, 0);
  }
});

Deno.test("score: band keys present in canonical order", () => {
  const roll = computeScoreRollup([], []);
  assertEquals(Object.keys(roll.rollup.bandCounts), [
    "0",
    "1-3",
    "4-7",
    "8-15",
    "16+",
  ]);
});

// Band-boundary regression tests — guards against off-by-one if the
// band predicates are ever edited. The values 1, 3, 4, 7, 8, 15, 16
// sit exactly on the band boundaries per ADR-021 Decision 4.
Deno.test("score: boundary — score=1 lands in '1-3'", () => {
  const entry = fakeEntry("STK_0001");
  const diags = [fakeDiag("MSL-Q304", "incose-r9-open-ended", 1, "/x.md")];
  const roll = computeScoreRollup(diags, [entry]);
  assertEquals(roll.rollup.bandCounts["1-3"], 1);
  assertEquals(roll.rollup.bandCounts["0"], 0);
});

Deno.test("score: boundary — score=3 lands in '1-3' (upper edge)", () => {
  const entry = fakeEntry("STK_0001");
  const diags = [fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/x.md")];
  const roll = computeScoreRollup(diags, [entry]);
  assertEquals(roll.rollup.bandCounts["1-3"], 1);
  assertEquals(roll.rollup.bandCounts["4-7"], 0);
});

Deno.test("score: boundary — score=4 lands in '4-7' (lower edge)", () => {
  const entry = fakeEntry("STK_0001");
  const diags = [
    fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/x.md"),
    fakeDiag("MSL-Q304", "incose-r9-open-ended", 1, "/x.md"),
  ];
  const roll = computeScoreRollup(diags, [entry]);
  assertEquals(roll.rollup.bandCounts["4-7"], 1);
  assertEquals(roll.rollup.bandCounts["1-3"], 0);
});

Deno.test("score: boundary — score=7 lands in '4-7' (upper edge)", () => {
  const entry = fakeEntry("STK_0001");
  // 2×3 + 1 = 7
  const diags = [
    fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/x.md"),
    fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/x.md"),
    fakeDiag("MSL-Q304", "incose-r9-open-ended", 1, "/x.md"),
  ];
  const roll = computeScoreRollup(diags, [entry]);
  assertEquals(roll.rollup.bandCounts["4-7"], 1);
  assertEquals(roll.rollup.bandCounts["8-15"], 0);
});

Deno.test("score: boundary — score=8 lands in '8-15' (lower edge)", () => {
  const entry = fakeEntry("STK_0001");
  // 2×3 + 2×1 = 8
  const diags = [
    fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/x.md"),
    fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/x.md"),
    fakeDiag("MSL-Q304", "incose-r9-open-ended", 1, "/x.md"),
    fakeDiag("MSL-Q304", "incose-r9-open-ended", 1, "/x.md"),
  ];
  const roll = computeScoreRollup(diags, [entry]);
  assertEquals(roll.rollup.bandCounts["8-15"], 1);
  assertEquals(roll.rollup.bandCounts["4-7"], 0);
});

Deno.test("score: boundary — score=15 lands in '8-15' (upper edge)", () => {
  const entry = fakeEntry("STK_0001");
  // 5×3 = 15
  const diags: LintDiagnostic[] = [];
  for (let k = 0; k < 5; k++) {
    diags.push(fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/x.md"));
  }
  const roll = computeScoreRollup(diags, [entry]);
  assertEquals(roll.rollup.bandCounts["8-15"], 1);
  assertEquals(roll.rollup.bandCounts["16+"], 0);
});

Deno.test("score: boundary — score=16 lands in '16+' (lower edge)", () => {
  const entry = fakeEntry("STK_0001");
  // 5×3 + 1 = 16
  const diags: LintDiagnostic[] = [];
  for (let k = 0; k < 5; k++) {
    diags.push(fakeDiag("MSL-Q302", "incose-r7-vague-term", 3, "/x.md"));
  }
  diags.push(fakeDiag("MSL-Q304", "incose-r9-open-ended", 1, "/x.md"));
  const roll = computeScoreRollup(diags, [entry]);
  assertEquals(roll.rollup.bandCounts["16+"], 1);
  assertEquals(roll.rollup.bandCounts["8-15"], 0);
});
