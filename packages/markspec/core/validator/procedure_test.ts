/**
 * @module core/validator/procedure_test
 *
 * Unit tests for the MSL-B063 warning: a procedure step with actions and no
 * expected result (epic #915).
 */

import { assertEquals } from "@std/assert";
import { loadGherkin } from "../gherkin/load.ts";
import { parseFile } from "../parser/mod.ts";
import type { Entry } from "../model/mod.ts";
import type { EffectiveProfile } from "../model/mod.ts";
import { checkFeatureParse } from "./feature_parse.ts";
import { checkProcedureSteps } from "./procedure.ts";

await loadGherkin();

const doc = (block: string, type: string, fence = "feature"): string =>
  `# Doc

- [TST_BRK_0010] Braking procedure

  The procedure verifies braking.

  \`\`\`${fence}
${block.split("\n").map((l) => "  " + l).join("\n")}
  \`\`\`

      Id: 01TST00000000000000000010A
      Type: ${type}
`;

/** Entries as the pipeline gives them: `type` taken from the trailer. */
async function load(text: string, file = "/t.md"): Promise<Entry[]> {
  const { entries } = await parseFile(text, { file });
  return entries.map((e) => ({
    ...e,
    type: e.typedAttributes.get("Type")?.[0],
  }));
}

const TRAILING = `Scenario: Stop
  Given a moving vehicle
  When the driver brakes
  Then the vehicle stops
  When the driver releases the pedal`;

Deno.test("checkProcedureSteps: trailing action → one warning at its line", async () => {
  const text = doc(TRAILING, "Test");
  const diags = checkProcedureSteps(await load(text), null);
  assertEquals(diags.length, 1);
  assertEquals(diags[0].code, "MSL-B063");
  assertEquals(diags[0].severity, "warning");
  assertEquals(diags[0].location!.column, 1);
  const line = text.split("\n")[diags[0].location!.line - 1];
  assertEquals(line.includes("releases the pedal"), true, line);
  assertEquals(
    diags[0].message,
    'TST_BRK_0010: step 2 of scenario "Stop" has no expected result ' +
      "(no Then step); add a Then step after the last action",
  );
});

Deno.test("checkProcedureSteps: reported at the last action of a run", async () => {
  const text = doc(
    "Scenario: Stop\n  When a\n  And b\n  Then c\n  When d\n  And e",
    "Test",
  );
  const diags = checkProcedureSteps(await load(text), null);
  assertEquals(diags.length, 1);
  assertEquals(
    text.split("\n")[diags[0].location!.line - 1].trim(),
    "And e",
  );
});

Deno.test("checkProcedureSteps: every step paired → none", async () => {
  const text = doc(
    "Scenario: Stop\n  Given a\n  When b\n  Then c\n  When d\n  Then e",
    "Test",
  );
  assertEquals(checkProcedureSteps(await load(text), null), []);
});

Deno.test("checkProcedureSteps: preconditions only → none", async () => {
  const text = doc("Scenario: Stop\n  Given a\n  And b", "Test");
  assertEquals(checkProcedureSteps(await load(text), null), []);
});

Deno.test("checkProcedureSteps: Requirement entry → none", async () => {
  const text = doc(TRAILING, "Requirement");
  assertEquals(checkProcedureSteps(await load(text), null), []);
});

Deno.test("checkProcedureSteps: entry without a type → none", async () => {
  const entries = (await load(doc(TRAILING, "Test"))).map((e) => ({
    ...e,
    type: undefined,
  }));
  assertEquals(checkProcedureSteps(entries, null), []);
});

Deno.test("checkProcedureSteps: profile type extending Test → warning", async () => {
  const profile = {
    types: new Map([["Check", { value: { extends: "Test" }, origin: "p" }]]),
  } as unknown as EffectiveProfile;
  const text = doc(TRAILING, "Check");
  assertEquals(checkProcedureSteps(await load(text), profile).length, 1);
  assertEquals(checkProcedureSteps(await load(text), null), []);
});

Deno.test("checkProcedureSteps: gherkin fence is checked as well", async () => {
  const text = doc(TRAILING, "Test", "gherkin");
  assertEquals(checkProcedureSteps(await load(text), null).length, 1);
});

Deno.test("checkProcedureSteps: block nested in a list item is reported", async () => {
  const text = [
    "- [TST_BRK_0010] Braking procedure",
    "",
    "  The procedure verifies braking.",
    "",
    "  - Steps:",
    "",
    "    ```feature",
    "    Scenario: Stop",
    "      When the driver brakes",
    "    ```",
    "",
    "      Id: 01TST00000000000000000010A",
    "      Type: Test",
    "",
  ].join("\n");
  const diags = checkProcedureSteps(await load(text), null);
  assertEquals(diags.length, 1);
  assertEquals(
    text.split("\n")[diags[0].location!.line - 1].includes("driver brakes"),
    true,
  );
});

Deno.test("checkProcedureSteps: block with a parse error → none", async () => {
  const text = doc(
    "Scenario: Broken\n    Given a\n  Whatever is this\n    When b",
    "Test",
  );
  const entries = await load(text);
  assertEquals(checkProcedureSteps(entries, null), []);
  assertEquals(
    checkFeatureParse(entries).some((d) => d.code === "MSL-B062"),
    true,
  );
});

