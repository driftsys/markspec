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

// ---------------------------------------------------------------------------
// Table surface (#724 / S6) — a fourth embedding surface. Each data row
// `$name | kind shape | description` is one binding; a `Table:` caption may
// carry a base the entry-local resolver consumes.
// ---------------------------------------------------------------------------

/** Project a binding to its position-independent shape, for parity checks. */
function bindingShape(b: { name: string; kind: string; shape?: unknown }) {
  return { name: b.name, kind: b.kind, shape: b.shape };
}

Deno.test("assemble: a table row produces a binding equal to the inline surface (parity)", () => {
  const tableMd = `- [REQ_0100] Speed contract

  | Name | Kind shape | Description |
  | ------ | -------------------- | ------------- |
  | $speed | signal float[0..300] | vehicle speed |
`;
  const inlineMd = `- [REQ_0100] Speed contract

  Declares \`$speed : signal float[0..300]\`.
`;
  const table = parseMarkdown(tableMd, { file: "a.md" });
  const inline = parseMarkdown(inlineMd, { file: "a.md" });
  assertEquals(
    table.diagnostics.filter((d) => d.code.startsWith("TYPL")).length,
    0,
  );
  assertEquals(
    table.entries[0].types!.bindings.map(bindingShape),
    inline.entries[0].types!.bindings.map(bindingShape),
  );
  assertEquals(table.entries[0].types!.bindings.length, 1);
});

Deno.test("assemble: a Table caption base resolves relative table rows", () => {
  const md = `- [REQ_0101] Brake contract

  Table: $powertrain.brake

  | Name | Kind shape | Description |
  | ---------------- | -------------------- | -------- |
  | $.pedal_position | signal float[0..100] | pedal |
  | $.line_pressure | signal float[0..250] | pressure |
`;
  const { entries, diagnostics } = parseMarkdown(md, { file: "a.md" });
  assertEquals(diagnostics.filter((d) => d.code.startsWith("TYPL")).length, 0);
  assertEquals(entries[0].types!.bindings.map((b) => b.name), [
    "$powertrain.brake.pedal_position",
    "$powertrain.brake.line_pressure",
  ]);
});

Deno.test("assemble: a mixed table extracts only the typl rows", () => {
  const md = `- [REQ_0102] Config

  | Name | Kind shape | Description |
  | ------ | -------------------- | ---------------- |
  | $speed | signal float[0..300] | vehicle speed |
  | note | see appendix A | not a declaration |
`;
  const { entries } = parseMarkdown(md, { file: "a.md" });
  assertEquals(entries[0].types!.bindings.map((b) => b.name), ["$speed"]);
});

Deno.test("assemble: a union shape survives a table cell when its pipes are GFM-escaped", () => {
  // ADR-019 rejected a table surface partly because literal `|` in a union
  // breaks GFM columns. Escaping each `|` as `\|` (standard GFM) resolves it:
  // the cell un-escapes to the full union before the recognizer sees it.
  const md = `- [REQ_0104] Mode

  | Name | Kind shape | Description |
  | ----- | ------------------------ | ---- |
  | $mode | 'low' \\| 'mid' \\| 'high' | mode |
`;
  const { entries, diagnostics } = parseMarkdown(md, { file: "a.md" });
  assertEquals(diagnostics.filter((d) => d.code.startsWith("TYPL")).length, 0);
  const binding = entries[0].types!.bindings[0];
  assertEquals(binding.name, "$mode");
  assertEquals(binding.shape, {
    kind: "enum",
    values: ["low", "mid", "high"],
  });
});

Deno.test("assemble: a table composes with the fence surface in one entry", () => {
  const md = `- [REQ_0103] Mixed surfaces

  \`\`\`typl
  $rpm : signal int[0..8000]
  \`\`\`

  | Name | Kind shape | Description |
  | ------ | -------------------- | ------------- |
  | $speed | signal float[0..300] | vehicle speed |
`;
  const { entries, diagnostics } = parseMarkdown(md, { file: "a.md" });
  assertEquals(diagnostics.filter((d) => d.code.startsWith("TYPL")).length, 0);
  assertEquals(entries[0].types!.bindings.map((b) => b.name), [
    "$rpm",
    "$speed",
  ]);
});
