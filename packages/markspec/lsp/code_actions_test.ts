/**
 * @module lsp/code_actions_test
 *
 * Unit tests for {@linkcode buildCodeActions} — produces LSP code
 * actions (quick fixes) for the diagnostics MarkSpec knows how to
 * mechanically repair.
 */

import { assertEquals } from "@std/assert";
import { parseFile } from "../core/mod.ts";
import { buildCodeActions, type LspDiagnosticLike } from "./code_actions.ts";
import { toLspDiagnostic } from "./diagnostics.ts";

function diag(opts: {
  code: string;
  message: string;
  line: number;
  character: number;
}): LspDiagnosticLike {
  return {
    code: opts.code,
    severity: 2,
    message: opts.message,
    range: {
      start: { line: opts.line, character: opts.character },
      end: { line: opts.line, character: Number.MAX_SAFE_INTEGER },
    },
  };
}

const DOC_WITH_GENERATED = `# Test

- [REQ-001] My requirement

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Superseded-by: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;

const DOC_WITH_TYPO = `# Test

- [REQ-001] My requirement

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirment
`;

const DOC_WITH_DUP_TYPE = `# Test

- [REQ-001] My requirement

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Requirement
      Type: Specification
`;

const DOC_WITH_CSV_REFS = `# Test

- [REQ-001] My requirement

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      References: ISO-1, ISO-2, ISO-3
`;

const DOC_WITH_EMPTY_LABELS = `# Test

- [REQ-001] My requirement

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Labels: , ,
`;

Deno.test("buildCodeActions: MSL-A012 → remove empty repeatable line", () => {
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-A012",
      message:
        "REQ-001: 'Labels' is a repeatable attribute but the value list is empty (spec §1.8)",
      line: 2,
      character: 0,
    }),
  ], DOC_WITH_EMPTY_LABELS);
  assertEquals(actions.length, 1);
  const a = actions[0];
  assertEquals(a.title, "Remove empty 'Labels' line");
  assertEquals(a.kind, "quickfix");
  const edit = a.edit!.changes!["file:///x.md"][0];
  // Labels line is line 7 (0-based); the edit deletes the whole line.
  assertEquals(edit.newText, "");
  assertEquals(edit.range.start.line, 7);
  assertEquals(edit.range.start.character, 0);
  assertEquals(edit.range.end.line, 8);
  assertEquals(edit.range.end.character, 0);
});

Deno.test("buildCodeActions: MSL-A012 with missing source text yields no action", () => {
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-A012",
      message:
        "REQ-001: 'Labels' is a repeatable attribute but the value list is empty",
      line: 2,
      character: 0,
    }),
  ]);
  assertEquals(actions, []);
});

const DOC_WITH_EMPTY_SATISFIES = `# Test

- [REQ-001] My requirement

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Satisfies:
`;

const P021_SATISFIES_MSG =
  `REQ-001: trailer line does not match 'Key: Value' syntax (spec section 4.1): "Satisfies:"`;

/** An MSL-P021 diagnostic located on the offending trailer line. */
function p021(line: number, message = P021_SATISFIES_MSG): LspDiagnosticLike {
  return diag({ code: "MSL-P021", message, line, character: 6 });
}

Deno.test("buildCodeActions: MSL-P021 empty-valued trailer → remove line", () => {
  const actions = buildCodeActions("file:///x.md", [
    p021(7),
  ], DOC_WITH_EMPTY_SATISFIES);
  assertEquals(actions.length, 1);
  const a = actions[0];
  assertEquals(a.title, "Remove empty 'Satisfies' line");
  assertEquals(a.kind, "quickfix");
  assertEquals(a.isPreferred, true);
  const edit = a.edit!.changes!["file:///x.md"][0];
  // Satisfies line is line 7 (0-based); the edit deletes the whole line.
  assertEquals(edit.newText, "");
  assertEquals(edit.range.start, { line: 7, character: 0 });
  assertEquals(edit.range.end, { line: 8, character: 0 });
});

Deno.test("buildCodeActions: MSL-P021 does not depend on the message wording", () => {
  const actions = buildCodeActions("file:///x.md", [
    p021(7, "REQ-001: some future wording without a quoted line"),
  ], DOC_WITH_EMPTY_SATISFIES);
  assertEquals(actions.length, 1);
  assertEquals(actions[0].title, "Remove empty 'Satisfies' line");
});

Deno.test("buildCodeActions: MSL-P021 empty Id: with trailing spaces → remove line", () => {
  const doc = `- [REQ-001] My requirement

  Body.

      Id:\u0020\u0020
      Labels: ASIL-B
