/**
 * @module tests/e2e/ast_fidelity_test
 *
 * Unit tests for the SP1 characterization util. The provisional
 * `astEquivalent` relation is load-bearing for every classification
 * (SP1 design §4.6), so it is pinned directly here.
 */

import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { astEquivalent, type BodyBlock, buildBodyAst } from "./ast_fidelity.ts";

/** Build the AST for a bare body string (helper). */
function ast(body: string): BodyBlock[] {
  return buildBodyAst(body);
}

Deno.test("astEquivalent: identical structure, different SourceRange → equivalent", () => {
  // Same prose at two different body offsets: the leading blank-line run
  // shifts every node's `range` but not its structure/content.
  const a = ast("The system shall validate inputs.");
  const b = ast("\n\nThe system shall validate inputs.");
  assert(astEquivalent(a, b));
});

Deno.test("astEquivalent: dropped emphasis (structural difference) → not equivalent", () => {
  // SP1 FINDING: `buildBodyAst` erases inline emphasis/strong markup, so
  // `_shall_` and `shall` parse to identical ASTs (see the characterization
  // test below). We therefore hand-construct the two ASTs — exactly as the
  // `Unknown` cases below do — to pin astEquivalent's discriminating power:
  // an AST that still carries the emphasis vs one where it was dropped must
  // NOT be equivalent. This is the §4.6 "dropped emphasis → not equivalent"
  // property of the relation itself, independent of builder fidelity.
  const withEmphasis: BodyBlock[] = [{
    kind: "paragraph",
    content: { text: "The driver _shall_ debounce inputs.", markers: [] },
    range: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
  }];
  const dropped: BodyBlock[] = [{
    kind: "paragraph",
    content: { text: "The driver shall debounce inputs.", markers: [] },
    range: { start: { line: 9, column: 9 }, end: { line: 9, column: 9 } },
  }];
  assertFalse(astEquivalent(withEmphasis, dropped));
});

Deno.test("buildBodyAst preserves inline emphasis (SP2 faithful builder)", () => {
  // SP2 flipped the SP1 tripwire: the builder is now faithful. `_shall_`
  // and `shall` must produce DIFFERENT ASTs (the markup is retained), and
  // the paragraph's stored text must carry the verbatim emphasis source.
  const emphasised = ast("The driver _shall_ debounce inputs.");
  const plain = ast("The driver shall debounce inputs.");
  assertFalse(astEquivalent(emphasised, plain));
  const p = emphasised[0];
  assert(p.kind === "paragraph");
  assertStringIncludes(
    (p as { content: { text: string } }).content.text,
    "_shall_",
  );
});

Deno.test("astEquivalent: fused hard line break → not equivalent", () => {
  const a = ast("line one  \nline two");
  const b = ast("line one line two");
  assertFalse(astEquivalent(a, b));
});

Deno.test("astEquivalent: reordered children → not equivalent", () => {
  const a = ast("- alpha\n- beta");
  const b = ast("- beta\n- alpha");
  assertFalse(astEquivalent(a, b));
});

Deno.test("astEquivalent: same-order children → equivalent", () => {
  const a = ast("- alpha\n- beta");
  const b = ast("- alpha\n- beta");
  assert(astEquivalent(a, b));
});

Deno.test("astEquivalent: Unknown(raw=x) vs Unknown(raw=y) → not equivalent", () => {
  const a: BodyBlock[] = [{
    kind: "unknown",
    raw: "x",
    range: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
  }];
  const b: BodyBlock[] = [{
    kind: "unknown",
    raw: "y",
    range: { start: { line: 9, column: 9 }, end: { line: 9, column: 9 } },
  }];
  assertFalse(astEquivalent(a, b));
});

Deno.test("astEquivalent: Unknown same raw, different range → equivalent", () => {
  const a: BodyBlock[] = [{
    kind: "unknown",
    raw: "x",
    range: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
  }];
  const b: BodyBlock[] = [{
    kind: "unknown",
    raw: "x",
    range: { start: { line: 9, column: 9 }, end: { line: 9, column: 9 } },
  }];
  assert(astEquivalent(a, b));
});

Deno.test("astEquivalent: different block count → not equivalent", () => {
  const a = ast("para one\n\npara two");
  const b = ast("para one");
  assertEquals(a.length, 2);
  assertFalse(astEquivalent(a, b));
});

import { classifySample, CORPUS, runMatrix } from "./ast_fidelity.ts";

