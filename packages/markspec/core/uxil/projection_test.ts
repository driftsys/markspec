import { assertEquals } from "@std/assert";
import { projectUxRegistry } from "./projection.ts";
import { buildUxRegistry } from "./registry.ts";
import { parseMarkdown } from "../parser/markdown.ts";
import type { Entry } from "../model/mod.ts";

function entriesOf(files: Record<string, string>): Entry[] {
  const out: Entry[] = [];
  for (const [f, md] of Object.entries(files)) {
    const { entries } = parseMarkdown(md, { file: f });
    out.push(...entries);
  }
  return out;
}

const MD = `- [UXI_A_0001] A

  \`ux:media.home : screen @ ready, loading\` offers:

  - \`/play : activate\` — play.
  - \`.confirm_dialog @ default\` — dialog.
    - \`/confirm : activate\` — confirm.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;

Deno.test("projectUxRegistry: sorted + deterministic", () => {
  const reg = buildUxRegistry(entriesOf({ "a.md": MD }));
  const p1 = projectUxRegistry(reg);
  const p2 = projectUxRegistry(reg);
  assertEquals(JSON.stringify(p1), JSON.stringify(p2)); // stable
  assertEquals(p1.surfaces.map((s) => s.id), [
    "media.home",
    "media.home.confirm_dialog",
  ]);
  const home = p1.surfaces[0];
  assertEquals(home.states, ["loading", "ready"]); // sorted
  assertEquals(home.parent, null);
  assertEquals(p1.surfaces[1].parent, "media.home");
});

Deno.test("projectUxRegistry: elements sorted by name; keyTemplate/nav/states shaped", () => {
  const md = `- [UXI_B_0001] B

  \`ux:panelb : screen\` offers:

  - \`/zzz : activate\` — z.
  - \`/aaa : toggle : {track_id}\` — a.
  - \`/nav : navigate -> panelb\` — n.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZB
`;
  const reg = buildUxRegistry(entriesOf({ "b.md": md }));
  const proj = projectUxRegistry(reg);
  const surface = proj.surfaces[0];
  assertEquals(surface.elements.map((e) => e.name), ["aaa", "nav", "zzz"]);
  const aaa = surface.elements.find((e) => e.name === "aaa")!;
  assertEquals(aaa.keyTemplate, "track_id");
  assertEquals(aaa.nav, null);
  const nav = surface.elements.find((e) => e.name === "nav")!;
  assertEquals(nav.keyTemplate, null);
  assertEquals(nav.nav, "panelb");
  const zzz = surface.elements.find((e) => e.name === "zzz")!;
  assertEquals(zzz.states, []);
});

Deno.test("projectUxRegistry: duplicated surface id uses only the first record", () => {
  const a = `- [UXI_C_0001] C1

  \`ux:dup : screen @ x\` — first.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZC
`;
  const b = `- [UXI_D_0001] C2

  \`ux:dup : panel @ y\` — second, different kind/states.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZD
`;
  const reg = buildUxRegistry(entriesOf({ "a.md": a, "b.md": b }));
  const proj = projectUxRegistry(reg);
  assertEquals(proj.surfaces.length, 1);
  assertEquals(proj.surfaces[0].kind, "screen"); // first wins
  assertEquals(proj.surfaces[0].states, ["x"]);
});

Deno.test("projectUxRegistry: empty registry yields an empty projection", () => {
  const reg = buildUxRegistry([]);
  assertEquals(projectUxRegistry(reg), { surfaces: [] });
});
