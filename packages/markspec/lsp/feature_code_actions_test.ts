import { assert, assertEquals } from "@std/assert";
import { ulid } from "@std/ulid";
import { formatFeatureText, parseFile, runPipeline } from "../core/mod.ts";
import { toLspDiagnostic } from "./diagnostics.ts";
import {
  buildFeatureCodeActions,
  commentPrefix,
  headerRun,
  trailerBlock,
  trailerKey,
} from "./feature_code_actions.ts";
import { splitCitationValues } from "./code_actions.ts";

Deno.test("commentPrefix: comment and non-comment lines", () => {
  assertEquals(commentPrefix("#     Key: v"), "#     ");
  assertEquals(commentPrefix("  # Key: v"), "  # ");
  assertEquals(commentPrefix("#"), "#");
  assertEquals(commentPrefix("  Given x"), undefined);
});

Deno.test("trailerKey: key lines only", () => {
  assertEquals(trailerKey("#     Verified-by: a"), "Verified-by");
  assertEquals(trailerKey("# Id : X"), "Id");
  assertEquals(trailerKey("# Body text: no"), undefined);
  assertEquals(trailerKey("# lower: no"), undefined);
  assertEquals(trailerKey("Given a: b"), undefined);
});

Deno.test("trailerBlock: git-style header", () => {
  const lines = [
    "# [SC_A_0001] Title",
    "#",
    "# Id: X",
    "# Satisfies: Y",
    "Feature: F",
  ];
  assertEquals(headerRun(lines, 0), { start: 0, end: 4 });
  assertEquals(trailerBlock(lines, 0), { start: 2, end: 4 });
});

Deno.test("trailerBlock: indented scenario header", () => {
  const lines = [
    "Feature: F",
    "  # [SC_A_0001] Title",
    "  #",
    "  # Id: X",
    "  Scenario: S",
  ];
  assertEquals(trailerBlock(lines, 1), { start: 3, end: 4 });
});

Deno.test("trailerBlock: indented trailer form", () => {
  const lines = ["# [SC_A_0001] T", "#", "#     Id: X", "#     Labels: a", "F"];
  assertEquals(trailerBlock(lines, 0), { start: 2, end: 4 });
});

Deno.test("trailerBlock: skips a trailing # line", () => {
  const lines = ["# [SC_A_0001] T", "#", "# Id: X", "#", "Feature: F"];
  assertEquals(trailerBlock(lines, 0), { start: 2, end: 3 });
});

Deno.test("trailerBlock: stops at the next header", () => {
  const lines = [
    "# [SC_A_0001] A",
    "# Id: X",
    "# [SC_A_0002] B",
    "# Id: Y",
    "F",
  ];
  assertEquals(trailerBlock(lines, 0), { start: 1, end: 2 });
});

Deno.test("trailerBlock: stops at a language line", () => {
  const lines = ["# [SC_A_0001] A", "# Id: X", "# language: fr", "F"];
  assertEquals(trailerBlock(lines, 0), { start: 1, end: 2 });
});

Deno.test("trailerBlock: never includes a step or doc-string line", () => {
  const lines = [
    "# [SC_A_0001] A",
    "# Id: X",
    "Scenario: S",
    "  Given a doc string:",
    '    """',
    "    Verified-by: z",
    '    """',
  ];
  assertEquals(trailerBlock(lines, 0), { start: 1, end: 2 });
});

Deno.test("headerRun and trailerBlock: non-header line", () => {
  const lines = ["# plain comment", "# Id: X", "Feature: F"];
  assertEquals(headerRun(lines, 0), undefined);
  assertEquals(trailerBlock(lines, 0), undefined);
  assertEquals(headerRun(lines, 2), undefined);
});

Deno.test("trailerBlock: header without a trailer", () => {
  const lines = ["# [SC_A_0001] A", "# body text", "Feature: F"];
  assertEquals(trailerBlock(lines, 0), { start: 2, end: 2 });
});

Deno.test("splitCitationValues: top-level split", () => {
  assertEquals(splitCitationValues("[@a], [@b]"), ["[@a]", "[@b]"]);
  assertEquals(splitCitationValues("[@a, p. 3], [@b]"), ["[@a, p. 3]", "[@b]"]);
  assertEquals(splitCitationValues("[@a]"), ["[@a]"]);
  assertEquals(splitCitationValues("[@a\\], b], [@c]"), ["[@a\\], b]", "[@c]"]);
  assertEquals(splitCitationValues(" , "), []);
  assertEquals(splitCitationValues("[@a\\"), ["[@a\\"]);
});

