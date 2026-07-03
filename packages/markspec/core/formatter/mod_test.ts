/**
 * @module formatter/mod_test
 *
 * Unit tests for the formatter. Exercises `Id:` stamping, CSV
 * expansion on repeatable universal attributes, canonical ordering,
 * and idempotent output.
 */

import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import {
  format,
  isSentenceInitial,
  normalizeModalKeywords,
  renderAttributeBlock,
} from "./mod.ts";

const MOCK_ULID = "01HGW2Q8MNP3RSTVWXYZABCDEF";
const MOCK_ULID_2 = "01HGW2Q8MNP3RSTVWXYZABCDEG";

function mockUlid(): () => string {
  const stack = [MOCK_ULID_2, MOCK_ULID];
  return () => stack.pop() ?? MOCK_ULID;
}

// ---------------------------------------------------------------------------
// Id auto-assignment
// ---------------------------------------------------------------------------

Deno.test("format: assigns Id to identified entry with no identity", () => {
  const md = `- [REQ-001] Title

  Body.
`;
  const result = format(md, { generateUlid: mockUlid() });
  assertEquals(result.changed, true);
  assertStringIncludes(result.output, `Id: ${MOCK_ULID}`);
});

Deno.test("format: existing Id is preserved", () => {
  const md = `- [REQ-001] Title

  Body.

  Id: ${MOCK_ULID}
`;
  const result = format(md);
  assertStringIncludes(result.output, `Id: ${MOCK_ULID}`);
  // Only the one Id appears (no duplicate assignment).
  const matches = result.output.match(/Id: /g) ?? [];
  assertEquals(matches.length, 1);
});

Deno.test("format: referenced entry without Id is NOT auto-assigned", () => {
  const md = `- [ISO-26262-6] Standard
`;
  const result = format(md, {
    file: "references.md",
    generateUlid: mockUlid(),
  });
  // Referenced entries' Id is a URI that must be author-provided.
  assertEquals(result.output.includes(MOCK_ULID), false);
});

Deno.test("format: emits MSL-F001 info diagnostic on Id assignment", () => {
  const md = `- [REQ-001] Title

  Body.
`;
  const result = format(md, { generateUlid: mockUlid() });
  const assigned = result.diagnostics.find((d) => d.code === "MSL-F001");
  assertEquals(assigned?.severity, "info");
  assertStringIncludes(assigned?.message ?? "", MOCK_ULID);
});

// ---------------------------------------------------------------------------
// Canonical ordering
// ---------------------------------------------------------------------------

Deno.test("format: canonical order places Id first, universal attrs last", () => {
  const md = `- [REQ-001] Title

  Body.

      Labels: important
      Id: ${MOCK_ULID}
      Supersedes: OLD-001
`;
  const result = format(md);
  const output = result.output;
  // Id: appears before Labels: and Supersedes:.
  const idIdx = output.indexOf("Id:");
  const labelsIdx = output.indexOf("Labels:");
  const supersedesIdx = output.indexOf("Supersedes:");
  assertEquals(idIdx >= 0, true);
  assertEquals(labelsIdx > idIdx, true);
  assertEquals(supersedesIdx > idIdx, true);
});

Deno.test("format: unknown (profile-declared) attributes preserved", () => {
  const md = `- [REQ-001] Title

  Body.

      Id: ${MOCK_ULID}
      Derived-from: PARENT-001
      Labels: one
`;
  const result = format(md);
  // Unknown keys survive the formatter — profile-aware validation handles
  // them separately.
  assertStringIncludes(result.output, "Derived-from: PARENT-001");
  assertStringIncludes(result.output, "Labels: one");
});

// ---------------------------------------------------------------------------
// CSV expansion on repeatable universal attrs
// ---------------------------------------------------------------------------

Deno.test("format: Labels CSV expands to multi-line", () => {
  const md = `- [REQ-001] Title

  Body.

      Id: ${MOCK_ULID}
      Labels: one, two, three
`;
  const result = format(md);
  assertStringIncludes(result.output, "Labels: one");
  assertStringIncludes(result.output, "Labels: two");
  assertStringIncludes(result.output, "Labels: three");
  // CSV on one line should no longer appear as such.
  assertEquals(result.output.includes("one, two, three"), false);
});

