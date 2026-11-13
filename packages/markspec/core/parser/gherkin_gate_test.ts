/**
 * @module parser/gherkin_gate_test
 *
 * Tests for the Gherkin parse gate in {@linkcode parseFile}. Tests run in
 * file order, and the parser cache is process-wide, so the test that needs
 * an unloaded parser comes first.
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import type { FeatureNode } from "../ast/nodes.ts";
import { loadedGherkin } from "../gherkin/load.ts";
import { parseFile } from "./mod.ts";

const featureOf = (
  entry: { readonly bodyAst?: readonly unknown[] },
): FeatureNode => {
  const node = entry.bodyAst?.find((b) =>
    (b as FeatureNode).kind === "feature"
  );
  assert(node, "entry has a feature node");
  return node as FeatureNode;
};

const entryWith = (fenceBody: string, lang = "gherkin"): string =>
  `# Doc

- [REQ-001] Brake

  The system shall brake.

  \`\`\`${lang}
${fenceBody}
  \`\`\`

      Id:
`;

Deno.test("parseFile: plain Markdown does not load the parser", async () => {
  const md = "# Doc\n\n- [REQ-001] Brake\n\n  The system shall brake.\n\n" +
    "  ```ts\n  const x = 1;\n  ```\n\n      Id:\n";
  const { entries } = await parseFile(md, { file: "a.md" });
  assertEquals(entries.length, 1);
  assertEquals(loadedGherkin(), undefined);
});

Deno.test("parseFile: fills FeatureNode.feature for a gherkin fence", async () => {
  const md = entryWith(
    "  Feature: Braking\n    Scenario: Stop\n      Given a car\n      Then it stops",
  );
  const { entries } = await parseFile(md, { file: "a.md" });
  const node = featureOf(entries[0]);
  assertEquals(node.parseError, undefined);
  assertEquals(node.feature?.scenarios.length, 1);
});

Deno.test("parseFile: also gates on a feature fence", async () => {
  const md = entryWith("  Scenario: Stop\n    Given a car", "feature");
  const { entries } = await parseFile(md, { file: "a.md" });
  assertEquals(featureOf(entries[0]).feature?.scenarios.length, 1);
});

Deno.test("parseFile: sets parseError for a broken block", async () => {
  const md = entryWith("  Scenario: Stop\n    Given a car\n  Bogus line");
  const { entries } = await parseFile(md, { file: "a.md" });
  const node = featureOf(entries[0]);
  assertEquals(node.feature, undefined);
  assertEquals(node.parseError?.line, 3);
});

Deno.test("parseFile: synthetic Feature line does not shift lines after tags", async () => {
  const md = entryWith("  @smoke\n  # note\n  Scenario: Stop\n    Given a car");
  const { entries } = await parseFile(md, { file: "a.md" });
  const scenario = featureOf(entries[0]).feature?.scenarios[0];
  assertEquals(scenario?.range.start.line, 3);
});

Deno.test("parseFile: a Rust doc comment fence fills the feature", async () => {
  const rs = `/// [SRS_001] Brake
///
/// The unit shall brake.
///
/// \`\`\`gherkin
/// Scenario: Stop
///   Given a car
/// \`\`\`
///
///     Id:
fn brake() {}
`;
  const { entries } = await parseFile(rs, { file: "a.rs" });
  assertEquals(featureOf(entries[0]).feature?.scenarios.length, 1);
});

Deno.test("parseFile: loader state stays set after a load", () => {
  assert(loadedGherkin() !== undefined);
  assertFalse(loadedGherkin() === undefined);
});
