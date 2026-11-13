import { assert, assertEquals } from "@std/assert";
import { loadGherkin } from "./load.ts";
import { parseFeature } from "./parse.ts";
import { projectFeature } from "./project.ts";

const api = await loadGherkin();

const TEXT = [
  "Feature: F", // 1
  "  Background:", // 2
  "    Given a", // 3
  "  Scenario: One", // 4
  "    When b", // 5
  "    Then c", // 6
  "  # Step 1", // 7
  "  @tag", // 8
  "  Scenario: Two", // 9
  "    When d", // 10
  "    Then e", // 11
].join("\n");

Deno.test("projectFeature: rebases ranges and filters scenarios", () => {
  const parsed = parseFeature(api, TEXT);
  assert(parsed.ok);
  const projected = projectFeature(parsed.feature, [1], {
    startLine: 8,
    endLine: 11,
  });
  assertEquals(projected.scenarios.map((s) => s.name), ["Two"]);
  const scenario = projected.scenarios[0];
  assertEquals(scenario.range.start.line, 2);
  assertEquals(scenario.steps.map((s) => s.range.start.line), [3, 4]);
  // Inherited background steps keep rebased lines below 1.
  assertEquals(scenario.background[0].range.start.line, -4);
  assertEquals(projected.backgrounds.map((s) => s.text), ["a"]);
  assertEquals(projected.sections.map((s) => s.keyword), ["Scenario"]);
  assertEquals(projected.sections[0].range.start.line, 2);
  assertEquals(projected.comments, []);
});

Deno.test("projectFeature: keeps comments inside the span", () => {
  const parsed = parseFeature(api, TEXT);
  assert(parsed.ok);
  const projected = projectFeature(parsed.feature, [0], {
    startLine: 4,
    endLine: 7,
  });
  assertEquals(projected.comments, [{ line: 4, text: "# Step 1" }]);
});
