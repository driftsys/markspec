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
