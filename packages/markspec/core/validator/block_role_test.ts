/**
 * @module core/validator/block_role_test
 *
 * Unit tests for MSL-B064: a criteria scenario with no outcome step
 * (epic #915).
 */

import { assertEquals } from "@std/assert";
import { loadGherkin } from "../gherkin/load.ts";
import { parseFile } from "../parser/mod.ts";
import type { EffectiveProfile, Entry } from "../model/mod.ts";
import { checkFeatureParse } from "./feature_parse.ts";
import { checkBlockRoles } from "./block_role.ts";

await loadGherkin();

const entry = (
  block: string,
  type: string | undefined,
  prefix = "REQ_X",
  nested = false,
): string => {
  const indent = nested ? "    " : "  ";
  const lines = block.split("\n").map((l) => indent + l).join("\n");
  const fenced = `${indent}\`\`\`feature\n${lines}\n${indent}\`\`\``;
  const body = nested ? `  - item\n\n${fenced}\n\n  ` : `${fenced}\n\n`;
  return `# Doc

- [${prefix}_0001] Title

  Text.

${body}    Id: 01TST00000000000000000010A
${type === undefined ? "" : `      Type: ${type}\n`}`;
};

const profile = {
  types: new Map([
    ["req", {
      value: {
        name: "req",
        extends: "Requirement",
        displayIdPattern: { value: "REQ_X_{n:04d}", origin: "p" },
        displayIdPatternEnforcement: { value: "off", origin: "p" },
      },
      origin: "p",
    }],
  ]),
} as unknown as EffectiveProfile;

/** Entries as the pipeline gives them: `type` taken from the trailer. */
async function load(text: string): Promise<Entry[]> {
  const { entries } = await parseFile(text, { file: "/t.md" });
  return entries.map((e) => ({
    ...e,
    type: e.typedAttributes.get("Type")?.[0],
  }));
}

const NO_THEN = "Scenario: S\n  Given a\n  When b";

Deno.test("MSL-B064: scenario with no Then in a Requirement", async () => {
  const text = entry(NO_THEN, "Requirement");
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.length, 1);
  assertEquals(diags[0].code, "MSL-B064");
  assertEquals(diags[0].severity, "warning");
  assertEquals(diags[0].location!.column, 1);
  assertEquals(
    text.split("\n")[diags[0].location!.line - 1].trim(),
    "Scenario: S",
  );
  assertEquals(
    diags[0].message,
    'REQ_X_0001: scenario "S" has no outcome (no Then step); ' +
      "a criterion must state what has to hold; add a Then step",
  );
});

Deno.test("MSL-B064: scenario with no steps is reported", async () => {
  const diags = checkBlockRoles(
    await load(entry("Scenario: Empty", "Requirement")),
    null,
  );
  assertEquals(diags.length, 1);
});

Deno.test("MSL-B064: Given and Then without action is valid", async () => {
  const text = entry("Scenario: S\n  Given a\n  Then b", "Requirement");
  assertEquals(checkBlockRoles(await load(text), null), []);
});

Deno.test("MSL-B064: And after Then is part of the outcome", async () => {
  const text = entry("Scenario: S\n  When a\n  Then b\n  And c", "Requirement");
  assertEquals(checkBlockRoles(await load(text), null), []);
});

Deno.test("MSL-B064: only the scenario without outcome is reported", async () => {
  const text = entry(
    "Scenario: A\n  When a\n  Then b\n\nScenario: B\n  When c",
    "Requirement",
  );
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.length, 1);
  assertEquals(diags[0].message.includes('scenario "B"'), true);
});

Deno.test("MSL-B064: French block without Alors", async () => {
  const text = entry(
    "# language: fr\nScénario: S\n  Soit a\n  Quand b",
    "Requirement",
  );
  assertEquals(checkBlockRoles(await load(text), null).length, 1);
});

Deno.test("MSL-B064: French block with Alors is valid", async () => {
  const text = entry(
    "# language: fr\nScénario: S\n  Soit a\n  Quand b\n  Alors c",
    "Requirement",
  );
  assertEquals(checkBlockRoles(await load(text), null), []);
});

Deno.test("MSL-B064: block nested in a list item", async () => {
  const text = entry(NO_THEN, "Requirement", "REQ_X", true);
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.length, 1);
  assertEquals(diags[0].code, "MSL-B064");
});