Deno.test("format: multi-line Labels preserved", () => {
  const md = `- [REQ-001] Title

  Body.

      Id: ${MOCK_ULID}
      Labels: one
      Labels: two
`;
  const result = format(md);
  assertStringIncludes(result.output, "Labels: one");
  assertStringIncludes(result.output, "Labels: two");
});

// ---------------------------------------------------------------------------
// Idempotence
// ---------------------------------------------------------------------------

Deno.test("format: output is idempotent (format twice = format once)", () => {
  const md = `- [REQ-001] Title

  Body.

      Id: ${MOCK_ULID}
      Labels: important
`;
  const once = format(md);
  const twice = format(once.output);
  assertEquals(twice.output, once.output);
});

Deno.test("format: unchanged-input does not mutate source", () => {
  const md = `- [REQ-001] Title

  Body.

      Id: ${MOCK_ULID}
`;
  const result = format(md);
  // Already canonical form — changed should be false.
  assertEquals(result.changed, false);
});

// ---------------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------------

Deno.test("format: preserves YAML front matter", () => {
  const md = `---
document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR
document-type: requirements
---

- [REQ-001] Title

  Body.

  Id: ${MOCK_ULID}
`;
  const result = format(md);
  assertStringIncludes(
    result.output,
    "document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR",
  );
  assertStringIncludes(result.output, "document-type: requirements");
});

// ---------------------------------------------------------------------------
// Multiple entries
// ---------------------------------------------------------------------------

Deno.test("format: assigns distinct Ids to multiple identified entries", () => {
  const md = `- [REQ-001] First

  Body.

- [REQ-002] Second

  Body.
`;
  const result = format(md, { generateUlid: mockUlid() });
  assertStringIncludes(result.output, `Id: ${MOCK_ULID}`);
  assertStringIncludes(result.output, `Id: ${MOCK_ULID_2}`);
});

// ---------------------------------------------------------------------------
// Empty / no-entry input
// ---------------------------------------------------------------------------

Deno.test("format: empty input returns unchanged", () => {
  const result = format("");
  assertEquals(result.changed, false);
  assertEquals(result.output, "");
});

Deno.test("format: markdown with no entries returns unchanged", () => {
  const md = `# Heading

Just prose.
`;
  const result = format(md);
  assertEquals(result.changed, false);
  assertEquals(result.output, md);
});

// ---------------------------------------------------------------------------
// renderAttributeBlock — indented code block emission
// ---------------------------------------------------------------------------

Deno.test("renderAttributeBlock: emits indented code block (4-space prefix, no backslash)", () => {
  const block = renderAttributeBlock(
    [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDE" },
      { key: "Satisfies", value: "SYS_BRK_0042" },
      { key: "Labels", value: "ASIL-B" },
    ],
    2, // body indent of a list-item entry
  );

  const expected = "      Id: 01HGW2Q8MNP3RSTVWXYZABCDE\n" +
    "      Satisfies: SYS_BRK_0042\n" +
    "      Labels: ASIL-B";

  assertEquals(block, expected);
});

Deno.test("renderAttributeBlock: doc-comment indent (no list wrapper)", () => {
  const block = renderAttributeBlock(
    [{ key: "Id", value: "01HGW3C4DEF6ABCDEFGHJKMNPQ" }],
    0, // doc comment, no list nesting
  );
  assertEquals(block, "    Id: 01HGW3C4DEF6ABCDEFGHJKMNPQ");
});

// ---------------------------------------------------------------------------
// isSentenceInitial — sentence-start predicate (§3.4.1 EARS rule)
// ---------------------------------------------------------------------------

Deno.test("isSentenceInitial: offset 0 is sentence-initial", () => {
  assertEquals(isSentenceInitial("When pressed", 0), true);
});

Deno.test("isSentenceInitial: only whitespace to the left is sentence-initial", () => {
  assertEquals(isSentenceInitial("   When pressed", 3), true);
  assertEquals(isSentenceInitial("\t\tWhen pressed", 2), true);
});

Deno.test("isSentenceInitial: after terminator (with/without spaces) is sentence-initial", () => {
  assertEquals(isSentenceInitial("Done. When ready", 6), true); // after '.'
  assertEquals(isSentenceInitial("Done!  When ready", 7), true); // after '!'
  assertEquals(isSentenceInitial("Done?\tWhen ready", 6), true); // after '?'
});