`;
  const actions = buildCodeActions("file:///x.md", [p021(4)], doc);
  assertEquals(actions.length, 1);
  assertEquals(actions[0].title, "Remove empty 'Id' line");
  const edit = actions[0].edit!.changes!["file:///x.md"][0];
  assertEquals(edit.range.start, { line: 4, character: 0 });
  assertEquals(edit.range.end, { line: 5, character: 0 });
});

Deno.test("buildCodeActions: MSL-P021 non-empty malformed line yields no action", () => {
  const doc = `- [REQ-001] My requirement

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      not a trailer
`;
  const actions = buildCodeActions("file:///x.md", [p021(5)], doc);
  assertEquals(actions, []);
});

Deno.test("buildCodeActions: MSL-P021 with missing source text yields no action", () => {
  const actions = buildCodeActions("file:///x.md", [p021(7)]);
  assertEquals(actions, []);
});

Deno.test("buildCodeActions: MSL-P021 ignores an unindented line", () => {
  const doc = `- [REQ-001] My requirement

  Satisfies:
`;
  const actions = buildCodeActions("file:///x.md", [p021(2)], doc);
  assertEquals(actions, []);
});

Deno.test("buildCodeActions: MSL-P021 on a non-trailer line yields no action", () => {
  // A diagnostic pointing at a title line (or out of range) is not
  // fixable — the fix never scans for a matching line elsewhere.
  const actions = buildCodeActions("file:///x.md", [
    p021(2),
    p021(99),
  ], DOC_WITH_EMPTY_SATISFIES);
  assertEquals(actions, []);
});

Deno.test("buildCodeActions: MSL-P021 never reaches into the next entry", () => {
  const doc = `- [REQ-001] First

  Body.

      Satisfies:

- [REQ-002] Second

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Satisfies:
`;
  const actions = buildCodeActions("file:///x.md", [p021(4)], doc);
  assertEquals(actions.length, 1);
  const edits = actions[0].edit!.changes!["file:///x.md"];
  assertEquals(edits.length, 1);
  // REQ-001's block (and its leading blank) only — REQ-002 untouched.
  assertEquals(edits[0].range.start, { line: 3, character: 0 });
  assertEquals(edits[0].range.end, { line: 5, character: 0 });
});

Deno.test("buildCodeActions: MSL-P021 matches a tab-indented trailer", () => {
  const doc =
    "- [REQ-001] First\n\n  Body.\n\n\tId: 01HGW2Q8MNP3RSTVWXYZABCDEF\n\tSatisfies:\n";
  const actions = buildCodeActions("file:///x.md", [p021(5)], doc);
  assertEquals(actions.length, 1);
  const edit = actions[0].edit!.changes!["file:///x.md"][0];
  assertEquals(edit.range.start, { line: 5, character: 0 });
  assertEquals(edit.range.end, { line: 6, character: 0 });
});

Deno.test("buildCodeActions: MSL-P021 targets the trailer, not a body example", () => {
  const doc = `- [REQ-001] First

  Example:

      Satisfies:

  More body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Satisfies:
`;
  const actions = buildCodeActions("file:///x.md", [p021(9)], doc);
  assertEquals(actions.length, 1);
  const edits = actions[0].edit!.changes!["file:///x.md"];
  assertEquals(edits.length, 1);
  assertEquals(edits[0].range.start, { line: 9, character: 0 });
  assertEquals(edits[0].range.end, { line: 10, character: 0 });
});

Deno.test("buildCodeActions: MSL-P021 drops an all-empty block and its leading blank", () => {
  const doc = `- [REQ-001] First

  Body.

      Id:
      Satisfies:
`;
  const actions = buildCodeActions("file:///x.md", [p021(5)], doc);
  assertEquals(actions.length, 1);
  assertEquals(actions[0].title, "Remove empty trailer lines");
  const edits = actions[0].edit!.changes!["file:///x.md"];
  assertEquals(edits.length, 1);
  // Lines 3 (blank) through 5 removed: the body ends at "  Body.".
  assertEquals(edits[0].range.start, { line: 3, character: 0 });
  assertEquals(edits[0].range.end, { line: 6, character: 0 });
});

Deno.test("buildCodeActions: MSL-P021 removes every empty line in the block", () => {
  const doc = `- [REQ-001] First

  Body.

      Id:
      Labels: ASIL-B
      Satisfies:
`;
  const actions = buildCodeActions("file:///x.md", [p021(6)], doc);
  assertEquals(actions.length, 1);
  const edits = actions[0].edit!.changes!["file:///x.md"];
  assertEquals(edits.map((e) => e.range.start.line), [4, 6]);
});

Deno.test("buildCodeActions: MSL-A011 → rewrite citation CSV as multi-line", () => {
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-A011",
      message:
        "REQ-001: 'References' is citation-typed and must use multi-line form (spec §2.3.2)",
      line: 2,
      character: 0,
    }),
  ], DOC_WITH_CSV_REFS);
  assertEquals(actions.length, 1);
  const a = actions[0];
  assertEquals(a.title, "Rewrite 'References' as multi-line");
  assertEquals(a.kind, "quickfix");
  const edit = a.edit!.changes!["file:///x.md"][0];
  // The CSV line (line 7) is replaced with three indented lines,
  // preserving the original 6-space indent.
  assertEquals(edit.range.start.line, 7);
  assertEquals(edit.range.start.character, 0);
  assertEquals(edit.range.end.line, 8);
  assertEquals(edit.range.end.character, 0);
  assertEquals(
    edit.newText,
    "      References: ISO-1\n      References: ISO-2\n      References: ISO-3\n",
  );
});

Deno.test("buildCodeActions: MSL-A011 with a single value yields no action", () => {
  const doc = `# Test\n\n      References: ISO-1\n`;
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-A011",
      message:
        "REQ-001: 'References' is citation-typed and must use multi-line form",
      line: 0,
      character: 0,
    }),
  ], doc);
  assertEquals(actions, []);
});

Deno.test("buildCodeActions: MSL-A013 → remove duplicate single-cardinality lines", () => {
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-A013",
      message:
        "REQ-001: 'Type' is single-cardinality but appears more than once (spec §1.8)",
      line: 2,
      character: 0,
    }),
  ], DOC_WITH_DUP_TYPE);
  assertEquals(actions.length, 1);
  const a = actions[0];
  assertEquals(a.title, "Remove duplicate 'Type' line(s)");
  assertEquals(a.kind, "quickfix");
  const edits = a.edit!.changes!["file:///x.md"];
  // First Type line (line 7) is kept; the duplicate (line 8) is
  // deleted. Exactly one edit, covering line 8's full line.
  assertEquals(edits.length, 1);
  assertEquals(edits[0].newText, "");
  assertEquals(edits[0].range.start.line, 8);
  assertEquals(edits[0].range.start.character, 0);
  assertEquals(edits[0].range.end.line, 9);
  assertEquals(edits[0].range.end.character, 0);
});

Deno.test("buildCodeActions: MSL-A013 with only one occurrence yields no action", () => {
  // Defensive: a single Type line means nothing to dedup.
  const doc = `# Test\n\n      Type: Requirement\n`;
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-A013",
      message:
        "REQ-001: 'Type' is single-cardinality but appears more than once",
      line: 0,
      character: 0,
    }),
  ], doc);
  assertEquals(actions, []);
});