// ---------------------------------------------------------------------------
// buildFeatureCodeActions — from real diagnostics
// ---------------------------------------------------------------------------

type Edit = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
};

function applyEdits(text: string, edits: readonly Edit[]): string {
  const starts: number[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    starts.push(at);
    at += line.length + 1;
  }
  const offset = (p: { line: number; character: number }) =>
    p.line >= starts.length ? text.length : starts[p.line] + p.character;
  let out = text;
  for (
    const e of [...edits].sort((a, b) =>
      offset(b.range.start) - offset(a.range.start)
    )
  ) {
    out = out.slice(0, offset(e.range.start)) + e.newText +
      out.slice(offset(e.range.end));
  }
  return out;
}

/** Real diagnostics of `text` (parse + pipeline), as LSP diagnostics. */
async function diagnosticsOf(text: string, code: string) {
  const parsed = await parseFile(text, { file: "a.feature" });
  const piped = runPipeline(parsed.entries, null);
  return [...parsed.diagnostics, ...piped.diagnostics]
    .filter((d) => d.code === code)
    .map(toLspDiagnostic);
}

const URI = "file:///a.feature";

async function fix(text: string, code: string) {
  const diagnostics = await diagnosticsOf(text, code);
  assert(diagnostics.length > 0, `no ${code} diagnostic in input`);
  const actions = await buildFeatureCodeActions(
    URI,
    "a.feature",
    diagnostics,
    text,
  );
  const edits = actions.flatMap((a) => a.edit?.changes?.[URI] ?? []);
  return { actions, edits, fixed: applyEdits(text, edits) };
}

/** A git-style header and an indented scenario header, same trailer. */
function variants(trailer: string[]): Record<string, string> {
  const id = ulid();
  const id2 = ulid();
  const git = `# [SC_A_0001] Title\n#\n# Id: ${id}\n${
    trailer.map((l) => `# ${l}`).join("\n")
  }\nFeature: F\n\n  Scenario: S\n    Given x\n`;
  const indented = `Feature: F\n\n  # [SC_A_0002] Title\n  #\n  # Id: ${id2}\n${
    trailer.map((l) => `  # ${l}`).join("\n")
  }\n  Scenario: S\n    Given x\n`;
  return { git, indented };
}

async function assertGone(fixed: string, code: string) {
  assertEquals((await diagnosticsOf(fixed, code)).length, 0);
  assertEquals((await formatFeatureText(fixed, "a.feature")).changed, false);
}

Deno.test("A030: removes the generated-attribute line", async () => {
  for (const [name, text] of Object.entries(variants(["Derives: SC_X_0001"]))) {
    const { fixed } = await fix(text, "MSL-A030");
    assert(!fixed.includes("Derives"), name);
    assert(fixed.includes("# Id:"), name);
    await assertGone(fixed, "MSL-A030");
  }
});

Deno.test("A012: removes the empty-list line", async () => {
  for (const [name, text] of Object.entries(variants(["Verified-by: ,"]))) {
    const { fixed } = await fix(text, "MSL-A012");
    assert(!fixed.includes("Verified-by"), name);
    await assertGone(fixed, "MSL-A012");
  }
});

Deno.test("A013: keeps the first duplicate, removes later ones", async () => {
  for (
    const [name, text] of Object.entries(
      variants(["Type: Requirement", "Type: Constraint", "Type: Requirement"]),
    )
  ) {
    const { fixed } = await fix(text, "MSL-A013");
    assertEquals(fixed.match(/Type:/g)?.length, 1, name);
    assert(fixed.includes("Type: Requirement"), name);
    assert(!fixed.includes("Constraint"), name);
    await assertGone(fixed, "MSL-A013");
  }
});

Deno.test("T020: replaces the Type value with the closest core type", async () => {
  for (
    const [name, text] of Object.entries(variants(["Type: Requirment"]))
  ) {
    const { fixed } = await fix(text, "MSL-T020");
    assert(fixed.includes("Type: Requirement"), name);
    assert(!fixed.includes("Requirment"), name);
    await assertGone(fixed, "MSL-T020");
  }
});

Deno.test("T020: no close match gives no fix", async () => {
  const { git } = variants(["Type: Zzzzzzzzzzzzzzzzzzzz"]);
  const { actions } = await fix(git, "MSL-T020");
  assertEquals(actions, []);
});

Deno.test("A011: one line per value, keeps the # prefix", async () => {
  for (
    const [name, text] of Object.entries(
      variants(["References: [@a], [@b, p. 3]"]),
    )
  ) {
    const { fixed } = await fix(text, "MSL-A011");
    const lines = fixed.split("\n").filter((l) => l.includes("References:"));
    assertEquals(lines.length, 2, name);
    assert(lines.every((l) => l.trimStart().startsWith("# References: [@")));
    await assertGone(fixed, "MSL-A011");
  }
});

Deno.test("A011: CRLF file keeps CRLF and the # prefix", async () => {
  const { git } = variants(["References: [@a], [@b]"]);
  const crlf = git.replaceAll("\n", "\r\n");
  const { fixed } = await fix(crlf, "MSL-A011");
  assertEquals(fixed.replaceAll("\r\n", "").includes("\n"), false);
  assert(fixed.includes("# References: [@a]\r\n# References: [@b]\r\n"));
});

Deno.test("A030: CRLF whole-line deletion removes the line ending", async () => {
  const { git } = variants(["Derives: SC_X_0001"]);
  const crlf = git.replaceAll("\n", "\r\n");
  const { fixed } = await fix(crlf, "MSL-A030");
  assertEquals(fixed.replaceAll("\r\n", "").includes("\n"), false);
  assert(!fixed.includes("Derives"));
});

Deno.test("A011: a single value gives no fix", async () => {
  const diag = {
    code: "MSL-A011",
    message: "SC_A_0001: 'References' is citation-typed",
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 5 },
    },
  };
  const text = "# [SC_A_0001] T\n#\n# Id: X\n# References: [@a]\nFeature: F\n";
  assertEquals(
    await buildFeatureCodeActions(URI, "a.feature", [diag], text),
    [],
  );
});

Deno.test("regression: a later doc string is never edited", async () => {
  const id = ulid();
  const text = `# [SC_A_0001] Title