Deno.test("isSentenceInitial: after a word/comma/semicolon is NOT sentence-initial", () => {
  assertEquals(isSentenceInitial("act When triggered", 4), false); // after 't'
  assertEquals(isSentenceInitial("a, When b", 3), false); // after ','
  assertEquals(isSentenceInitial("a; When b", 3), false); // after ';'
});

// ---------------------------------------------------------------------------
// normalizeModalKeywords — §3.4.1 case normalisation
// ---------------------------------------------------------------------------

Deno.test("normalizeModalKeywords: RFC 2119 keywords always lowercased", () => {
  assertEquals(
    normalizeModalKeywords("The system SHALL respond and SHOULD log."),
    "The system shall respond and should log.",
  );
  // Even sentence-initial RFC 2119 is lowercased.
  assertEquals(normalizeModalKeywords("MUST hold."), "must hold.");
  // `… NOT` suffix is part of the match.
  assertEquals(
    normalizeModalKeywords("The widget MUST NOT fail and MAY retry."),
    "The widget must not fail and may retry.",
  );
});

Deno.test("normalizeModalKeywords: EARS preserved sentence-initial, lowercased mid-sentence", () => {
  assertEquals(
    normalizeModalKeywords("When the button is pressed the lamp lights."),
    "When the button is pressed the lamp lights.",
  );
  assertEquals(
    normalizeModalKeywords("The lamp lights When the button is pressed."),
    "The lamp lights when the button is pressed.",
  );
  // Sentence-initial after a terminator is also preserved.
  assertEquals(
    normalizeModalKeywords("Idle. While charging the LED blinks."),
    "Idle. While charging the LED blinks.",
  );
});

Deno.test("normalizeModalKeywords: fenced code blocks left verbatim", () => {
  const input = "Prose SHALL lower.\n```\nlet SHALL = 1; // When code\n```\n";
  assertEquals(
    normalizeModalKeywords(input),
    "Prose shall lower.\n```\nlet SHALL = 1; // When code\n```\n",
  );
});

Deno.test("normalizeModalKeywords: indented (code/trailer) lines left verbatim", () => {
  // 4-space and tab-indented lines are not prose.
  assertEquals(
    normalizeModalKeywords("Prose SHALL lower.\n    SHALL stay\n\tMUST stay"),
    "Prose shall lower.\n    SHALL stay\n\tMUST stay",
  );
});

// ---------------------------------------------------------------------------
// SP3 Task 5 — §5.2-via-AST: normalizeBodyAst + astEquivalent guard
//
// The body modal-keyword pass is now AST-native (normalizeBodyAst), not the
// pre-parse whole-body string pass. These tests are characterization guards
// for the cutover: they MUST stay green while the mechanism moves onto the
// AST. They additionally pin idempotence + `changed` accuracy and the §2.5
// verbatim improvement (modal-looking word in a fenced code block is NOT
// lowercased — the new AST path respects verbatim boundaries; the old
// whole-body string pass could get this wrong).
// ---------------------------------------------------------------------------

Deno.test("format: body modal keyword canonicalized via the AST", async () => {
  const { format } = await import("./mod.ts");
  const doc =
    "- [TST_FM_0001] Probe\n\n  The driver SHALL debounce inputs.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const out = format(doc, { file: "t.md" }).output;
  assert(out.includes("The driver shall debounce inputs."));
  assertFalse(out.includes("SHALL"));
});

Deno.test("format: idempotent on non-canonical body (modal + blank runs)", async () => {
  const { format } = await import("./mod.ts");
  const doc =
    "- [TST_FM_0002] Probe\n\n  The system MUST stop.\n\n\n\n  More prose.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const once = format(doc, { file: "t.md" }).output;
  const twice = format(once, { file: "t.md" }).output;
  assertEquals(twice, once);
});

Deno.test("format: same-line-marker note canonicalized + idempotent", async () => {
  const { format } = await import("./mod.ts");
  const doc =
    "- [TST_FM_0003] Probe\n\n  > [!NOTE] inline body.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const once = format(doc, { file: "t.md" }).output;
  assertEquals(format(once, { file: "t.md" }).output, once);
});