Deno.test("MSL-B064: Contract entry is checked", async () => {
  const text = entry(NO_THEN, "Contract");
  assertEquals(checkBlockRoles(await load(text), null).length, 1);
});

Deno.test("MSL-B064: entry classified only by display-ID prefix", async () => {
  const text = entry(NO_THEN, undefined);
  const { entries } = await parseFile(text, { file: "/t.md" });
  assertEquals(entries.every((e) => e.type === undefined), true);
  assertEquals(checkBlockRoles(entries, profile).length, 1);
  assertEquals(checkBlockRoles(entries, null), []);
});

Deno.test("MSL-B064: not reported for Test or Component entries", async () => {
  for (const type of ["Test", "Component"]) {
    assertEquals(
      checkBlockRoles(await load(entry(NO_THEN, type)), null).filter((d) =>
        d.code === "MSL-B064"
      ),
      [],
      type,
    );
  }
});

Deno.test("MSL-B064: untyped entry (no profile) is not checked", async () => {
  const text = entry(NO_THEN, undefined);
  const { entries } = await parseFile(text, { file: "/t.md" });
  assertEquals(checkBlockRoles(entries, null), []);
});

Deno.test("MSL-B064: block with a parse error is skipped", async () => {
  const entries = await load(
    entry(
      "Scenario: Broken\n    Given a\n  Whatever is this\n    When b",
      "Requirement",
    ),
  );
  assertEquals(checkBlockRoles(entries, null), []);
  assertEquals(
    checkFeatureParse(entries).some((d) => d.code === "MSL-B062"),
    true,
  );
});

Deno.test("MSL-B064: upstream entry is not checked", async () => {
  const entries = (await load(entry(NO_THEN, "Requirement"))).map((e) => ({
    ...e,
    origin: {
      kind: "upstream" as const,
    },
  })) as unknown as Entry[];
  assertEquals(checkBlockRoles(entries, null), []);
});

Deno.test("checkBlockRoles: no feature fences returns []", async () => {
  const text =
    "# Doc\n\n- [REQ_X_0001] T\n\n  Text.\n\n      Id: 01TST00000000000000000010A\n      Type: Requirement\n";
  assertEquals(checkBlockRoles(await load(text), null), []);
});

// ---------------------------------------------------------------------------
// Task 3 review additions
// ---------------------------------------------------------------------------

Deno.test("MSL-B064: outline with no Then is reported", async () => {
  const text = entry(
    "Scenario Outline: O\n  Given <a>\n  When b\n\n  Examples:\n    | a |\n    | 1 |",
    "Requirement",
  );
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.map((d) => d.code), ["MSL-B064"]);
});

Deno.test("MSL-B064: Then only in a Background is not the outcome", async () => {
  const text = entry(
    "Background:\n  Then bg\n\nScenario: S\n  When b",
    "Requirement",
  );
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.map((d) => d.code), ["MSL-B064"]);
});

// ---------------------------------------------------------------------------
// MSL-B065 to MSL-B068
// ---------------------------------------------------------------------------

const lineOf = (text: string, line: number): string =>
  text.split("\n")[line - 1].trim();

Deno.test("MSL-B065: procedure step with a Then and no action", async () => {
  const text = entry(
    "Scenario: S\n  Given a\n  Then b\n  When c\n  Then d",
    "Test",
    "TST_X",
  );
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.length, 1);
  assertEquals(diags[0].code, "MSL-B065");
  assertEquals(diags[0].severity, "info");
  assertEquals(diags[0].location!.column, 1);
  assertEquals(lineOf(text, diags[0].location!.line), "Then b");
  assertEquals(
    diags[0].message,
    'TST_X_0001: step 1 of scenario "S" has an expected result and no ' +
      "action; add a When step before the Then step",
  );
});

Deno.test("MSL-B065: not reported in a Requirement", async () => {
  const text = entry("Scenario: S\n  Given a\n  Then b", "Requirement");
  assertEquals(checkBlockRoles(await load(text), null), []);
});

Deno.test("MSL-B066: first And in a Test", async () => {
  const text = entry("Scenario: S\n  And a\n  Then b", "Test", "TST_X");
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.map((d) => d.code), ["MSL-B066"]);
  assertEquals(diags[0].severity, "info");
  assertEquals(lineOf(text, diags[0].location!.line), "And a");
  assertEquals(
    diags[0].message,
    'TST_X_0001: scenario "S" starts with "And"; the step is read as an ' +
      "action; start with Given, When or Then",
  );
});

