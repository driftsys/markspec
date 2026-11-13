import { assert, assertEquals } from "@std/assert";
import { loadGherkin } from "./load.ts";
import { parseFeature } from "./parse.ts";
import type { FeatureAst } from "./types.ts";

const api = await loadGherkin();

function feature(source: string): FeatureAst {
  const result = parseFeature(api, source);
  assert(result.ok, result.ok ? "" : result.message);
  return result.feature;
}

const kinds = (f: FeatureAst) => f.scenarios[0].steps.map((s) => s.normalized);

Deno.test("parseFeature: wraps a block with no Feature line", () => {
  const f = feature("@smoke\nScenario: Stop\n  Given a\n  When b\n  Then c\n");
  assertEquals(f.synthetic, true);
  assertEquals(f.name, "");
  assertEquals(f.language, "en");
  assertEquals(f.scenarios[0].range.start.line, 2);
  assertEquals(f.scenarios[0].tags, ["@smoke"]);
  assertEquals(kinds(f), ["given", "when", "then"]);
  assertEquals(f.scenarios[0].steps[0].range.start.line, 3);
  assertEquals(f.sections.map((s) => s.keyword), ["Scenario"]);
});

Deno.test("parseFeature: wraps after the language line", () => {
  const f = feature("# language: de\nSzenario: S\n  Angenommen a\n");
  assertEquals(f.synthetic, true);
  assertEquals(f.language, "de");
  assertEquals(f.scenarios[0].range.start.line, 2);
  assertEquals(kinds(f), ["given"]);
});

Deno.test("parseFeature: keeps a real Feature", () => {
  const f = feature(
    "Feature: Brake\n  Some text\n\n  Scenario: Stop\n    Given a\n",
  );
  assertEquals(f.synthetic, false);
  assertEquals(f.name, "Brake");
  assertEquals(f.keyword, "Feature");
  assertEquals(f.description.trim(), "Some text");
  assertEquals(f.scenarios[0].range.start.line, 4);
  assertEquals(f.sections.map((s) => s.keyword), ["Feature", "Scenario"]);
});

Deno.test("parseFeature: normalizes And, But and star", () => {
  const f = feature("Scenario: S\n  Given a\n  And b\n  But c\n  * d\n");
  assertEquals(kinds(f), ["given", "and", "but", "step"]);
  assertEquals(f.scenarios[0].steps[1].keyword, "And");
  assertEquals(f.scenarios[0].steps[3].keyword, "*");
});

Deno.test("parseFeature: normalizes French Et and Mais", () => {
  const f = feature(
    "# language: fr\nScénario: S\n  Soit a\n  Et b\n  Mais c\n  * d\n  Quand e\n  Alors f\n",
  );
  assertEquals(kinds(f), [
    "given",
    "and",
    "but",
    "step",
    "when",
    "then",
  ]);
  assertEquals(f.scenarios[0].steps[1].keyword, "Et");
});

Deno.test("parseFeature: outline, examples, rule and background", () => {
  const f = feature(
    [
      "Feature: F",
      "  Background:",
      "    Given top",
      "",
      "  Rule: R",
      "    Background:",
      "      Given in rule",
      "",
      "    @t",
      "    Scenario Outline: O",
      "      When <x>",
      "      Then <y>",
      "",
      "      Examples: first",
      "        | x | y |",
      "        | 1 | 2 |",
      "        | 3 | 4 |",
      "",
      "      @e",
      "      Examples: second",
      "        | x | y |",
      "        | 5 | 6 |",
      "",
    ].join("\n"),
  );
  const s = f.scenarios[0];
  assertEquals(f.scenarios.length, 1);
  assertEquals(s.ruleName, "R");
  assertEquals(s.isOutline, true);
  assertEquals(s.tags, ["@t"]);
  assertEquals(s.background.map((b) => b.text), ["top", "in rule"]);
  assertEquals(s.examples.length, 2);
  assertEquals(s.examples[0].name, "first");
  assertEquals(s.examples[0].header, ["x", "y"]);
  assertEquals(s.examples[0].rows, [["1", "2"], ["3", "4"]]);
  assertEquals(s.examples[1].tags, ["@e"]);
  assertEquals(s.examples[1].range.start.line, 20);
  assertEquals(f.sections.map((x) => x.keyword), [
    "Feature",
    "Background",
    "Rule",
    "Background",
    "Scenario Outline",
    "Examples",
    "Examples",
  ]);
});

