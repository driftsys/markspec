import { assertEquals } from "@std/assert";
import type { BodyBlock } from "../ast/nodes.ts";
import { loadGherkin } from "../gherkin/load.ts";
import type { Entry } from "../model/mod.ts";
import { parse, parseFile } from "../parser/mod.ts";
import { buildCriteria, scanScenarioNames } from "./scenarios.ts";

Deno.test("scanScenarioNames: two scenarios give two names", () => {
  const src = "Feature: f\n  Scenario: one\n    Given x\n  Scenario: two\n";
  assertEquals(scanScenarioNames(src), [
    { name: "one", line: 1 },
    { name: "two", line: 3 },
  ]);
});

Deno.test("scanScenarioNames: outline, template and example count", () => {
  const src = [
    "Scenario Outline: a",
    "Scenario Template: b",
    "Example: c",
    "Background: d",
    "Rule: e",
  ].join("\n");
  assertEquals(scanScenarioNames(src).map((s) => s.name), ["a", "b", "c"]);
});

Deno.test("scanScenarioNames: doc strings hide scenario lines", () => {
  const src = [
    "Scenario: real",
    "  Given a text:",
    '    """',
    "    Scenario: fake",
    '    """',
    "Scenario: after",
  ].join("\n");
  assertEquals(scanScenarioNames(src).map((s) => s.name), ["real", "after"]);
});

Deno.test("scanScenarioNames: backtick doc strings hide scenario lines", () => {
  const src = "Scenario: a\n  ```\n  Scenario: fake\n  ```\nScenario: b";
  assertEquals(scanScenarioNames(src).map((s) => s.name), ["a", "b"]);
});

Deno.test("scanScenarioNames: indentation and tag lines are tolerated", () => {
  const src = "  @smoke @fast\n    Scenario:   spaced name  \n";
  assertEquals(scanScenarioNames(src), [{ name: "spaced name", line: 1 }]);
});

Deno.test("scanScenarioNames: empty name", () => {
  assertEquals(scanScenarioNames("Scenario:"), [{ name: "", line: 0 }]);
});

function entryOf(md: string) {
  return parse(md, { file: "doc.md" })[0];
}

Deno.test("buildCriteria: names are normalized and locations are file lines", () => {
  const md = [
    "# Doc", // 1
    "", // 2
    "- [REQ_A_0001] Brake", // 3
    "", // 4
    "  The system shall brake.", // 5
    "", // 6
    "  ```gherkin", // 7
    "  Feature: braking", // 8
    "    Scenario: Brake at 20 m", // 9
    "      Given a target", // 10
    "    Scenario: Brake at 30 m", // 11
    "  ```", // 12
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "",
  ].join("\n");
  const criteria = buildCriteria(entryOf(md));
  assertEquals(criteria, [
    {
      form: "scenario",
      name: "Brake at 20 m",
      addressable: true,
      location: { file: "doc.md", line: 9, column: 1 },
    },
    {
      form: "scenario",
      name: "Brake at 30 m",
      addressable: true,
      location: { file: "doc.md", line: 11, column: 1 },
    },
  ]);
});

Deno.test("buildCriteria: names equal after whitespace normalization are not addressable", () => {
  const md = [
    "- [REQ_A_0001] Brake",
    "",
    "  ```gherkin",
    "  Scenario: Brake  at 20 m",
    "  Scenario: Brake at 20 m",
    "  Scenario: Other",
    "  ```",
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "",
  ].join("\n");
  const criteria = buildCriteria(entryOf(md));
  assertEquals(criteria.map((c) => [c.name, c.addressable]), [
    ["Brake at 20 m", false],
    ["Brake at 20 m", false],
    ["Other", true],
  ]);
});

Deno.test("buildCriteria: NFC and decomposed names are the same name", () => {
  const md = [
    "- [REQ_A_0001] T",
    "",
    "  ```gherkin",
    "  Scenario: café",
    "  Scenario: café",
    "  ```",
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "",
  ].join("\n");
  const criteria = buildCriteria(entryOf(md));
  assertEquals(criteria.map((c) => c.addressable), [false, false]);
});

