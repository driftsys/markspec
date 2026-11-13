/**
 * @module core/validator/feature_parse_test
 *
 * Unit tests for the MSL-B062 Gherkin parse-error warning (epic #915).
 */

import { assert, assertEquals } from "@std/assert";
import { loadGherkin } from "../gherkin/load.ts";
import { parseFile } from "../parser/mod.ts";
import { checkFeatureParse } from "./feature_parse.ts";
import { applyCorpusPostPass } from "./corpus.ts";

const BROKEN = `Scenario: Broken
    Given a
  Whatever is this
    Then b`;

const doc = (blocks: string[], type = "Requirement"): string =>
  `# Doc

- [REQ_BRK_0010] Braking

  The controller shall brake.

${
    blocks.map((b) =>
      "  ```feature\n" + b.split("\n").map((l) => "  " + l).join("\n") +
      "\n  ```\n"
    ).join("\n")
  }
      Id: 01REQ00000000000000000010A
      Type: ${type}
`;

await loadGherkin();

Deno.test("checkFeatureParse: one broken block → one warning at the error line", async () => {
  const text = doc([BROKEN]);
  const { entries } = await parseFile(text, { file: "/r.md" });
  const diags = checkFeatureParse(entries);
  assertEquals(diags.length, 1);
  assertEquals(diags[0].code, "MSL-B062");
  assertEquals(diags[0].severity, "warning");
  const lines = text.split("\n");
  const line = diags[0].location!.line;
  assertEquals(lines[line - 1].includes("Whatever"), true);
  assertEquals(diags[0].message.startsWith("REQ_BRK_0010: "), true);
});

Deno.test("checkFeatureParse: two broken blocks → two warnings", async () => {
  const { entries } = await parseFile(doc([BROKEN, BROKEN]), {
    file: "/r.md",
  });
  assertEquals(checkFeatureParse(entries).length, 2);
});

Deno.test("checkFeatureParse: valid block → none", async () => {
  const { entries } = await parseFile(
    doc(["Scenario: Ok\n  Given a\n  Then b"]),
    { file: "/r.md" },
  );
  assertEquals(checkFeatureParse(entries), []);
});

Deno.test("checkFeatureParse: runs for a Test entry", async () => {
  const { entries } = await parseFile(doc([BROKEN], "Test"), {
    file: "/r.md",
  });
  assertEquals(checkFeatureParse(entries).length, 1);
});

Deno.test("checkFeatureParse: message has no block-relative position", async () => {
  const { entries } = await parseFile(doc([BROKEN]), { file: "/r.md" });
  const [d] = checkFeatureParse(entries);
  assertEquals(/\(\d+:\d+\)/.test(d.message), false);
});

Deno.test("checkFeatureParse: indented Markdown fence → column 1", async () => {
  const { entries } = await parseFile(doc([BROKEN]), { file: "/r.md" });
  assertEquals(checkFeatureParse(entries)[0].location!.column, 1);
});

Deno.test("checkFeatureParse: Rust doc comment → file line, column 1", async () => {
  const src = [
    "/// [REQ_A_0001] Brake",
    "///",
    "/// The system shall brake.",
    "///",
    "/// ```gherkin",
    "/// Scenario: Stop",
    "///   Given a",
    "///   Whatever is this",
    "/// ```",
    "///",
    "///     Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "fn f() {}",
    "",
  ].join("\n");
  const { entries } = await parseFile(src, { file: "lib.rs" });
  const diags = checkFeatureParse(entries);
  assertEquals(diags.length, 1);
  assertEquals(
    src.split("\n")[diags[0].location!.line - 1].includes("Whatever"),
    true,
  );
  assertEquals(diags[0].location!.column, 1);
});

Deno.test("checkFeatureParse: a block with two errors → one warning at the first", async () => {
  const twoErrors = `Scenario: Broken
    Given a
  First bad line
    Then b
  Second bad line`;
  const text = doc([twoErrors]);
  const { entries } = await parseFile(text, { file: "/r.md" });
  const diags = checkFeatureParse(entries);
  assertEquals(diags.length, 1);
  const line = text.split("\n")[diags[0].location!.line - 1];
  assertEquals(line.includes("First bad line"), true, line);
});

Deno.test("checkFeatureParse: a broken block nested in a list item is reported", async () => {
  const text = [
    "- [REQ_BRK_0010] Braking",
    "",
    "  The controller shall brake.",
    "",
    "  - Criteria:",
    "",
    "    ```gherkin",
    "    Scenario: Stop",
    "      Given a",
    "    Whatever is this",
    "    ```",
    "",
    "      Id: 01REQ00000000000000000010A",
    "",
  ].join("\n");
  const { entries } = await parseFile(text, { file: "/r.md" });
  const diags = checkFeatureParse(entries);
  assertEquals(diags.length, 1);
  const line = text.split("\n")[diags[0].location!.line - 1];
  assertEquals(line.includes("Whatever"), true, line);
});

Deno.test("checkFeatureParse: message ends with the parser reason", async () => {
  const { entries } = await parseFile(doc([BROKEN]), { file: "/r.md" });
  const [d] = checkFeatureParse(entries);
  assertEquals(d.message.includes("scenario names"), false, d.message);
  const node = entries[0].bodyAst?.find((b) => b.kind === "feature") as {
    parseError?: { message: string };
  };
  const reason = node.parseError!.message.split("\n")[0]
    .replace(/^\(\d+:\d+\):\s*/, "").trim();
  assert(reason.length > 0);
  assertEquals(
    d.message,
    `REQ_BRK_0010: Gherkin block does not parse: ${reason}`,
  );
});

Deno.test("checkFeatureParse: a broken block two list levels deep is reported", async () => {
  const text = [
    "- [REQ_BRK_0010] Braking",
    "",
    "  The controller shall brake.",
    "",
    "  - Criteria:",
    "",
    "    - Stop case:",
    "",
    "      ```gherkin",
    "      Scenario: Stop",
    "        Given a",
    "      Whatever is this",
    "      ```",
    "",
    "      Id: 01REQ00000000000000000010A",
    "",
  ].join("\n");
  const { entries } = await parseFile(text, { file: "/r.md" });
  const diags = checkFeatureParse(entries);
  assertEquals(diags.length, 1);
  const line = text.split("\n")[diags[0].location!.line - 1];
  assertEquals(line.includes("Whatever"), true, line);
});

Deno.test("checkFeatureParse: check keeps a delivered-corpus warning with an origin prefix", async () => {
  const { entries } = await parseFile(doc([BROKEN]), {
    file: "/cache/p/r.md",
  });
  const corpus = entries.map((e) => ({
    ...e,
    origin: {
      kind: "profile" as const,
      profileId: "p",
      profileVersion: "1.0.0",
    },
  }));
  const out = applyCorpusPostPass(checkFeatureParse(corpus), corpus);
  assertEquals(out.length, 1);
  assertEquals(out[0].code, "MSL-B062");
  assertEquals(out[0].message.startsWith("delivered by p@1.0.0: "), true);
});