Deno.test("MSL-B066: first But in a Requirement", async () => {
  const text = entry("Scenario: S\n  But a\n  Then b", "Requirement");
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.map((d) => d.code), ["MSL-B066"]);
  assertEquals(
    diags[0].message,
    'REQ_X_0001: scenario "S" starts with "But"; the step is read as an ' +
      "action; start with Given, When or Then",
  );
});

Deno.test("MSL-B066: a first And after a Background is still reported", async () => {
  const text = entry(
    "Background:\n  Given bg\n\nScenario: S\n  And a\n  Then b",
    "Requirement",
  );
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.map((d) => d.code), ["MSL-B066"]);
  assertEquals(lineOf(text, diags[0].location!.line), "And a");
});

Deno.test("MSL-B067: misplaced Step label in a Test", async () => {
  const text = entry(
    "Scenario: S\n  # Step 0\n  Given a\n  When b\n  Then c",
    "Test",
    "TST_X",
  );
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.map((d) => d.code), ["MSL-B067"]);
  assertEquals(diags[0].severity, "info");
  assertEquals(diags[0].location!.column, 1);
  assertEquals(lineOf(text, diags[0].location!.line), "# Step 0");
  assertEquals(
    diags[0].message,
    'TST_X_0001: "# Step 0" labels no procedure step; place it on ' +
      "the first line of a procedure step",
  );
});

Deno.test("MSL-B067: labels in a Requirement are not checked", async () => {
  const text = entry(
    "Scenario: S\n  # Step 0\n  Given a\n  When b\n  Then c",
    "Requirement",
  );
  assertEquals(checkBlockRoles(await load(text), null), []);
});

Deno.test("MSL-B067: a label in a Background is reported", async () => {
  const text = entry(
    "Background:\n  # Step 1\n  Given bg\n\nScenario: S\n  When b\n  Then c",
    "Test",
  );
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.map((d) => d.code), ["MSL-B067"]);
});

Deno.test("MSL-B068: feature block in a Component", async () => {
  const text = entry("Scenario: S\n  When a\n  Then b", "Component", "SWC_X");
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.length, 1);
  assertEquals(diags[0].code, "MSL-B068");
  assertEquals(diags[0].severity, "info");
  assertEquals(diags[0].location!.column, 1);
  assertEquals(
    diags[0].message,
    "SWC_X_0001: Gherkin block in a Component entry is an illustration; " +
      "only Requirement, Contract and Test entries give it a meaning",
  );
});

Deno.test("MSL-B068: not reported for an untyped entry", async () => {
  const text = entry("Scenario: S\n  When a\n  Then b", undefined);
  const { entries } = await parseFile(text, { file: "/t.md" });
  assertEquals(checkBlockRoles(entries, null), []);
});

Deno.test("checkBlockRoles: diagnostics are sorted by file line within an entry", async () => {
  const text = entry(
    "Scenario: A\n  # Step 9\n  Given g\n  And a\n  Then b\n\nScenario: B\n  Given c\n  Then d",
    "Test",
    "TST_X",
  );
  const diags = checkBlockRoles(await load(text), null);
  const lines = diags.map((d) => d.location!.line);
  assertEquals(diags.length >= 3, true);
  assertEquals(lines, [...lines].sort((a, b) => a - b));
});

/** An entry with two fenced `feature` blocks in its body. */
const twoBlocks = (first: string, second: string, type: string): string => {
  const fence = (block: string) =>
    "  ```feature\n" + block.split("\n").map((l) => "  " + l).join("\n") +
    "\n  ```";
  return `# Doc

- [TST_X_0001] Title

  Text.

${fence(first)}

  More text.

${fence(second)}

    Id: 01TST00000000000000000010A
      Type: ${type}
`;
};

Deno.test("MSL-B067: a # language header and plain comments give none", async () => {
  const text = entry(
    "# language: en\n# note\nScenario: S\n  When a\n  Then b",
    "Test",
    "TST_X",
  );
  assertEquals(checkBlockRoles(await load(text), null), []);
  const outside = entry(
    "Scenario: A\n  When a\n  Then b\n# note\nScenario: B\n  When c\n  Then d",
    "Test",
    "TST_X",
  );
  assertEquals(checkBlockRoles(await load(outside), null), []);
});