Deno.test("buildCriteria: empty name is not addressable", () => {
  const md = [
    "- [REQ_A_0001] T",
    "",
    "  ```gherkin",
    "  Scenario:",
    "  ```",
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "",
  ].join("\n");
  const criteria = buildCriteria(entryOf(md));
  assertEquals(criteria.map((c) => [c.name, c.addressable]), [["", false]]);
});

Deno.test("buildCriteria: two blocks in one entry form one scope", () => {
  const md = [
    "- [REQ_A_0001] T",
    "",
    "  ```gherkin",
    "  Scenario: same",
    "  ```",
    "",
    "  ```feature",
    "  Scenario: same",
    "  ```",
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "",
  ].join("\n");
  const criteria = buildCriteria(entryOf(md));
  assertEquals(criteria.map((c) => c.addressable), [false, false]);
  assertEquals(criteria.map((c) => c.location.line), [4, 8]);
});

Deno.test("buildCriteria: a non-feature fence yields nothing", () => {
  const md = [
    "- [REQ_A_0001] T",
    "",
    "  ```text",
    "  Scenario: not a scenario",
    "  ```",
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "",
  ].join("\n");
  assertEquals(buildCriteria(entryOf(md)), []);
});

Deno.test("buildCriteria: doc-comment entries use file-relative lines", async () => {
  const src = [
    "// header", // 1
    "", // 2
    "/// [REQ_A_0001] Brake", // 3
    "///", // 4
    "/// The system shall brake.", // 5
    "///", // 6
    "/// ```gherkin", // 7
    "/// Scenario: Stop", // 8
    "/// ```", // 9
    "///", // 10
    "///     Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV", // 11
    "fn f() {}",
    "",
  ].join("\n");
  const { entries } = await parseFile(src, { file: "lib.rs" });
  const criteria = buildCriteria(entries[0]);
  assertEquals(criteria.map((c) => [c.name, c.location.line]), [["Stop", 8]]);
});

Deno.test("scanScenarioNames: a doc string closes only on its own delimiter", () => {
  const src = [
    "Scenario: a",
    '  """',
    "  ```",
    "  Scenario: fake",
    '  """',
    "Scenario: b",
  ].join("\n");
  assertEquals(scanScenarioNames(src).map((s) => s.name), ["a", "b"]);
});

Deno.test("scanScenarioNames: CRLF line endings are handled", () => {
  const src = "Scenario: one\r\n  Given x\r\nScenario: two\r\n";
  assertEquals(scanScenarioNames(src), [
    { name: "one", line: 0 },
    { name: "two", line: 2 },
  ]);
});

Deno.test("scanScenarioNames: Scenarios: and Examples: are not scenarios", () => {
  const src = "Scenarios: x\nExamples:\n  | a |\nScenario: y";
  assertEquals(scanScenarioNames(src).map((s) => s.name), ["y"]);
});

Deno.test("buildCriteria: a tilde fence with a gherkin tag is indexed", () => {
  const md = [
    "- [REQ_A_0001] T",
    "",
    "  ~~~gherkin",
    "  Scenario: tilde",
    "  ~~~",
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "",
  ].join("\n");
  const criteria = buildCriteria(entryOf(md));
  assertEquals(criteria.map((c) => [c.name, c.location.line]), [["tilde", 4]]);
});

Deno.test("buildCriteria: a fence inside a nested list item is not indexed", () => {
  const md = [
    "- [REQ_A_0001] T",
    "",
    "  - item",
    "",
    "    ```gherkin",
    "    Scenario: nested",
    "    ```",
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "",
  ].join("\n");
  assertEquals(buildCriteria(entryOf(md)), []);
});

Deno.test("buildCriteria: a /** */ doc comment with * prefixes uses file lines", async () => {
  const src = [
    "// header", // 1
    "", // 2
    "/**", // 3
    " * [REQ_A_0001] Brake", // 4
    " *", // 5
    " * The system shall brake.", // 6
    " *", // 7
    " * ```gherkin", // 8
    " * Scenario: Stop", // 9
    " * ```", // 10
    " *", // 11
    " *     Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV", // 12
    " */", // 13
    "fn f() {}",
    "",
  ].join("\n");
  const { entries } = await parseFile(src, { file: "lib.rs" });
  const criteria = buildCriteria(entries[0]);
  assertEquals(criteria.map((c) => [c.name, c.location.line]), [["Stop", 9]]);
});