Deno.test("parseFeature: a plain scenario is not an outline", () => {
  const f = feature("Scenario: S\n  Given a\n");
  assertEquals(f.scenarios[0].isOutline, false);
  assertEquals(f.scenarios[0].examples, []);
  assertEquals(f.scenarios[0].background, []);
});

Deno.test("parseFeature: keeps doc strings and data tables", () => {
  const f = feature(
    [
      "Scenario: S",
      "  Given a doc",
      '    """json',
      "    Scenario: fake",
      "    Feature: nope",
      '    """',
      "  And a table",
      "    | a | b |",
      "    | 1 | 2 |",
      "",
    ].join("\n"),
  );
  const [doc, table] = f.scenarios[0].steps;
  assertEquals(doc.docString, {
    mediaType: "json",
    content: "Scenario: fake\nFeature: nope",
  });
  assertEquals(table.dataTable, [["a", "b"], ["1", "2"]]);
  assertEquals(f.scenarios.length, 1);
  assertEquals(f.sections.map((s) => s.keyword), ["Scenario"]);
  assertEquals(table.range.end.line, 9);
});

Deno.test("parseFeature: reports a parse error at the source line", () => {
  const result = parseFeature(
    api,
    "Scenario: x\n  Given a\n  Feature: y\n",
  );
  assert(!result.ok);
  assertEquals(result.line, 3);
  assert(result.message.length > 0);
});

Deno.test("parseFeature: an error after a language line keeps source lines", () => {
  const result = parseFeature(
    api,
    "# language: fr\nScénario: x\n  Soit a\n  Fonctionnalité: y\n",
  );
  assert(!result.ok);
  assertEquals(result.line, 4);
});

Deno.test("parseFeature: finds the language line after blank lines", () => {
  const f = feature("\n# language: fr\nScénario: S\n  Soit a\n");
  assertEquals(f.synthetic, true);
  assertEquals(f.language, "fr");
  assertEquals(f.scenarios.length, 1);
  assertEquals(f.scenarios[0].range.start.line, 3);
  assertEquals(kinds(f), ["given"]);
});

Deno.test("parseFeature: finds the language line after a comment", () => {
  const f = feature("# note\n# language: de\nSzenario: S\n  Angenommen a\n");
  assertEquals(f.language, "de");
  assertEquals(f.scenarios[0].range.start.line, 3);
  assertEquals(kinds(f), ["given"]);
});

Deno.test("parseFeature: an empty or blank block gives no scenarios", () => {
  for (const source of ["", "  \n\n"]) {
    const f = feature(source);
    assertEquals(f.synthetic, true);
    assertEquals(f.scenarios, []);
    assertEquals(f.sections, []);
  }
});

Deno.test("parseFeature: an outline keyword with no Examples is an outline", () => {
  const f = feature("Scenario Outline: O\n  Given <x>\n");
  assertEquals(f.scenarios[0].isOutline, true);
  assertEquals(f.scenarios[0].examples, []);
});

Deno.test("parseFeature: a tag line before a real Feature is not wrapped", () => {
  const f = feature("@top\nFeature: F\n  Scenario: S\n    Given a\n");
  assertEquals(f.synthetic, false);
  assertEquals(f.tags, ["@top"]);
  assertEquals(f.name, "F");
  assertEquals(f.scenarios[0].range.start.line, 3);
});

Deno.test("parseFeature: range ends are exclusive columns", () => {
  const f = feature(
    [
      "Scenario: S",
      "  Given a",
      "  And a doc  ",
      '    """',
      "    x",
      '    """',
      "  And a table",
      "    | a | b |",
      "    | 1 | 2 |",
      "",
    ].join("\n"),
  );
  const [plain, doc, table] = f.scenarios[0].steps;
  // "  Given a": text ends at column 9, so the exclusive end is 10.
  assertEquals(plain.range, {
    start: { line: 2, column: 3 },
    end: { line: 2, column: 10 },
  });
  // The doc string range ends after the closing delimiter.
  assertEquals(doc.range.end, { line: 6, column: 8 });
  // The table range ends after the closing pipe of the last row.
  assertEquals(table.range.end, { line: 9, column: 14 });
  // A section range covers the keyword and its colon.
  assertEquals(f.sections[0].range, {
    start: { line: 1, column: 1 },
    end: { line: 1, column: 10 },
  });
});