Deno.test("buildCodeActions: MSL-T020 → suggest closest core type", () => {
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-T020",
      message:
        "REQ-001: Type: 'Requirment' is not a core type or a profile-declared type",
      line: 2,
      character: 0,
    }),
  ], DOC_WITH_TYPO);
  // Should suggest 'Requirement' (closest match).
  const reqAction = actions.find((a) => a.title.includes("Requirement"));
  assertEquals(
    reqAction !== undefined,
    true,
    `expected a 'Requirement' suggestion, got: ${
      actions.map((a) => a.title).join(", ")
    }`,
  );
  const edit = reqAction!.edit!.changes!["file:///x.md"][0];
  assertEquals(edit.newText, "Requirement");
  // Line 7 (0-based) is the `Type: Requirment` line. Column 12 is
  // where 'Requirment' starts (after `      Type: `).
  assertEquals(edit.range.start.line, 7);
  assertEquals(edit.range.start.character, 12);
  assertEquals(edit.range.end.character, 22); // 12 + 'Requirment'.length
});

Deno.test("buildCodeActions: MSL-T020 with valid core type far from any match yields no action", () => {
  // 'Xyz' has edit distance >3 to every core type → no suggestion.
  const doc = `# Test\n\n      Type: Xyz\n`;
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-T020",
      message: "REQ-001: Type: 'Xyz' is not a core type",
      line: 0,
      character: 0,
    }),
  ], doc);
  assertEquals(actions, []);
});

Deno.test("buildCodeActions: MSL-A030 → remove generated-attribute line", () => {
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-A030",
      message:
        "REQ-001: 'Superseded-by' has generated origin and must not appear in source",
      line: 2,
      character: 0,
    }),
  ], DOC_WITH_GENERATED);
  assertEquals(actions.length, 1);
  const a = actions[0];
  assertEquals(a.title, "Remove 'Superseded-by' line");
  assertEquals(a.kind, "quickfix");
  const edit = a.edit!.changes!["file:///x.md"][0];
  // The Superseded-by line is line 7 (0-based) of DOC_WITH_GENERATED.
  // The TextEdit covers the entire line including its trailing newline.
  assertEquals(edit.newText, "");
  assertEquals(edit.range.start.line, 7);
  assertEquals(edit.range.start.character, 0);
  assertEquals(edit.range.end.line, 8);
  assertEquals(edit.range.end.character, 0);
});

Deno.test("buildCodeActions: MSL-A030 with missing source text yields no action", () => {
  // Without the document text, the helper can't locate the line.
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-A030",
      message: "REQ-001: 'Derives' has generated origin",
      line: 2,
      character: 0,
    }),
  ]);
  assertEquals(actions, []);
});

Deno.test("buildCodeActions: MSL-M060 → lowercase keyword quick fix", () => {
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-M060",
      message: "REQ-001: modal keyword 'SHALL' in body prose is uppercase",
      line: 4,
      character: 14,
    }),
  ]);
  assertEquals(actions.length, 1);
  const a = actions[0];
  assertEquals(a.title, "Lowercase 'shall'");
  assertEquals(a.kind, "quickfix");
  assertEquals(a.isPreferred, true);
  const edit = a.edit!.changes!["file:///x.md"][0];
  assertEquals(edit.newText, "shall");
  assertEquals(edit.range.start.line, 4);
  assertEquals(edit.range.start.character, 14);
  assertEquals(edit.range.end.line, 4);
  // 'SHALL' is 5 chars.
  assertEquals(edit.range.end.character, 19);
});

Deno.test("buildCodeActions: MSL-M060 with NOT suffix → lowercases both tokens", () => {
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-M060",
      message: "REQ-001: modal keyword 'MUST NOT' in body prose is uppercase",
      line: 0,
      character: 10,
    }),
  ]);
  assertEquals(actions.length, 1);
  const edit = actions[0].edit!.changes!["file:///x.md"][0];
  assertEquals(edit.newText, "must not");
  assertEquals(edit.range.end.character, 18);
});

Deno.test("buildCodeActions: unrelated diagnostic code yields no action", () => {
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-T020",
      message: "REQ-001: Type: 'NotARealType' is not a core type",
      line: 5,
      character: 0,
    }),
  ]);
  assertEquals(actions, []);
});

Deno.test("buildCodeActions: empty diagnostics list yields empty actions", () => {
  assertEquals(buildCodeActions("file:///x.md", []), []);
});

