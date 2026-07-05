import { assert, assertEquals } from "@std/assert";
import { validateUxil } from "./validator.ts";
import { parseMarkdown } from "../parser/markdown.ts";
import type { Entry } from "../model/mod.ts";

function entriesOf(files: Record<string, string>): Entry[] {
  const out: Entry[] = [];
  for (const [file, md] of Object.entries(files)) {
    const { entries } = parseMarkdown(md, { file });
    out.push(...entries);
  }
  return out;
}

const has = (
  ds: readonly { code: string }[],
  c: string,
) => ds.some((d) => d.code === c);

Deno.test("UXIL-009 unknown kind", () => {
  const md = `- [UXI_A_0001] X

  \`ux:a.b : widget\` — bad kind.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  assert(has(diagnostics, "UXIL-009"));
});

Deno.test("UXIL-010 unknown verb", () => {
  const md = `- [UXI_A_0001] X

  \`ux:a.b : screen\` offers:

  - \`/e : foo\` — an unknown verb.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  assert(has(diagnostics, "UXIL-010"));
});

Deno.test("UXIL-011 propagated from assembly (no root, declarations present)", () => {
  const md = `- [UXI_A_0001] X

  Just an element bullet:

  - \`/e : activate\` — no root anywhere.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  assert(has(diagnostics, "UXIL-011"));
});

Deno.test("UXIL-013 states on a stateless kind (panel)", () => {
  const md = `- [UXI_A_0001] X

  \`ux:a.b : panel @ locked\` — panels are stateless.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  assert(has(diagnostics, "UXIL-013"));
});

Deno.test("UXIL-014 observe exclusivity", () => {
  const md = `- [UXI_A_0001] X

  \`ux:a.b : screen\` offers:

  - \`/e : observe, activate\` — observe must be exclusive.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  assert(has(diagnostics, "UXIL-014"));
});

Deno.test("UXIL-015 duplicate surface across entries", () => {
  const a = `- [UXI_A_0001] A

  \`ux:media.home : screen\` — first.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const b = `- [UXI_B_0001] B

  \`ux:media.home : screen\` — duplicate.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZB
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": a, "b.md": b }));
  assert(has(diagnostics, "UXIL-015"));
});

Deno.test("UXIL-016 dangling namespace parent", () => {
  const md = `- [UXI_A_0001] X

  A promoted child surface with no declared parent:
  \`ux:a.b.c : screen\`.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  assert(has(diagnostics, "UXIL-016"));
});

Deno.test("UXIL-016 does not misfire on an ordinary two-segment root name", () => {
  // media.home is the epic's own canonical worked-example root naming
  // convention — an ordinary namespaced root, not a promoted child surface.
  // "media" is a namespace prefix, never itself a surface that must be
  // separately declared.
  const md = `- [UXI_A_0001] Media home surface

  \`ux:media.home : screen\` — an ordinary root, no other entries declare "media".

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  assert(
    !has(diagnostics, "UXIL-016"),
    `expected no UXIL-016 for an ordinary root name; got: ${
      JSON.stringify(diagnostics)
    }`,
  );
});

Deno.test("UXIL-017 navigate target not navigable", () => {
  const controls = `- [UXI_A_0001] Controls

  \`ux:a.controls : panel\` — a panel, never a nav target.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const home = `- [UXI_B_0001] Home

  \`ux:a.home : screen\` offers:

  - \`/go : navigate -> a.controls\` — bad nav target (a panel).

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZB
`;
  const { diagnostics } = validateUxil(
    entriesOf({ "controls.md": controls, "home.md": home }),
  );
  assert(has(diagnostics, "UXIL-017"));
});

Deno.test("validateUxil: clean corpus has no diagnostics and returns the registry", () => {
  const md = `- [UXI_A_0001] X

  \`ux:home : screen @ ready\` offers:

  - \`/go : navigate -> other\` — nav to a valid screen.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const other = `- [UXI_B_0001] Other

  \`ux:other : screen\` — a valid nav target.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZB
`;
  const { diagnostics, registry } = validateUxil(
    entriesOf({ "a.md": md, "other.md": other }),
  );
  assertEquals(diagnostics, []);
  assertEquals(registry.surfaces.get("home")?.length, 1);
});

Deno.test("UXIL-018 citation of an unknown surface", () => {
  const decl = `- [UXI_A_0001] A

  \`ux:home : screen\` — declared.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const cite = `- [FREQ_A_0001] Cite

  Pressing does \`ux:other.surface/foo!activate\`.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZC
`;
  const { diagnostics } = validateUxil(
    entriesOf({ "a.md": decl, "c.md": cite }),
  );
  assert(has(diagnostics, "UXIL-018"));
});

Deno.test("UXIL-019 citation of an unknown element", () => {
  const decl = `- [UXI_A_0001] A

  \`ux:home : screen\` offers:

  - \`/play : activate\` — play.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const cite = `- [FREQ_A_0001] Cite

  Pressing does \`ux:home/nonexistent!activate\`.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZC
`;
  const { diagnostics } = validateUxil(
    entriesOf({ "a.md": decl, "c.md": cite }),
  );
  assert(has(diagnostics, "UXIL-019"));
});

Deno.test("UXIL-020 verb not in element's declared set", () => {
  const decl = `- [UXI_A_0001] A

  \`ux:home : screen\` offers:

  - \`/play : activate\` — play.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const cite = `- [FREQ_A_0001] Cite

  Pressing does \`ux:home/play!toggle\`.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZC
`;
  const { diagnostics } = validateUxil(
    entriesOf({ "a.md": decl, "c.md": cite }),
  );
  assert(has(diagnostics, "UXIL-020"));
});

Deno.test("UXIL-021 undeclared state cited", () => {
  const decl = `- [UXI_A_0001] A

  \`ux:home : screen @ ready\` — only "ready" declared.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const cite = `- [FREQ_A_0001] Cite

  While \`ux:home@loading\` is shown.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZC
`;
  const { diagnostics } = validateUxil(
    entriesOf({ "a.md": decl, "c.md": cite }),
  );
  assert(has(diagnostics, "UXIL-021"));
});

Deno.test("UXIL-022 concrete key cited where a template is declared", () => {
  const decl = `- [UXI_A_0001] A

  \`ux:home : screen\` offers:

  - \`/favorite_toggle : toggle : {track_id}\` — marks a favourite.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const cite = `- [FREQ_A_0001] Cite

  Pressing does \`ux:home/favorite_toggle:abc123!toggle\`.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZC
`;
  const { diagnostics } = validateUxil(
    entriesOf({ "a.md": decl, "c.md": cite }),
  );
  assert(has(diagnostics, "UXIL-022"));
});

Deno.test("validateUxil: a clean citation resolves with no diagnostics", () => {
  const decl = `- [UXI_A_0001] A

  \`ux:home : screen @ ready\` offers:

  - \`/play : activate\` — play.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const cite = `- [FREQ_A_0001] Cite

  Pressing does \`ux:home@ready/play!activate\`.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZC
`;
  const { diagnostics } = validateUxil(
    entriesOf({ "a.md": decl, "c.md": cite }),
  );
  assertEquals(diagnostics, []);
});
