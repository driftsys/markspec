import { assertEquals } from "@std/assert";
import { parseFile } from "../parser/mod.ts";
import { formatFeatureFile, formatFeatureText } from "./feature_file.ts";

const ID_A = "01HGW2Q8MNP3RSTVWXYZABCDEA";
const ID_B = "01HGW2Q8MNP3RSTVWXYZABCDEB";
const ID_C = "01HGW2Q8MNP3RSTVWXYZABCDEC";

function sequence(...ids: string[]): () => string {
  let next = 0;
  return () => ids[next++];
}

async function stamp(text: string, ...ids: string[]) {
  const { entries } = await parseFile(text, { file: "a.feature" });
  return formatFeatureFile(text, entries, sequence(...ids));
}

Deno.test("formatFeatureFile: inserts '# Id: <ULID>' as first trailer line", async () => {
  const text = `# [REQ_A_0001] Title
#
# Body prose.
#
# Satisfies: STK_A_0001
Feature: F
  Scenario: S
    Given a
`;
  const result = await stamp(text, ID_A);
  assertEquals(
    result.output,
    text.replace("# Satisfies:", `# Id: ${ID_A}\n# Satisfies:`),
  );
  assertEquals(result.changed, true);
});

Deno.test("formatFeatureFile: indented header keeps its indentation", async () => {
  const text = `Feature: F

  # [TST_A_0001] Title
  #
  # Body prose.
  #
  # Verifies: REQ_A_0001
  Scenario: S
    Given a
`;
  const result = await stamp(text, ID_A);
  assertEquals(
    result.output,
    text.replace("  # Verifies:", `  # Id: ${ID_A}\n  # Verifies:`),
  );
});

Deno.test("formatFeatureFile: indented trailer keeps the trailer's spacing", async () => {
  const text = `# [REQ_A_0001] Title
#
# Body prose.
#
#       Satisfies: STK_A_0001
Feature: F
  Scenario: S
    Given a
`;
  const result = await stamp(text, ID_A);
  assertEquals(
    result.output,
    text.replace(
      "#       Satisfies:",
      `#       Id: ${ID_A}\n#       Satisfies:`,
    ),
  );
});

Deno.test("formatFeatureFile: no trailer appends '#' and the Id at the header end", async () => {
  const text = `Feature: F

  # [TST_A_0001] Title
  #
  # Body prose.
  Scenario: S
    Given a
`;
  const result = await stamp(text, ID_A);
  assertEquals(
    result.output,
    text.replace(
      "  # Body prose.\n",
      `  # Body prose.\n  #\n  # Id: ${ID_A}\n`,
    ),
  );
});

Deno.test("formatFeatureFile: title-only header gets '#' and the Id", async () => {
  const text = `# [REQ_A_0001] Title
Feature: F
  Scenario: S
    Given a
`;
  const result = await stamp(text, ID_A);
  assertEquals(
    result.output,
    `# [REQ_A_0001] Title\n#\n# Id: ${ID_A}\nFeature: F\n  Scenario: S\n    Given a\n`,
  );
});

Deno.test("formatFeatureFile: multi-line header body keeps its lines", async () => {
  const text = `# [REQ_A_0001] Title
#
# First line of the body
# second line of the body.
#
# Labels: ASIL-B
Feature: F
  Scenario: S
    Given a
`;
  const result = await stamp(text, ID_A);
  assertEquals(
    result.output,
    text.replace("# Labels:", `# Id: ${ID_A}\n# Labels:`),
  );
});