#
# Id: ${id}
# Type: Requirment
# Derives: SC_X_0001
# Verified-by: ,
# Type: Requirement
Feature: F

  Scenario: S
    Given a doc string:
      """
      Verified-by: TST_X_0002
      Type: Requirment
      Derives: SC_X_0003
      """
`;
  for (const code of ["MSL-A030", "MSL-A012", "MSL-A013", "MSL-T020"]) {
    const { edits, fixed } = await fix(text, code);
    assert(edits.length > 0, code);
    for (const e of edits) {
      assert(e.range.start.line >= 3 && e.range.end.line <= 7, code);
    }
    assert(fixed.includes("      Verified-by: TST_X_0002"), code);
    assert(fixed.includes("      Type: Requirment"), code);
    assert(fixed.includes("      Derives: SC_X_0003"), code);
    assert(fixed.includes(`# Id: ${id}`), code);
  }
});

Deno.test("other codes return nothing for now", async () => {
  const diag = {
    code: "MSL-B999",
    message: "x",
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 5 },
    },
  };
  assertEquals(
    await buildFeatureCodeActions(URI, "a.feature", [diag], "# [A_B_1] t\n"),
    [],
  );
});

// ---------------------------------------------------------------------------
// Exact fixed text, line choice, trailer-block bound
// ---------------------------------------------------------------------------

/** `text` without the first line that contains `needle`. */
function without(text: string, needle: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.includes(needle));
  assert(at >= 0, `no line with ${needle}`);
  lines.splice(at, 1);
  return lines.join("\n");
}

Deno.test("A030: exact fixed text, git-style and indented", async () => {
  for (const text of Object.values(variants(["Derives: SC_X_0001"]))) {
    assertEquals(
      (await fix(text, "MSL-A030")).fixed,
      without(text, "Derives"),
    );
  }
});

Deno.test("A012: exact fixed text, git-style and indented", async () => {
  for (const text of Object.values(variants(["Verified-by: ,"]))) {
    const { fixed } = await fix(text, "MSL-A012");
    assertEquals(fixed, without(text, "Verified-by"));
  }
});

Deno.test("A012: with two same-key lines removes the empty one", async () => {
  for (const text of Object.values(variants(["Labels: a", "Labels: ,"]))) {
    const { fixed } = await fix(text, "MSL-A012");
    assertEquals(fixed, without(text, "Labels: ,"));
    assert(fixed.includes("Labels: a"));
  }
});