Deno.test("format: changed=true on uppercase-modal body, false on re-format", () => {
  const doc =
    "- [TST_FM_0004] Probe\n\n  The system SHALL stop.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const first = format(doc, { file: "t.md" });
  assertEquals(first.changed, true);
  const second = format(first.output, { file: "t.md" });
  assertEquals(second.changed, false);
});

Deno.test("format: modal-looking word inside a fenced code block is NOT lowercased (§2.5 verbatim)", () => {
  const doc = [
    "- [TST_FM_0005] Probe",
    "",
    "  Prose with no modal here.",
    "",
    "  ```rust",
    "  let SHALL = 1; // MUST stay verbatim",
    "  ```",
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "",
  ].join("\n");
  const once = format(doc, { file: "t.md" }).output;
  assertStringIncludes(once, "let SHALL = 1; // MUST stay verbatim");
  // Idempotent over the verbatim case.
  assertEquals(format(once, { file: "t.md" }).output, once);
});

Deno.test("format: inter-entry blank runs are still collapsed", () => {
  const doc = [
    "- [TST_FM_0006] First",
    "",
    "  Body one.",
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "",
    "",
    "",
    "- [TST_FM_0007] Second",
    "",
    "  Body two.",
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAW",
    "",
  ].join("\n");
  const out = format(doc, { file: "t.md" }).output;
  assertFalse(/\n\n\n/.test(out));
  // Idempotent.
  assertEquals(format(out, { file: "t.md" }).output, out);
});

Deno.test("format: deflist with inline markup is canonicalized + idempotent", () => {
  const doc = [
    "- [TST_FM_0008] Probe",
    "",
    "  Term",
    "  : The definition SHALL hold and uses `code`.",
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "",
  ].join("\n");
  const once = format(doc, { file: "t.md" }).output;
  const twice = format(once, { file: "t.md" }).output;
  assertEquals(twice, once);
});

Deno.test("format: mixed multi-entry doc is idempotent across the AST cutover", () => {
  const doc = [
    "# Heading",
    "",
    "- [TST_FM_0009] Alpha",
    "",
    "  The driver MUST debounce When pressed.",
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "",
    "- [TST_FM_0010] Beta",
    "",
    "  > [!NOTE] note body MAY be terse.",
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAW",
    "",
  ].join("\n");
  const once = format(doc, { file: "t.md" }).output;
  const twice = format(once, { file: "t.md" }).output;
  assertEquals(twice, once);
  // RFC 2119 lowercased; sentence-initial EARS preserved is exercised
  // elsewhere — here just confirm the body modal was canonicalized.
  assertFalse(once.includes("MUST debounce"));
  assertStringIncludes(once, "must debounce");
});

Deno.test("Slice 3 formatter: stamps today's date when Discipline-frozen: is bare kind", () => {
  const input = `# Test

- [REQ_001] Title

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Discipline-frozen: software
`;
  const { output, changed } = format(input, {
    today: () => "2026-05-25",
  });
  assertEquals(changed, true);
  assertEquals(
    output.includes("Discipline-frozen: software @ 2026-05-25"),
    true,
  );
});

Deno.test("Slice 3 formatter: leaves already-dated Discipline-frozen: alone (idempotent)", () => {
  const input = `# Test

- [REQ_001] Title

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Discipline-frozen: software @ 2026-03-12
`;
  const { output } = format(input, {
    today: () => "2026-05-25",
  });
  assertEquals(
    output.includes("Discipline-frozen: software @ 2026-03-12"),
    true,
  );
  assertEquals(output.includes("2026-05-25"), false);
});

Deno.test("Slice 3 formatter: malformed Discipline-frozen: value is untouched (validator handles it)", () => {
  const input = `# Test

- [REQ_001] Title

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Discipline-frozen: Software
`;
  const { output } = format(input, {
    today: () => "2026-05-25",
  });
  // Uppercase 'S' — doesn't match the bare-kind regex; formatter punts.
  assertEquals(output.includes("Discipline-frozen: Software"), true);
  assertEquals(output.includes("@ 2026-05-25"), false);
});

