/**
 * @module core/validator/block_role_load_order_test
 *
 * The block-role diagnostics depend on the Gherkin AST, which exists only
 * for entries parsed after the lazy parser loaded. The parser cache is
 * process-wide, so each check runs in a new `deno eval` process and does not
 * depend on test order.
 */

import { assertEquals } from "@std/assert";

const TEXT = `# Doc

- [REQ_X_0001] Braking criterion

  The criterion states braking.

  \`\`\`feature
  Scenario: Stop
    Given a moving vehicle
    When the driver brakes
  \`\`\`

      Id: 01REQ00000000000000000010A

- [TST_X_0002] Braking procedure

  The procedure verifies braking.

  \`\`\`feature
  Scenario: Stop
    Given a moving vehicle
    # Step 1
    When the driver brakes
    Then the vehicle stops
    # Step 2
  \`\`\`

      Id: 01TST00000000000000000020A
`;

/** Run `body` in a new process; returns the JSON it prints. */
async function inFreshProcess(body: string): Promise<unknown> {
  const mod = (path: string) => new URL(path, import.meta.url).href;
  const script = `
import { parse, parseFile } from ${JSON.stringify(mod("../parser/mod.ts"))};
import { loadGherkin } from ${JSON.stringify(mod("../gherkin/load.ts"))};
import { checkBlockRoles } from ${JSON.stringify(mod("./block_role.ts"))};
const TEXT = ${JSON.stringify(TEXT)};
const typed = (entries) => entries.map((e) => ({
  ...e,
  type: e.id?.startsWith("01REQ") ? "Requirement" : "Test",
}));
const summary = (entries) =>
  checkBlockRoles(typed(entries), null).map((d) => [d.code, d.location.line]);
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

Deno.test("block roles (fresh process): parseFile loads the parser itself", async () => {
  const found = await inFreshProcess(`
const { entries } = await parseFile(TEXT, { file: "/t.md" });
console.log(JSON.stringify(summary(entries)));
`);
  assertEquals(found, [["MSL-B064", 8], ["MSL-B067", 25]]);
});

Deno.test("block roles (fresh process): parse after loadGherkin equals parseFile", async () => {
  const found = await inFreshProcess(`
await loadGherkin();
console.log(JSON.stringify(summary(parse(TEXT, { file: "/t.md" }))));
`);
  assertEquals(found, [["MSL-B064", 8], ["MSL-B067", 25]]);
});

Deno.test("block roles (fresh process): synchronous parse before any load gives none", async () => {
  const found = await inFreshProcess(`
console.log(JSON.stringify(summary(parse(TEXT, { file: "/t.md" }))));
`);
  assertEquals(found, []);
});