Deno.test("parseFeature: Examples under a plain Scenario keyword make an outline", () => {
  const f = feature(
    "Scenario: S\n  Given <x>\n\n  Examples:\n    | x |\n    | 1 |\n",
  );
  assertEquals(f.scenarios[0].keyword, "Scenario");
  assertEquals(f.scenarios[0].isOutline, true);
});

Deno.test("parseFeature: each Rule background applies only to its own Rule", () => {
  const f = feature(
    [
      "Feature: F",
      "  Background:",
      "    Given top",
      "",
      "  Rule: A",
      "    Background:",
      "      Given in A",
      "    Scenario: a",
      "      Then x",
      "",
      "  Rule: B",
      "    Background:",
      "      Given in B",
      "    Scenario: b",
      "      Then y",
      "",
    ].join("\n"),
  );
  assertEquals(
    f.scenarios.map((s) => [s.ruleName, s.background.map((b) => b.text)]),
    [["A", ["top", "in A"]], ["B", ["top", "in B"]]],
  );
  assertEquals(f.backgrounds.map((b) => b.text), ["top", "in A", "in B"]);
});

Deno.test("parseFeature: a doc string of one blank line ends at its closing delimiter", () => {
  const f = feature(
    ["Scenario: S", "  Given a text:", '    """', "", '    """', ""].join(
      "\n",
    ),
  );
  const [step] = f.scenarios[0].steps;
  assertEquals(step.docString?.content, "");
  assertEquals(step.range.end, { line: 5, column: 8 });
  assertEquals(f.scenarios[0].range.end, { line: 5, column: 8 });
});

Deno.test("parseFeature: an empty doc string ends at its closing delimiter", () => {
  const f = feature(
    ["Scenario: S", "  Given a text:", "    ```", "    ```", ""].join("\n"),
  );
  assertEquals(f.scenarios[0].steps[0].range.end, { line: 4, column: 8 });
});

Deno.test("parseFeature: keeps comments with block lines", () => {
  const f = feature("Scenario: S\n  # Step 1\n  * do\n  Then ok");
  assertEquals(f.synthetic, true);
  assertEquals(f.comments, [{ line: 2, text: "# Step 1" }]);
});

Deno.test("parseFeature: comment line numbers with an explicit Feature line", () => {
  const f = feature("Feature: F\n# c\nScenario: S\n  Then ok");
  assertEquals(f.synthetic, false);
  assertEquals(f.comments, [{ line: 2, text: "# c" }]);
});

Deno.test("parseFeature: the language comment is kept", () => {
  const f = feature("# language: fr\nScénario: S\n  Alors ok");
  assertEquals(f.comments[0], { line: 1, text: "# language: fr" });
});

Deno.test("parseFeature: comment after a synthetic Feature line after a language line", () => {
  const f = feature("# language: en\nScenario: S\n  # c\n  Then ok");
  assertEquals(f.comments, [
    { line: 1, text: "# language: en" },
    { line: 3, text: "# c" },
  ]);
});

Deno.test("parseFeature: a hash line in a doc string is not a comment", () => {
  const f = feature(
    'Scenario: S\n  Given a\n    """\n    # not a comment\n    """\n  # real\n  Then ok',
  );
  assertEquals(f.comments, [{ line: 6, text: "# real" }]);
});

Deno.test("parseFeature: no comments gives an empty list", () => {
  assertEquals(feature("Scenario: S\n  Then ok").comments, []);
});

Deno.test("parseFeature: the language comment keeps its line with an explicit Feature", () => {
  const f = feature(
    "# language: fr\nFonctionnalité: F\n  Scénario: S\n    Soit a\n",
  );
  assertEquals(f.comments, [{ line: 1, text: "# language: fr" }]);
});

Deno.test("parseFeature: the language comment keeps its line when it is not the first", () => {
  const f = feature("\n# note\n# language: fr\nScénario: S\n  Soit a\n");
  assertEquals(f.comments.map((c) => c.line), [2, 3]);
  assertEquals(f.comments[1].text, "# language: fr");
});

Deno.test("parseFeature: records the last description line of a scenario", () => {
  const f = feature(
    "Scenario: S\n  First line.\n  # note\n  Second line.\n\n  When a\n  Then b\n",
  );
  assertEquals(f.scenarios[0].descriptionEndLine, 4);
  const none = feature("Scenario: S\n  # note\n  When a\n  Then b\n");
  assertEquals("descriptionEndLine" in none.scenarios[0], false);
});