Deno.test("format: formatMarkdownProse formats prose around entries", () => {
  const input = `# Title

Ragged
prose.

- [STK_0001] Entry

  Body.

      Id: 01JADYKACKQKGVGHT9K7Y6PBPA
`;
  const unwrap = (md: string): string =>
    md.split(/\n{2,}/).map((p) => p.replace(/\n(?!$)/g, " ")).join("\n\n") +
    "\n";
  const result = format(input, {
    file: "t.md",
    formatMarkdownProse: unwrap,
  });
  assertEquals(result.changed, true);
  assertStringIncludes(result.output, "Ragged prose.");
  assertStringIncludes(result.output, "- [STK_0001] Entry");
  assertStringIncludes(result.output, "      Id: 01JADYKACKQKGVGHT9K7Y6PBPA");
});

Deno.test("format: formatMarkdownProse formats entry-less documents", () => {
  const unwrap = (md: string): string => md.replace(/\n(?!$)/g, " ");
  const result = format("Just\nprose.\n", {
    file: "t.md",
    formatMarkdownProse: unwrap,
  });
  assertEquals(result.changed, true);
  assertEquals(result.output, "Just prose.\n");
});

Deno.test("format: without formatMarkdownProse, entry-less documents are untouched", () => {
  const result = format("Just\nprose.\n", { file: "t.md" });
  assertEquals(result.changed, false);
  assertEquals(result.output, "Just\nprose.\n");
});

Deno.test("format: prose gate fallback emits MSL-F012 info", () => {
  const truncate = (md: string): string =>
    md.trimEnd().split(" ").slice(0, -1).join(" ") + "\n";
  const result = format("some prose words here\n", {
    file: "t.md",
    formatMarkdownProse: truncate,
  });
  assertEquals(result.changed, false);
  assertEquals(
    result.diagnostics.some((d) => d.code === "MSL-F012"),
    true,
  );
});

Deno.test("format: formatMarkdownProse re-wraps entry bodies (gated)", () => {
  const input = `- [STK_0001] Entry

  Ragged
  body prose.

      Id: 01JADYKACKQKGVGHT9K7Y6PBPA
`;
  const unwrap = (md: string): string =>
    md.split(/\n{2,}/).map((p) => p.replace(/\n(?!$)/g, " ")).join("\n\n") +
    "\n";
  const result = format(input, { file: "t.md", formatMarkdownProse: unwrap });
  assertEquals(result.changed, true);
  assertStringIncludes(result.output, "  Ragged body prose.");
});

Deno.test("format: polished entry-body lines never exceed 80 columns including indent", async () => {
  // Regression (ADR-029 convergence): the body polish formats the body
  // DEDENTED and re-indents +2 afterwards. Without an indent-adjusted
  // width budget, a wrap point landing on exactly 80 columns dedented
  // becomes 82 columns re-indented — which an external whole-file dprint
  // (78-col budget for list content) re-wraps, ping-ponging forever.
  const { loadMarkdownFormatter } = await import("./dprint.ts");
  const proseFormat = await loadMarkdownFormatter();
  const input = `- [STK_9003] Width budget

  The system shall demonstrate a deliberately very long ragged body paragraph that must reflow under the indent-adjusted width budget so no emitted line exceeds eighty columns.

      Id: 01JADYKACKQKGVGHT9K7Y6PBPD
`;
  const result = format(input, {
    file: "t.md",
    formatMarkdownProse: proseFormat,
  });
  for (const line of result.output.split("\n")) {
    if (line.length > 80) throw new Error(`line exceeds 80 cols: ${line}`);
  }
});

Deno.test("format: body gate rejects destructive output with MSL-F012, keeps canonical body", () => {
  const input = `- [STK_0001] Entry

  Body prose here.

      Id: 01JADYKACKQKGVGHT9K7Y6PBPA
`;
  const truncate = (md: string): string =>
    md.trimEnd().split(" ").slice(0, -1).join(" ") + "\n";
  const result = format(input, {
    file: "t.md",
    formatMarkdownProse: truncate,
  });
  assertStringIncludes(result.output, "  Body prose here.");
  assertEquals(
    result.diagnostics.some(
      (d) => d.code === "MSL-F012" && d.message.includes("STK_0001"),
    ),
    true,
  );
});

// ---------------------------------------------------------------------------
// ADR-029 follow-ups: scope guard + throw hardening
// ---------------------------------------------------------------------------