Deno.test("A013: keeps the first value, exact text", async () => {
  const trailer = ["Type: Requirement", "Type: Constraint", "Type: Contract"];
  for (const text of Object.values(variants(trailer))) {
    const { fixed } = await fix(text, "MSL-A013");
    assertEquals(
      fixed,
      without(without(text, "Type: Constraint"), "Type: Contract"),
    );
  }
});

Deno.test("T020: exact fixed text, git-style and indented", async () => {
  for (const text of Object.values(variants(["Type: Requirment"]))) {
    const { fixed } = await fix(text, "MSL-T020");
    assertEquals(fixed, text.replace("Requirment", "Requirement"));
  }
});

Deno.test("A011: exact fixed text keeps the indent prefix", async () => {
  const { git, indented } = variants(["References: [@a], [@b]"]);
  assertEquals(
    (await fix(git, "MSL-A011")).fixed,
    git.replace(
      "# References: [@a], [@b]",
      "# References: [@a]\n# References: [@b]",
    ),
  );
  assertEquals(
    (await fix(indented, "MSL-A011")).fixed,
    indented.replace(
      "  # References: [@a], [@b]",
      "  # References: [@a]\n  # References: [@b]",
    ),
  );
});

Deno.test("A011: fixes the first line with two or more values", async () => {
  const { git } = variants(["References: [@a]", "References: [@b], [@c]"]);
  const { fixed } = await fix(git, "MSL-A011");
  assertEquals(
    fixed,
    git.replace(
      "# References: [@b], [@c]",
      "# References: [@b]\n# References: [@c]",
    ),
  );
});

Deno.test("A030: two same-key lines get one distinct line each", async () => {
  const { git } = variants(["Derives: SC_X_0001", "Derives: SC_X_0002"]);
  const diagnostics = await diagnosticsOf(git, "MSL-A030");
  assertEquals(diagnostics.length, 2);
  const actions = await buildFeatureCodeActions(
    URI,
    "a.feature",
    diagnostics,
    git,
  );
  const lines = actions.map((a) => a.edit!.changes![URI][0].range.start.line);
  assertEquals(new Set(lines).size, 2);
  const edits = actions.flatMap((a) => a.edit!.changes![URI]);
  assertEquals(
    applyEdits(git, edits),
    without(without(git, "SC_X_0001"), "SC_X_0002"),
  );
});

Deno.test("A013: never touches the Type line of another header", async () => {
  const [a, b] = [ulid(), ulid()];
  const text = `# [SC_A_0001] Feature
#
# Id: ${a}
# Type: Requirement
# Type: Constraint
Feature: F

  # [SC_A_0002] Scenario
  #
  # Id: ${b}
  # Type: Requirement
  Scenario: S
    Given x
`;
  const { fixed, edits } = await fix(text, "MSL-A013");
  assertEquals(edits.length, 1);
  assertEquals(fixed, without(text, "Type: Constraint"));
  assert(fixed.includes("  # Type: Requirement"));
});

// ---------------------------------------------------------------------------
// MSL-P021 — empty `# Key:` trailer line
// ---------------------------------------------------------------------------

async function assertNoWarnings(text: string) {
  for (const code of ["MSL-P021", "MSL-P020", "MSL-R003", "MSL-I003"]) {
    assertEquals((await diagnosticsOf(text, code)).length, 0, code);
  }
}

Deno.test("P021: removes only the empty line, keeps the Id", async () => {
  for (const [name, text] of Object.entries(variants(["Satisfies:"]))) {
    const diags = await diagnosticsOf(text, "MSL-P021");
    assertEquals(diags.length, 1, name);
    const { fixed, actions } = await fix(text, "MSL-P021");
    assertEquals(actions[0].title, "Remove empty 'Satisfies' line", name);
    assertEquals(fixed, without(text, "Satisfies:"), name);
    await assertNoWarnings(fixed);
    assertEquals((await formatFeatureText(fixed, "a.feature")).changed, false);
    const parsed = await parseFile(fixed, { file: "a.feature" });
    assertEquals(parsed.entries.length, 1, name);
    assert(parsed.entries[0].id, name);
  }
});

Deno.test("P021: several empty lines are all removed", async () => {
  for (const text of Object.values(variants(["Satisfies:", "Labels:"]))) {
    const { fixed, actions } = await fix(text, "MSL-P021");
    assertEquals(actions[0].title, "Remove empty trailer lines");
    assertEquals(fixed, without(without(text, "Satisfies:"), "Labels:"));
  }
});