Deno.test("classifySample: plain prose round-trips → OK", async () => {
  const row = await classifySample({
    name: "t-plain",
    markdown: "The system shall validate inputs.",
  });
  assertEquals(row.cls, "OK");
  assert(row.rEqualsS);
  assert(row.idempotent);
  assertEquals(row.delta, "—");
});

Deno.test("classifySample: excluded heading round-trips verbatim and stays diagnosed (SP2 faithful builder)", async () => {
  // SP1-era this characterised heading NON-round-trip (UNOWNED, never OK):
  // `extractMdastText` flattened `# h` → `h`. SP2 (Task 6, verbatim
  // Unknown.raw) makes the excluded heading round-trip BYTE-IDENTICALLY
  // while staying MSL-B040-diagnosable (subkind preserved). This is the
  // strictly stronger §5.4 guarantee — genuine verbatim preservation, the
  // opposite of "OK by vanishing". A second SP1 tripwire SP2 legitimately
  // flips (cf. the emphasis tripwire above).
  const s = "# heading in body";
  const row = await classifySample({ name: "t-heading", markdown: s });
  assertEquals(row.cls, "OK"); // round-trips byte-identically (r === s)
  assert(row.rEqualsS);
  // OK is because of genuine verbatim preservation, NOT vanishing:
  const blocks = buildBodyAst(s);
  assertEquals(blocks.length, 1);
  const u = blocks[0] as { kind: string; raw?: string; subkind?: string };
  assertEquals(u.kind, "unknown");
  assertEquals(u.raw, s); // verbatim source preserved (the `#` survives)
  assertEquals(u.subkind, "heading"); // still MSL-B040-diagnosable
});

Deno.test("runMatrix: covers the whole corpus, deterministic order, counts sum", async () => {
  const m1 = await runMatrix();
  const m2 = await runMatrix();
  assertEquals(m1.rows.length, CORPUS.length);
  // Deterministic: identical rows + order across runs.
  assertEquals(
    m1.rows.map((r) => `${r.name}:${r.cls}:${r.delta}`),
    m2.rows.map((r) => `${r.name}:${r.cls}:${r.delta}`),
  );
  // Row order mirrors corpus order exactly.
  assertEquals(
    m1.rows.map((r) => r.name),
    CORPUS.map((c) => c.name),
  );
  const total = m1.counts.OK + m1.counts.NORMALIZE + m1.counts.LOSS +
    m1.counts.UNOWNED + m1.counts.UNREPRESENTABLE;
  assertEquals(total, CORPUS.length);
  assertEquals(m1.surface, m1.counts.LOSS + m1.counts.UNREPRESENTABLE);
});

import { renderCatalogue } from "./ast_fidelity.ts";

Deno.test("renderCatalogue: deterministic + markdownlint-safe shape", async () => {
  const m = await runMatrix();
  const a = renderCatalogue(m);
  const b = renderCatalogue(m);
  assertEquals(a, b); // pure + deterministic

  // Single leading H1 (markdownlint first-line-heading / single-title).
  assert(a.startsWith("# AST Fidelity Matrix\n"));
  assertEquals(a.match(/^# /gm)?.length, 1);
  // Generated-file banner so humans do not hand-edit it.
  assert(a.includes("<!-- Generated by scripts/gen_ast_fidelity_matrix.ts"));
  // Headline number present.
  assert(a.includes(`surface = LOSS + UNREPRESENTABLE = ${m.surface}`));
  // Table header present and every corpus row rendered.
  assert(
    a.includes(
      "| Construct | Class | r==s | idempotent | str-fmt agrees | delta |",
    ),
  );
  for (const row of m.rows) {
    assert(a.includes(`| ${row.name} |`), `missing row ${row.name}`);
  }
  // Trailing newline, single (file is dprint-excluded; keep it tidy).
  assert(a.endsWith("\n"));
  assertFalse(a.endsWith("\n\n"));
  // No raw pipe leaks from delta: every data row has exactly 6 cells → 7
  // structural `|` delimiters. cell() escapes any in-delta pipe as `\|`
  // (which still contains a `|`), so strip escaped pipes first — the count
  // must reflect table structure, not delta content.
  for (const line of a.split("\n")) {
    if (
      line.startsWith("| ") && !line.includes("Construct") &&
      !line.startsWith("| ---")
    ) {
      const structural = (line.replace(/\\\|/g, "").match(/\|/g) ?? []).length;
      assertEquals(structural, 7, `bad row: ${line}`);
    }
  }
});