Deno.test("format: markdown pass is disabled for non-.md files even when the callback is wired (ADR-029 scope guard in format())", () => {
  let called = false;
  const spy = (md: string): string => {
    called = true;
    return md.replace(/\n(?!$)/g, " ");
  };
  const src =
    'fn main() {\n    let x = compute(1, 2);\n    println!("{}", x);\n}\n';
  const result = format(src, { file: "main.rs", formatMarkdownProse: spy });
  assertEquals(called, false);
  assertEquals(result.output, src);
});

Deno.test("format: markdown pass still runs for .md files (control for the scope guard)", () => {
  let called = false;
  const spy = (md: string): string => {
    called = true;
    return md;
  };
  format("# Heading\n\nsome prose.\n", {
    file: "doc.md",
    formatMarkdownProse: spy,
  });
  assertEquals(called, true);
});

Deno.test("format: a throwing markdown formatter degrades to fallback, never crashes (entry body)", () => {
  const thrower = (): string => {
    throw new Error("simulated dprint WASM panic");
  };
  const input = `- [STK_9004] Throw safety

  The system shall keep its canonical body when the Markdown formatter errors.

      Id: 01JADYKACKQKGVGHT9K7Y6PBPE
`;
  const result = format(input, { file: "t.md", formatMarkdownProse: thrower });
  assertStringIncludes(
    result.output,
    "The system shall keep its canonical body when the Markdown formatter errors.",
  );
  assertEquals(result.diagnostics.some((d) => d.code === "MSL-F012"), true);
});

Deno.test("format: a throwing markdown formatter degrades to fallback for prose segments too", () => {
  const thrower = (): string => {
    throw new Error("simulated dprint WASM panic");
  };
  const result = format("# Overview\n\nragged prose here.\n", {
    file: "t.md",
    formatMarkdownProse: thrower,
  });
  // No throw; original prose preserved; the fallback is reported with the
  // accurate "errored" cause (not the semantic-rejection wording).
  assertStringIncludes(result.output, "ragged prose here.");
  assertEquals(
    result.diagnostics.some(
      (d) => d.code === "MSL-F012" && d.message.includes("errored"),
    ),
    true,
  );
});

// ---------------------------------------------------------------------------
// Soft-wrapped title lines (#686)
// ---------------------------------------------------------------------------

Deno.test("format: collapses a soft-wrapped title to one line and stamps Id", () => {
  // #686: an entry whose bracket-title line wraps onto a second physical
  // line was silently skipped — no Id minted, no diagnostic. The formatter
  // must detect it, collapse the title to a single line, and stamp an Id
  // without dropping or duplicating the wrapped continuation or the body.
  const md = [
    "- [FREQ_0001] The system shall compute a very long descriptive title that",
    "  wraps onto a second physical line for readability",
    "",
    "  The system shall compute the value within 200 ms.",
    "",
    "      Satisfies: STK_0001",
    "",
  ].join("\n");
  const result = format(md, { generateUlid: mockUlid() });
  assertEquals(result.changed, true);
  // Title collapsed onto a single physical line.
  assertStringIncludes(
    result.output,
    "- [FREQ_0001] The system shall compute a very long descriptive title " +
      "that wraps onto a second physical line for readability\n",
  );
  // Id stamped — no longer silently skipped.
  assertStringIncludes(result.output, `Id: ${MOCK_ULID}`);
  // Body preserved; continuation line neither clobbered nor duplicated.
  assertStringIncludes(
    result.output,
    "The system shall compute the value within 200 ms.",
  );
  assertEquals(
    result.output.split("wraps onto a second physical line").length - 1,
    1,
    "the wrapped continuation text must appear exactly once",
  );
  // Idempotent: re-formatting the output changes nothing.
  const second = format(result.output, { generateUlid: mockUlid() });
  assertEquals(second.output, result.output);
});

Deno.test("format: collapses a title wrapped across three physical lines", () => {
  const md = [
    "- [FREQ_0002] Alpha",
    "  beta",
    "  gamma",
    "",
    "  Body prose.",
    "",
    "      Satisfies: STK_0001",
    "",
  ].join("\n");
  const result = format(md, { generateUlid: mockUlid() });
  assertStringIncludes(result.output, "- [FREQ_0002] Alpha beta gamma\n");
  assertStringIncludes(result.output, `Id: ${MOCK_ULID}`);
  assertStringIncludes(result.output, "Body prose.");
});