// ---------------------------------------------------------------------------
// AST path versus scanner path (epic #915, Gherkin AST slice)
// ---------------------------------------------------------------------------

/** The entry with every feature node rewritten by `rewrite`. */
function withFeatureNodes(
  entry: Entry,
  rewrite: (block: BodyBlock) => BodyBlock,
): Entry {
  return {
    ...entry,
    bodyAst: (entry.bodyAst ?? []).map((b) =>
      b.kind === "feature" ? rewrite(b) : b
    ),
  };
}

/** The entry as it is when the parser was not loaded at parse time. */
function withoutAst(entry: Entry): Entry {
  return withFeatureNodes(entry, (b) => {
    const { feature: _f, parseError: _e, ...rest } = b as BodyBlock & {
      feature?: unknown;
      parseError?: unknown;
    };
    return rest as BodyBlock;
  });
}

/** The entry as it is when every block failed to parse. */
function withParseError(entry: Entry): Entry {
  return withFeatureNodes(entry, (b) => {
    const { feature: _f, ...rest } = b as BodyBlock & { feature?: unknown };
    return {
      ...rest,
      parseError: { line: 1, column: 1, message: "forced" },
    } as BodyBlock;
  });
}

function fixture(lines: string[]): string {
  return [
    "- [REQ_A_0001] T",
    "",
    ...lines.map((l) => `  ${l}`),
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "",
  ].join("\n");
}

const ENGLISH_FIXTURES: Record<string, string> = {
  "two scenarios": fixture([
    "```gherkin",
    "Feature: braking",
    "  Scenario: Brake at 20 m",
    "    Given a target",
    "  Scenario: Brake at 30 m",
    "```",
  ]),
  "no feature line": fixture([
    "```gherkin",
    "@tag",
    "Scenario: Stop",
    "  Given x",
    "```",
  ]),
  "comments before first scenario": fixture([
    "```gherkin",
    "# a comment",
    "@smoke",
    "Scenario: Stop",
    "```",
  ]),
  "duplicate names after normalization": fixture([
    "```gherkin",
    "Scenario: Brake  at 20 m",
    "Scenario: Brake at 20 m",
    "Scenario: Other",
    "```",
  ]),
  "empty name": fixture(["```gherkin", "Scenario:", "```"]),
  "outline, template and example": fixture([
    "```gherkin",
    "Feature: f",
    "  Scenario Outline: a",
    "    Given <x>",
    "    Examples:",
    "      | x |",
    "      | 1 |",
    "  Scenario Template: b",
    "    Given <x>",
    "    Examples:",
    "      | x |",
    "      | 1 |",
    "  Example: c",
    "```",
  ]),
  "background and rule": fixture([
    "```gherkin",
    "Feature: f",
    "  Background:",
    "    Given b",
    "  Rule: r",
    "    Scenario: inside rule",
    "      Given x",
    "```",
  ]),
  "doc string hides a scenario line": fixture([
    "```gherkin",
    "Scenario: real",
    "  Given a text:",
    '    """',
    "    Scenario: fake",
    '    """',
    "Scenario: after",
    "```",
  ]),
  "two blocks one scope": fixture([
    "```gherkin",
    "Scenario: same",
    "```",
    "",
    "```feature",
    "Scenario: same",
    "```",
  ]),
  "tilde fence": fixture(["~~~gherkin", "Scenario: tilde", "~~~"]),
  "non-feature fence": fixture(["```text", "Scenario: not one", "```"]),
  "nested fence": [
    "- [REQ_A_0001] T",
    "",
    "  - item",
    "",
    "    ```gherkin",
    "    Scenario: nested",
    "    ```",
    "",
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "",
  ].join("\n"),
  "Scenarios: and Examples: lines": fixture([
    "```gherkin",
    "Feature: f",
    "  Scenario Outline: y",
    "    Given <a>",
    "    Examples:",
    "      | a |",
    "      | 1 |",
    "```",
  ]),
};

