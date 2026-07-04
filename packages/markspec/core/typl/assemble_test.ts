/**
 * @module typl/assemble_test
 *
 * Entry-level assembly tests (#723) — drives the full `parseMarkdown`
 * pipeline (matching the existing typl fixture convention in
 * `parser/markdown_test.ts`, which calls `parseMarkdown` synchronously
 * rather than the async `parseFile`) so the fixtures exercise the real
 * bodyAst / bodyTokens shapes the three surfaces produce.
 */
import { assertEquals } from "@std/assert";
import { parseMarkdown } from "../parser/markdown.ts";

Deno.test("assemble: relative bullets resolve under a root namespace", () => {
  const md = `- [REQ_0001] Contract

  Root (\`$powertrain.brake : namespace\`) declares:

  - \`$.pedal_position : signal float[0..100]\` — pedal.
  - \`$.line_pressure : signal float[0..250]\` — pressure.
`;
  const { entries, diagnostics } = parseMarkdown(md, { file: "a.md" });
  assertEquals(diagnostics.filter((d) => d.code.startsWith("TYPL")).length, 0);
  const types = entries[0].types!;
  assertEquals(types.rootNamespace, "powertrain.brake");
  assertEquals(types.bindings.map((b) => b.name), [
    "$powertrain.brake.pedal_position",
    "$powertrain.brake.line_pressure",
  ]);
});

Deno.test("assemble: nested namespace bullet scopes its subtree (innermost wins)", () => {
  // Bare bullet-glossary syntax (no backticks) — the bullet-declaration
  // surface (extractTyplBulletsNested) only recognizes a bullet whose
  // *entire* first-paragraph text is the raw `$X : kind` declaration
  // (see markdown_test.ts's "bullet-glossary" fixtures). A backtick-
  // wrapped span in a bullet (`` - `$X : kind` ``) is instead picked up
  // by the flat inline-code surface, which carries no bullet-nesting
  // link — the wrong surface to exercise nested-bullet base scoping.
  const md = `- [REQ_0002] Contract

  - $powertrain : namespace
    - $.brake : namespace
      - $.pedal : signal
    - $.speed : signal
`;
  const { entries } = parseMarkdown(md, { file: "a.md" });
  const names = entries[0].types!.bindings.map((b) => b.name);
  assertEquals(names, ["$powertrain.brake.pedal", "$powertrain.speed"]);
  assertEquals(entries[0].types!.rootNamespace, "powertrain");
});

Deno.test("assemble: relative with no base is TYPL-010, binding dropped", () => {
  const md = `- [REQ_0003] Orphan

  Declares \`$.pedal : signal\`.
`;
  const { entries, diagnostics } = parseMarkdown(md, { file: "a.md" });
  assertEquals(diagnostics.some((d) => d.code === "TYPL-010"), true);
  assertEquals(entries[0].types, undefined);
});

Deno.test("assemble: second root namespace is TYPL-012; first wins", () => {
  const md = `- [REQ_0004] Two roots

  First (\`$powertrain : namespace\`), second (\`$cabin : namespace\`),
  and \`$.speed : signal\`.
`;
  const { entries, diagnostics } = parseMarkdown(md, { file: "a.md" });
  assertEquals(diagnostics.some((d) => d.code === "TYPL-012"), true);
  assertEquals(entries[0].types!.rootNamespace, "powertrain");
  assertEquals(entries[0].types!.bindings.map((b) => b.name), [
    "$powertrain.speed",
  ]);
});

Deno.test("assemble: namespace bindings never enter Entry.types.bindings", () => {
  const md = `- [REQ_0005] Contract

  Root (\`$powertrain.brake : namespace\`) and \`$local : signal\`.
`;
  const { entries } = parseMarkdown(md, { file: "a.md" });
  assertEquals(entries[0].types!.bindings.map((b) => b.name), ["$local"]);
});