Deno.test("P021: a non-empty line of the block stays", async () => {
  for (const text of Object.values(variants(["Labels: a", "Satisfies:"]))) {
    const { fixed } = await fix(text, "MSL-P021");
    assertEquals(fixed, without(text, "Satisfies:"));
  }
});

Deno.test("P021: an all-empty block also removes the # line above", async () => {
  const git = "# [SC_A_0001] Title\n#\n# Satisfies:\n# Labels:\nFeature: F\n";
  const { fixed } = await fix(git, "MSL-P021");
  assertEquals(fixed, "# [SC_A_0001] Title\nFeature: F\n");
  const indented =
    "Feature: F\n\n  # [SC_A_0002] Title\n  #\n  # Satisfies:\n  Scenario: S\n    Given x\n";
  assertEquals(
    (await fix(indented, "MSL-P021")).fixed,
    "Feature: F\n\n  # [SC_A_0002] Title\n  Scenario: S\n    Given x\n",
  );
});

Deno.test("P021: CRLF file", async () => {
  const { git } = variants(["Satisfies:"]);
  const crlf = git.replaceAll("\n", "\r\n");
  const { fixed } = await fix(crlf, "MSL-P021");
  assertEquals(fixed, without(crlf, "Satisfies:"));
  assertEquals(fixed.replaceAll("\r\n", "").includes("\n"), false);
});

Deno.test("P021: a non-empty malformed line gives no fix", async () => {
  const text =
    `# [SC_A_0001] T\n#\n# Id: ${ulid()}\n# Satisfies STK\nFeature: F\n`;
  const diagnostics = await diagnosticsOf(text, "MSL-P021");
  const actions = await buildFeatureCodeActions(
    URI,
    "a.feature",
    diagnostics,
    text,
  );
  assertEquals(actions, []);
});

Deno.test("P021: a diagnostic on a non-comment line gives no fix", async () => {
  const diag = {
    code: "MSL-P021",
    message: "x",
    range: {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 5 },
    },
  };
  assertEquals(
    await buildFeatureCodeActions(
      URI,
      "a.feature",
      [diag],
      "# [SC_A_0001] T\nFeature: F\n",
    ),
    [],
  );
});

// ---------------------------------------------------------------------------
// MSL-B069 — blank line between a header and its node
// ---------------------------------------------------------------------------

const SC = "# [SC_A_0001] Title\n";

Deno.test("B069: a blank line above a Scenario is removed", async () => {
  const text =
    `Feature: F\n\n  # [SC_A_0002] T\n\n  Scenario: S\n    Given x\n`;
  const { fixed, actions } = await fix(text, "MSL-B069");
  assertEquals(
    fixed,
    `Feature: F\n\n  # [SC_A_0002] T\n  Scenario: S\n    Given x\n`,
  );
  assertEquals(actions.length, 1);
  assertEquals(
    actions[0].title,
    "Remove the blank line between the header and the node",
  );
  assertEquals(actions[0].isPreferred, true);
  assertEquals((await diagnosticsOf(fixed, "MSL-B069")).length, 0);
});

Deno.test("B069: a blank line above a Feature is removed", async () => {
  const text = `${SC}\nFeature: F\n\n  Scenario: S\n    Given x\n`;
  const { fixed } = await fix(text, "MSL-B069");
  assertEquals(fixed, `${SC}Feature: F\n\n  Scenario: S\n    Given x\n`);
});

Deno.test("B069: a blank line after a tag line is removed", async () => {
  const text =
    `Feature: F\n\n  # [SC_A_0002] T\n  @tag\n\n  Scenario: S\n    Given x\n`;
  const { fixed } = await fix(text, "MSL-B069");
  assertEquals(
    fixed,
    `Feature: F\n\n  # [SC_A_0002] T\n  @tag\n  Scenario: S\n    Given x\n`,
  );
});

Deno.test("B069: two blank lines are both removed", async () => {
  const text =
    `Feature: F\n\n  # [SC_A_0002] T\n\n\n  Scenario: S\n    Given x\n`;
  const { fixed, actions } = await fix(text, "MSL-B069");
  assertEquals(
    fixed,
    `Feature: F\n\n  # [SC_A_0002] T\n  Scenario: S\n    Given x\n`,
  );
  assertEquals(
    actions[0].title,
    "Remove the blank lines between the header and the node",
  );
});