for (const [label, md] of Object.entries(ENGLISH_FIXTURES)) {
  Deno.test(`buildCriteria: AST, scanner and not-loaded paths agree: ${label}`, async () => {
    await loadGherkin();
    const entry = entryOf(md);
    const features = (entry.bodyAst ?? []).filter((b) => b.kind === "feature");
    for (const f of features) {
      // Guard against a vacuous test: the AST path must really run.
      assertEquals(
        "feature" in f && f.feature !== undefined,
        true,
        "fixture block must carry the AST",
      );
    }
    const viaAst = buildCriteria(entry);
    assertEquals(buildCriteria(withParseError(entry)), viaAst);
    assertEquals(buildCriteria(withoutAst(entry)), viaAst);
  });
}

Deno.test("buildCriteria: a French block gives its scenarios from the AST", async () => {
  await loadGherkin();
  const md = fixture([
    "```gherkin",
    "# language: fr",
    "Fonctionnalité: freinage",
    "  Scénario: Arrêt",
    "    Soit une cible",
    "```",
  ]);
  const criteria = buildCriteria(entryOf(md));
  assertEquals(criteria.map((c) => [c.name, c.addressable, c.location.line]), [
    ["Arrêt", true, 6],
  ]);
  // Not loaded: the English scanner finds nothing (the parse gate makes this
  // case unreachable for entries from parseFile).
  assertEquals(buildCriteria(withoutAst(entryOf(md))), []);
});

Deno.test("buildCriteria: Scenario text in a doc string or comment is no criterion", async () => {
  await loadGherkin();
  const md = fixture([
    "```gherkin",
    "Feature: f",
    "  The feature text mentions scenarios in prose.",
    "  # Scenario: commented out",
    "",
    "  Scenario: real",
    "    Given a text:",
    '      """',
    "      Scenario: fake",
    '      """',
    "```",
  ]);
  const entry = entryOf(md);
  assertEquals(buildCriteria(entry).map((c) => c.name), ["real"]);
  // The names come from the AST: with the block text emptied, the line
  // scanner would find nothing, but the AST still gives the scenario.
  const astOnly = withFeatureNodes(
    entry,
    (b) => ({ ...b, source: "" }) as BodyBlock,
  );
  assertEquals(buildCriteria(astOnly).map((c) => c.name), ["real"]);
});

Deno.test("buildCriteria: a block that does not parse keeps scanner criteria", async () => {
  await loadGherkin();
  const md = fixture([
    "```gherkin",
    "Feature: f",
    "  Scenario: kept",
    "  Given before any step keyword is misplaced",
    "  Bogus line here",
    "```",
  ]);
  const entry = entryOf(md);
  const node = (entry.bodyAst ?? []).find((b) => b.kind === "feature");
  assertEquals(
    node !== undefined && "parseError" in node && node.parseError !== undefined,
    true,
    "fixture must fail to parse",
  );
  assertEquals(buildCriteria(entry).map((c) => [c.name, c.location.line]), [
    ["kept", 5],
  ]);
});

Deno.test("buildCriteria: one block per state in one entry uses its own source", async () => {
  await loadGherkin();
  const md = fixture([
    "```gherkin",
    "Scenario: good",
    "```",
    "",
    "```gherkin",
    "Scenario: broken",
    "  Bogus line here",
    "```",
  ]);
  assertEquals(buildCriteria(entryOf(md)).map((c) => c.name), [
    "good",
    "broken",
  ]);
});

Deno.test("buildCriteria: outline and rule scenarios give one criterion each", async () => {
  await loadGherkin();
  const md = fixture([
    "```gherkin",
    "Feature: f",
    "  Rule: the rule",
    "    Scenario Outline: out",
    "      Given <x>",
    "      Examples:",
    "        | x |",
    "        | 1 |",
    "        | 2 |",
    "    Scenario: plain",
    "      Given y",
    "```",
  ]);
  assertEquals(buildCriteria(entryOf(md)).map((c) => c.name), [
    "out",
    "plain",
  ]);
});