Deno.test("formatFeatureFile: two entries each get their own Id", async () => {
  const text = `# [REQ_A_0001] One
#
# Body one.
Feature: F

  # [TST_A_0001] Two
  #
  # Body two.
  Scenario: S
    Given a
`;
  const result = await stamp(text, ID_A, ID_B);
  const lines = result.output.split("\n");
  // Ids are generated bottom to top, but each lands in its own header.
  assertEquals(lines.filter((l) => l.includes("Id: ")).length, 2);
  assertEquals(result.output.includes(`# Id: ${ID_A}\nFeature`), false);
  assertEquals(result.output.includes(`  # Id: `), true);
  assertEquals(
    result.output.replace(/ Id: [0-9A-Z]{26}/g, " Id: X"),
    `# [REQ_A_0001] One
#
# Body one.
#
# Id: X
Feature: F

  # [TST_A_0001] Two
  #
  # Body two.
  #
  # Id: X
  Scenario: S
    Given a
`,
  );
});

Deno.test("formatFeatureFile: nested headed Rule and Scenario", async () => {
  const text = `# [REQ_A_0001] Feature entry
#
# Body.
Feature: F

  # [REQ_A_0002] Rule entry
  #
  # Body.
  Rule: R

    # [TST_A_0003] Scenario entry
    #
    # Body.
    # Id: ${ID_C}
    Scenario: S
      Given a
`;
  const result = await stamp(text, ID_A, ID_B);
  // Only the two entries without an Id change; the third is untouched.
  assertEquals(
    result.output.split("\n").filter((l) => /Id: /.test(l)).length,
    3,
  );
  assertEquals(result.output.includes(`# Id: ${ID_C}`), true);
  assertEquals(result.changed, true);
});

Deno.test("formatFeatureFile: entry with an Id leaves the file byte-identical", async () => {
  const text = `# [REQ_A_0001] Title
#
# Body.
#
# Id: ${ID_A}
Feature: F
  Scenario: S
    Given a
`;
  const result = await stamp(text, ID_B);
  assertEquals(result.output, text);
  assertEquals(result.changed, false);
});

Deno.test("formatFeatureFile: file with no headers is byte-identical", async () => {
  const text =
    `Feature: F\n\n  # a plain comment\n  Scenario: S\n    Given a\n`;
  const result = await stamp(text, ID_A);
  assertEquals(result.output, text);
  assertEquals(result.changed, false);
});

Deno.test("formatFeatureFile: CRLF is preserved", async () => {
  const text = [
    "# [REQ_A_0001] Title",
    "#",
    "# Body.",
    "#",
    "# Satisfies: STK_A_0001",
    "Feature: F",
    "  Scenario: S",
    "    Given a",
    "",
  ].join("\r\n");
  const result = await stamp(text, ID_A);
  assertEquals(
    result.output,
    text.replace("# Satisfies:", `# Id: ${ID_A}\r\n# Satisfies:`),
  );
});

Deno.test("formatFeatureFile: steps, tables and other lines are untouched", async () => {
  const text = `# [REQ_A_0001] Title
#
# Body.
@tag
Feature: F
  Background:
    Given   a   spaced   step
  Scenario Outline: S
    When <x>
    Examples:
      | x   |
      | 1   |
`;
  const result = await stamp(text, ID_A);
  const before = text.split("\n");
  const after = result.output.split("\n");
  assertEquals(after.length, before.length + 2);
  assertEquals(after.filter((l) => !before.includes(l)), [`# Id: ${ID_A}`]);
});

Deno.test("formatFeatureText: a file that does not parse is unchanged", async () => {
  const text =
    `# [REQ_A_0001] Title\n#\n# Body.\nFeature: F\n  Scenario: S\n    Given a\nFeature: Again\n`;
  const result = await formatFeatureText(text, "broken.feature");
  assertEquals(result.output, text);
  assertEquals(result.changed, false);
});

Deno.test("formatFeatureText: parses, stamps, and is idempotent", async () => {
  const text =
    `# [REQ_A_0001] Title\n#\n# Body.\nFeature: F\n  Scenario: S\n    Given a\n`;
  const first = await formatFeatureText(text, "a.feature");
  assertEquals(first.changed, true);
  const second = await formatFeatureText(first.output, "a.feature");
  assertEquals(second.changed, false);
  assertEquals(second.output, first.output);
});