Deno.test("B069: CRLF file", async () => {
  const text = `Feature: F\n\n  # [SC_A_0002] T\n\n  Scenario: S\n    Given x\n`
    .replaceAll("\n", "\r\n");
  const { fixed } = await fix(text, "MSL-B069");
  assertEquals(
    fixed,
    `Feature: F\n\n  # [SC_A_0002] T\n  Scenario: S\n    Given x\n`
      .replaceAll("\n", "\r\n"),
  );
});

Deno.test("B069: a language file with a localized keyword", async () => {
  const text =
    `# language: fr\nFonctionnalité: F\n\n  # [SC_A_0002] T\n\n  Scénario: S\n    Soit x\n`;
  const { fixed } = await fix(text, "MSL-B069");
  assertEquals(
    fixed,
    `# language: fr\nFonctionnalité: F\n\n  # [SC_A_0002] T\n  Scénario: S\n    Soit x\n`,
  );
});

async function noFix(text: string) {
  const diagnostics = await diagnosticsOf(text, "MSL-B069");
  assert(diagnostics.length > 0, "no MSL-B069 diagnostic in input");
  assertEquals(
    await buildFeatureCodeActions(URI, "a.feature", diagnostics, text),
    [],
  );
}

Deno.test("B069: no fix above a Background after a blank line", async () => {
  await noFix(
    `Feature: F\n\n  # [SC_A_0002] T\n\n  Background:\n    Given x\n\n  Scenario: S\n    Given y\n`,
  );
});

Deno.test("B069: no fix above a Background with no gap", async () => {
  await noFix(
    `Feature: F\n\n  # [SC_A_0002] T\n  Background:\n    Given x\n\n  Scenario: S\n    Given y\n`,
  );
});

Deno.test("B069: no fix above a step", async () => {
  await noFix(
    `Feature: F\n\n  Scenario: S\n    # [SC_A_0002] T\n\n    Given x\n`,
  );
});

Deno.test("B069: no fix for the upper header of a stack", async () => {
  const text =
    `Feature: F\n\n  # [SC_A_0002] A\n\n  # [SC_A_0003] B\n  Scenario: S\n    Given x\n`;
  const diagnostics = (await diagnosticsOf(text, "MSL-B069")).filter((d) =>
    d.range.start.line === 2
  );
  assert(diagnostics.length > 0, "no B069 on the upper header");
  assertEquals(
    await buildFeatureCodeActions(URI, "a.feature", diagnostics, text),
    [],
  );
});

// ---------------------------------------------------------------------------
// MSL-P021 guards (synthetic diagnostics)
// ---------------------------------------------------------------------------

function syntheticP021(line: number) {
  return {
    code: "MSL-P021",
    message: "x",
    range: {
      start: { line, character: 0 },
      end: { line, character: 5 },
    },
  };
}

Deno.test("P021: a non-empty `# Satisfies: X` line gives no fix", async () => {
  const text = `# [SC_A_0001] T\n#\n# Satisfies: X\nFeature: F\n`;
  assertEquals(
    await buildFeatureCodeActions(URI, "a.feature", [syntheticP021(2)], text),
    [],
  );
});

Deno.test("P021: an empty `# Key:` line after the run ends gives no fix", async () => {
  const afterRun = `# [SC_A_0001] T\nFeature: F\n# Satisfies:\n`;
  assertEquals(
    await buildFeatureCodeActions(
      URI,
      "a.feature",
      [syntheticP021(2)],
      afterRun,
    ),
    [],
  );
  const afterBlank = `# [SC_A_0001] T\n\n# Satisfies:\nFeature: F\n`;
  assertEquals(
    await buildFeatureCodeActions(
      URI,
      "a.feature",
      [syntheticP021(2)],
      afterBlank,
    ),
    [],
  );
});

Deno.test("P021: an all-empty block under body text deletes only the block", async () => {
  const text = `# [SC_A_0001] T\n# Body text.\n# Satisfies:\nFeature: F\n`;
  const actions = await buildFeatureCodeActions(
    URI,
    "a.feature",
    [syntheticP021(2)],
    text,
  );
  const edits = actions.flatMap((a) => a.edit?.changes?.[URI] ?? []);
  assertEquals(
    applyEdits(text, edits),
    `# [SC_A_0001] T\n# Body text.\nFeature: F\n`,
  );
});
