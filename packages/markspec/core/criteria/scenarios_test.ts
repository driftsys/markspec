import { assertEquals } from "@std/assert";
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