Deno.test("MSL-B067: a label above a precondition that opens a later step is placed", async () => {
  const text = entry(
    "Scenario: S\n  When a\n  Then b\n  # Step 2\n  Given c\n  When d\n  Then e",
    "Test",
    "TST_X",
  );
  assertEquals(checkBlockRoles(await load(text), null), []);
});

Deno.test("MSL-B067: a bare # Step that labels no step is reported", async () => {
  const text = entry(
    "Scenario: S\n  # Step\n  Given a\n  When b\n  Then c",
    "Test",
    "TST_X",
  );
  assertEquals(
    checkBlockRoles(await load(text), null).map((d) => d.code),
    ["MSL-B067"],
  );
});

Deno.test("MSL-B067: a label above a description line is reported", async () => {
  const text = entry(
    "Scenario: S\n  # Step 1\n  Some description.\n  When a\n  Then b",
    "Test",
    "TST_X",
  );
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.map((d) => d.code), ["MSL-B067"]);
  assertEquals(lineOf(text, diags[0].location!.line), "# Step 1");
});

Deno.test("MSL-B068: reported once per block, at its first line, with no other role info", async () => {
  const text = entry(
    "Scenario: A\n  And a\n  Then b\n\nScenario: B\n  Then c",
    "Component",
    "SWC_X",
  );
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.map((d) => d.code), ["MSL-B068"]);
  assertEquals(
    lineOf(text, diags[0].location!.line),
    "Scenario: A",
  );
});

Deno.test("MSL-B068: both blocks of an entry are checked", async () => {
  const text = twoBlocks(
    "Scenario: A\n  When a\n  Then b",
    "Scenario: B\n  When c\n  Then d",
    "Component",
  );
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.map((d) => d.code), ["MSL-B068", "MSL-B068"]);
  assertEquals(lineOf(text, diags[0].location!.line), "Scenario: A");
  assertEquals(lineOf(text, diags[1].location!.line), "Scenario: B");
});

Deno.test("MSL-B064: both blocks of an entry are checked", async () => {
  const text = twoBlocks(
    "Scenario: A\n  When a\n  Then b",
    "Scenario: B\n  Given c\n  When d",
    "Requirement",
  );
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.map((d) => d.code), ["MSL-B064"]);
  assertEquals(lineOf(text, diags[0].location!.line), "Scenario: B");
});

Deno.test("MSL-B065: reported at the first expected-result step", async () => {
  const text = entry(
    "Scenario: S\n  Given a\n  Then b\n  And c",
    "Test",
    "TST_X",
  );
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.map((d) => d.code), ["MSL-B065"]);
  assertEquals(lineOf(text, diags[0].location!.line), "Then b");
});

Deno.test("MSL-B066: a localized And is reported", async () => {
  const text = entry(
    "# language: fr\nFonctionnalité: F\n  Scénario: S\n    Et a\n    Alors b",
    "Test",
    "TST_X",
  );
  const diags = checkBlockRoles(await load(text), null);
  assertEquals(diags.map((d) => d.code), ["MSL-B066"]);
  assertEquals(lineOf(text, diags[0].location!.line), "Et a");
});

Deno.test("block roles: blocks nested in a list item are checked for B065 to B068", async () => {
  const nested = (block: string, type: string, prefix: string) =>
    entry(block, type, prefix, true);
  const codes = async (text: string) =>
    (checkBlockRoles(await load(text), null)).map((d) => d.code);
  assertEquals(
    await codes(nested(
      "Scenario: S\n  Given a\n  Then b\n  When c\n  Then d",
      "Test",
      "TST_X",
    )),
    ["MSL-B065"],
  );
  assertEquals(
    await codes(nested("Scenario: S\n  And a\n  Then b", "Test", "TST_X")),
    ["MSL-B066"],
  );
  assertEquals(
    await codes(nested(
      "Scenario: S\n  # Step 0\n  Given a\n  When b\n  Then c",
      "Test",
      "TST_X",
    )),
    ["MSL-B067"],
  );
  assertEquals(
    await codes(nested(
      "Scenario: S\n  When a\n  Then b",
      "Component",
      "SWC_X",
    )),
    ["MSL-B068"],
  );
});
