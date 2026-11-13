/**
 * @module core/validator/procedure_load_order_test
 *
 * MSL-B063 depends on the Gherkin AST, which exists only for entries parsed
 * after the lazy parser loaded. The parser cache is process-wide, so each
 * check runs in a new `deno eval` process and does not depend on test order.
 */

import { assertEquals } from "@std/assert";

const TEXT = `# Doc

- [TST_BRK_0010] Braking procedure

  The procedure verifies braking.

  \`\`\`feature
  Scenario: Stop
    Given a moving vehicle
    When the driver brakes
    Then the vehicle stops
    When the driver releases the pedal
  \`\`\`

      Id: 01TST00000000000000000010A
      Type: Test
`;

/** Run `body` in a new process; returns the JSON it prints. */
async function inFreshProcess(body: string): Promise<unknown> {
  const mod = (path: string) => new URL(path, import.meta.url).href;
  const script = `
import { parse, parseFile } from ${JSON.stringify(mod("../parser/mod.ts"))};
import { loadGherkin } from ${JSON.stringify(mod("../gherkin/load.ts"))};
import { checkProcedureSteps } from ${JSON.stringify(mod("./procedure.ts"))};
const TEXT = ${JSON.stringify(TEXT)};
const typed = (entries) => entries.map((e) => ({
  ...e,
  type: e.typedAttributes.get("Type")?.[0],
}));
${body}
`;
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--ext=ts", script],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = new TextDecoder().decode(out.stderr);
  assertEquals(out.code, 0, stderr);
  return JSON.parse(new TextDecoder().decode(out.stdout));
}

Deno.test("MSL-B063 (fresh process): synchronous parse before any load gives none", async () => {
  const codes = await inFreshProcess(`
const diags = checkProcedureSteps(typed(parse(TEXT, { file: "/t.md" })), null);
console.log(JSON.stringify(diags.map((d) => d.code)));
`);
  assertEquals(codes, []);
});

Deno.test("MSL-B063 (fresh process): parse after loadGherkin gives one warning", async () => {
  const codes = await inFreshProcess(`
await loadGherkin();
const diags = checkProcedureSteps(typed(parse(TEXT, { file: "/t.md" })), null);
console.log(JSON.stringify(diags.map((d) => d.code)));
`);
  assertEquals(codes, ["MSL-B063"]);
});

Deno.test("MSL-B063 (fresh process): parseFile loads the parser itself", async () => {
  const codes = await inFreshProcess(`
const { entries } = await parseFile(TEXT, { file: "/t.md" });
const diags = checkProcedureSteps(typed(entries), null);
console.log(JSON.stringify(diags.map((d) => d.code)));
`);
  assertEquals(codes, ["MSL-B063"]);
});