Deno.test("checkProcedureSteps: block without feature (parser not loaded) → none", async () => {
  const entries = (await load(doc(TRAILING, "Test"))).map((e) => ({
    ...e,
    bodyAst: e.bodyAst?.map((b) =>
      b.kind === "feature" ? { ...b, feature: undefined } : b
    ),
  })) as Entry[];
  assertEquals(checkProcedureSteps(entries, null), []);
});

Deno.test("checkProcedureSteps: scenario inside a Rule → warning", async () => {
  const text = doc(
    "Rule: Braking\n  Background:\n    Given a\n  Scenario: Stop\n    When b",
    "Test",
  );
  const diags = checkProcedureSteps(await load(text), null);
  assertEquals(diags.length, 1);
  assertEquals(diags[0].message.includes('scenario "Stop"'), true);
});

Deno.test("checkProcedureSteps: Scenario Outline → one warning, not per row", async () => {
  const text = doc(
    "Scenario Outline: Stop at <speed>\n  When braking at <speed>\n" +
      "  Examples:\n    | speed |\n    | 10 |\n    | 20 |",
    "Test",
  );
  const diags = checkProcedureSteps(await load(text), null);
  assertEquals(diags.length, 1);
  assertEquals(diags[0].message.includes("Stop at <speed>"), true);
});

Deno.test("checkProcedureSteps: two scenarios → one warning each, in order", async () => {
  const text = doc(
    "Scenario: One\n  When a\nScenario: Two\n  When b",
    "Test",
  );
  const diags = checkProcedureSteps(await load(text), null);
  assertEquals(diags.length, 2);
  assertEquals(diags[0].message.includes('"One"'), true);
  assertEquals(diags[1].message.includes('"Two"'), true);
});

Deno.test("checkProcedureSteps: Rust doc comment → file line", async () => {
  const src = [
    "/// [TST_A_0001] Brake test",
    "///",
    "/// The test verifies braking.",
    "///",
    "/// ```gherkin",
    "/// Scenario: Stop",
    "///   When the driver brakes",
    "/// ```",
    "///",
    "///     Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "///     Type: Test",
    "fn f() {}",
    "",
  ].join("\n");
  const diags = checkProcedureSteps(await load(src, "lib.rs"), null);
  assertEquals(diags.length, 1);
  assertEquals(
    src.split("\n")[diags[0].location!.line - 1].includes("driver brakes"),
    true,
  );
});

Deno.test("checkProcedureSteps: upstream entry → none", async () => {
  const entries = (await load(doc(TRAILING, "Test"))).map((e) => ({
    ...e,
    origin: {
      kind: "upstream" as const,
    },
  })) as unknown as Entry[];
  assertEquals(checkProcedureSteps(entries, null), []);
});

Deno.test("checkProcedureSteps: a setup-only step gives no warning and no throw", async () => {
  const text = doc("Scenario: S\n  When a\n  Then b\n  Given c", "Test");
  assertEquals(checkProcedureSteps(await load(text), null), []);
});

Deno.test("checkProcedureSteps: two result-less steps give two warnings at their own lines", async () => {
  const text = doc("Scenario: S\n  When a\n  Given b\n  When c", "Test");
  const diags = checkProcedureSteps(await load(text), null);
  assertEquals(diags.length, 2);
  const lines = text.split("\n");
  assertEquals(lines[diags[0].location!.line - 1].trim(), "When a");
  assertEquals(lines[diags[1].location!.line - 1].trim(), "When c");
  assertEquals(diags[0].message.includes("step 1"), true);
  assertEquals(diags[1].message.includes("step 2"), true);
});

Deno.test("checkProcedureSteps: every feature fence of an entry is checked", async () => {
  const text = `- [TST_BRK_0010] Braking procedure

  \`\`\`feature
  Scenario: One
    When a
  \`\`\`

  \`\`\`feature
  Scenario: Two
    When b
  \`\`\`

      Id: 01TST00000000000000000010A
      Type: Test
`;
  const diags = checkProcedureSteps(await load(text), null);
  assertEquals(diags.length, 2);
  const lines = text.split("\n");
  assertEquals(lines[diags[0].location!.line - 1].trim(), "When a");
  assertEquals(lines[diags[1].location!.line - 1].trim(), "When b");
});

Deno.test("checkProcedureSteps: classifies an unclassified entry by its display-ID prefix", async () => {
  const profile = {
    types: new Map([["test", {
      value: {
        name: "test",
        extends: "Test",
        displayIdPattern: { value: "TST_BRK_{n:04d}", origin: "p" },
        displayIdPatternEnforcement: { value: "off", origin: "p" },
      },
      origin: "p",
    }]]),
  } as unknown as EffectiveProfile;
  const text = doc(TRAILING, "Test").replace("      Type: Test\n", "");
  const { entries } = await parseFile(text, { file: "/t.md" });
  assertEquals(entries.every((e) => e.type === undefined), true);
  assertEquals(checkProcedureSteps(entries, profile).length, 1);
  assertEquals(checkProcedureSteps(entries, null), []);
});