Deno.test("buildCodeActions: MSL-M060 with malformed message yields no action", () => {
  // Missing the 'KEYWORD' single-quoted token in the message.
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-M060",
      message: "REQ-001: something went wrong",
      line: 0,
      character: 0,
    }),
  ]);
  assertEquals(actions, []);
});

// ─────────────────────────────────────────────────────────────────────
// Task 27 — MSL-L / MSL-S code actions
// ─────────────────────────────────────────────────────────────────────

Deno.test("MSL-L010: code action adds Reference-url placeholder", () => {
  const docText = `- [@ISO-26262-6] ISO 26262 Part 6

      Id: urn:iso:std:iso:26262:-6:ed-2
`;
  const actions = buildCodeActions(
    "file:///t.md",
    [diag({
      code: "MSL-L010",
      message: "Reference 'ISO-26262-6' has no Reference-url:",
      line: 0,
      character: 0,
    })],
    docText,
  );
  assertEquals(actions.length, 1);
  assertEquals(actions[0].title.includes("Reference-url"), true);
});

Deno.test("MSL-S003: code action replaces newest-wins with manual", () => {
  const docText = `conflict:
  default: newest-wins
`;
  const actions = buildCodeActions(
    "file:///jira.yaml",
    [diag({
      code: "MSL-S003",
      message: "Unknown conflict policy 'newest-wins'",
      line: 1,
      character: 11,
    })],
    docText,
  );
  assertEquals(actions.length, 1);
  assertEquals(actions[0].title.includes("manual"), true);
});

Deno.test("MSL-S002: code action removes locked: true line", () => {
  const docText = `attributes:
  - markspec: Labels
    external: labels
    direction: outbound
    locked: true
`;
  const actions = buildCodeActions(
    "file:///jira.yaml",
    [diag({
      code: "MSL-S002",
      message:
        "Attribute 'Labels': locked: true contradicts direction: outbound",
      line: 4,
      character: 4,
    })],
    docText,
  );
  assertEquals(actions.length, 1);
  assertEquals(actions[0].title.toLowerCase().includes("locked"), true);
});

Deno.test("MSL-S010: code action surfaces connector-required workflow note", () => {
  const actions = buildCodeActions(
    "file:///t.md",
    [diag({
      code: "MSL-S010",
      message: "Locked attribute 'Title' was edited locally",
      line: 0,
      character: 0,
    })],
    "(any text — handler doesn't read it)",
  );
  assertEquals(actions.length, 1);
  assertEquals(actions[0].title.toLowerCase().includes("upstream"), true);
});

Deno.test("buildCodeActions: MSL-P021 fix lines up with the parser's location", async () => {
  const { diagnostics } = await parseFile(DOC_WITH_EMPTY_SATISFIES, {
    file: "/x.md",
  });
  const lspDiags = diagnostics
    .filter((d) => d.code === "MSL-P021")
    .map(toLspDiagnostic);
  assertEquals(lspDiags.length, 1);
  assertEquals(lspDiags[0].range.start, { line: 7, character: 6 });
  const actions = buildCodeActions(
    "file:///x.md",
    lspDiags,
    DOC_WITH_EMPTY_SATISFIES,
  );
  assertEquals(actions.length, 1);
  const edit = actions[0].edit!.changes!["file:///x.md"][0];
  assertEquals(edit.range.start, { line: 7, character: 0 });
});

Deno.test("buildCodeActions: MSL-P021 fix lines up after YAML front matter", async () => {
  const doc = `---\ndocument-id: DOC-1\n---\n\n${DOC_WITH_EMPTY_SATISFIES}`;
  const { diagnostics } = await parseFile(doc, { file: "/x.md" });
  const lspDiags = diagnostics
    .filter((d) => d.code === "MSL-P021")
    .map(toLspDiagnostic);
  assertEquals(lspDiags.length, 1);
  const actions = buildCodeActions("file:///x.md", lspDiags, doc);
  assertEquals(actions.length, 1);
  const edit = actions[0].edit!.changes!["file:///x.md"][0];
  // DOC_WITH_EMPTY_SATISFIES's `Satisfies:` (line 7) shifted by 4 lines.
  assertEquals(edit.range.start, { line: 11, character: 0 });
});
