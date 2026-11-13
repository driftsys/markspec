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
      checkBlockRoles(await load(entry(NO_THEN, type)), null),
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
