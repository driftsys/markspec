import { assert, assertEquals } from "@std/assert";
import type { FeatureNode } from "../ast/nodes.ts";
import type { Entry } from "../model/mod.ts";
import { buildCriteria } from "../criteria/scenarios.ts";
import { parseFile } from "../parser/mod.ts";
import { featureFileLine } from "./position.ts";

const featuresOf = (entry: Entry): FeatureNode[] =>
  (entry.bodyAst ?? []).filter((b) => b.kind === "feature") as FeatureNode[];

/** File line of every scenario, through `featureFileLine`. */
const scenarioLines = (entry: Entry): number[] =>
  featuresOf(entry).flatMap((node) =>
    (node.feature?.scenarios ?? []).map((s) =>
      featureFileLine(entry, node, s.range.start.line)
    )
  );

/** Assert the helper agrees with `buildCriteria` and with the file text. */
async function check(
  text: string,
  file: string,
  entryIndex: number,
  expectedNames: string[],
): Promise<void> {
  const { entries } = await parseFile(text, { file });
  const entry = entries[entryIndex];
  const lines = scenarioLines(entry);
  assertEquals(lines, buildCriteria(entry).map((c) => c.location.line));
  const fileLines = text.split("\n");
  assertEquals(lines.length, expectedNames.length);
  lines.forEach((line, i) => {
    assert(
      fileLines[line - 1].includes(`Scenario: ${expectedNames[i]}`),
      `line ${line} is "${fileLines[line - 1]}"`,
    );
  });
}

Deno.test("featureFileLine: Markdown fence indented in a list item", async () => {
  const md = `# Doc

- [REQ-001] Brake

  The system shall brake.

  \`\`\`gherkin
  Feature: f
    Scenario: Stop
      Given a car
    Scenario: Go
  \`\`\`

      Id:
`;
  await check(md, "a.md", 0, ["Stop", "Go"]);
});

Deno.test("featureFileLine: fence after a long paragraph", async () => {
  const para = Array.from({ length: 12 }, (_, i) => `  line ${i} of text`)
    .join("\n");
  const md = `- [REQ-001] Brake

${para}

  \`\`\`gherkin
  Scenario: Stop
    Given a car
  \`\`\`

      Id:
`;
  await check(md, "a.md", 0, ["Stop"]);
});

Deno.test("featureFileLine: second entry in a file", async () => {
  const entry = (n: number, name: string) =>
    `- [REQ-00${n}] Title ${n}

  Body ${n}.

  \`\`\`gherkin
  Scenario: ${name}
    Given x
  \`\`\`

      Id:

`;
  const md = `# Doc\n\n${entry(1, "One")}${entry(2, "Two")}`;
  await check(md, "a.md", 1, ["Two"]);
});

Deno.test("featureFileLine: Rust /// doc comment", async () => {
  const rs = `fn other() {}

/// [SRS_001] Brake
///
/// The unit shall brake.
///
/// \`\`\`gherkin
/// Scenario: Stop
///   Given a car
/// Scenario: Go
/// \`\`\`
///
///     Id:
fn brake() {}
`;
  await check(rs, "a.rs", 0, ["Stop", "Go"]);
});

Deno.test("featureFileLine: Rust //! doc comment", async () => {
  const rs = `//! [SRS_001] Brake
//!
//! The unit shall brake.
//!
//! \`\`\`gherkin
//! Scenario: Stop
//!   Given a car
//! \`\`\`
//!
//!     Id:
`;
  await check(rs, "a.rs", 0, ["Stop"]);
});

Deno.test("featureFileLine: block doc comment with * prefixes", async () => {
  const rs = `/**
 * [SRS_001] Brake
 *
 * The unit shall brake.
 *
 * \`\`\`gherkin
 * Scenario: Stop
 *   Given a car
 * Scenario: Go
 * \`\`\`
 *
 *     Id:
 */
fn brake() {}
`;
  await check(rs, "a.rs", 0, ["Stop", "Go"]);
});

Deno.test("featureFileLine: non-contiguous comment lines", async () => {
  const rs = `/// Unrelated first comment.
// plain comment between doc comments
/// [SRS_001] Brake
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

/// [SRS_002] Go
///
/// The unit shall go.
///
/// \`\`\`gherkin
/// Scenario: Run
/// \`\`\`
///
///     Id:
fn go() {}
`;
  await check(rs, "a.rs", 0, ["Stop"]);
  await check(rs, "a.rs", 1, ["Run"]);
});

Deno.test("featureFileLine: a plain comment line ends the entry body (Rust)", async () => {
  const rs = `/// [SRS_001] Brake
///
/// The unit shall brake.
// plain comment inside the body
/// More text.
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
  // A plain `//` line ends the doc comment, so the entry stops before it:
  // no feature block exists and no position can drift.
  assertEquals(entries.length, 1);
  assertEquals(featuresOf(entries[0]).length, 0);
});

Deno.test("featureFileLine: blank line inside a block doc comment body", async () => {
  const rs = `fn first() {}

/**
 * [SRS_001] Brake
 *

 * The unit shall brake.
 *
 * \`\`\`gherkin
 * Scenario: Stop
 *   Given a car
 * \`\`\`
 *
 *     Id:
 */
fn brake() {}
`;
  await check(rs, "a.rs", 0, ["Stop"]);
});

Deno.test("featureFileLine: entry body that starts with the fence (blank line after the title)", async () => {
  const md = `# Doc

- [REQ-001] Brake

  \`\`\`gherkin
  Scenario: Stop
    Given a car
  \`\`\`

      Id:
`;
  await check(md, "a.md", 0, ["Stop"]);
});
