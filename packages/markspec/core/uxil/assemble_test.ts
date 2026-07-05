import { assert, assertEquals } from "@std/assert";
import { assembleUxSurface } from "./assemble.ts";
import type { Entry } from "../model/mod.ts";
import { parseMarkdown } from "../parser/markdown.ts";

// Helper: parse a markdown fixture into its single Entry. uxil reads
// bodyAst/bodyTokens/bodyStartLine, which parseMarkdown fills. This matches
// the typl fixture convention (typl/assemble_test.ts uses the synchronous
// parseMarkdown, not the async parseFile).
function entryOf(md: string): Entry {
  const { entries } = parseMarkdown(md, { file: "spec.md" });
  return entries[0];
}

const MEDIA = `- [UXI_MEDIA_0001] Media home surface

  The media home screen (\`ux:media.home : screen @ loading, ready\`) offers
  playback control.

  - \`/play : activate\` — starts playback.
  - \`/favorite_toggle : toggle : {track_id}\` — marks a track favourite.
  - \`.confirm_dialog @ default\` — delete confirmation dialog.
    - \`/confirm : activate\` — confirms the deletion.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZZ
`;

Deno.test("assembleUxSurface: root + elements + child surface", () => {
  const tree = assembleUxSurface(entryOf(MEDIA));
  assertEquals(tree.diagnostics, []);
  const paths = tree.surfaces.map((s) => s.path).sort();
  assertEquals(paths, ["media.home", "media.home.confirm_dialog"]);

  const home = tree.surfaces.find((s) => s.path === "media.home")!;
  assertEquals(home.kind, "screen");
  assertEquals(home.states, ["loading", "ready"]);
  assertEquals(home.elements.map((e) => e.name).sort(), [
    "favorite_toggle",
    "play",
  ]);
  assertEquals(
    home.elements.find((e) => e.name === "favorite_toggle")?.keyTemplate,
    { kind: "template", name: "track_id" },
  );
  assertEquals(home.location.file, "spec.md");

  const dialog = tree.surfaces.find((s) =>
    s.path === "media.home.confirm_dialog"
  )!;
  assertEquals(dialog.kind, "screen"); // inherited from root
  assertEquals(dialog.states, ["default"]);
  assertEquals(dialog.elements.map((e) => e.name), ["confirm"]);
});

Deno.test("assembleUxSurface: multiple roots -> UXIL-012, first wins", () => {
  const md = `- [UXI_X_0001] Two roots

  \`ux:a.one : screen\` and also \`ux:a.two : screen\`.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZZ
`;
  const tree = assembleUxSurface(entryOf(md));
  assert(tree.diagnostics.some((d) => d.code === "UXIL-012"));
  assert(tree.surfaces.some((s) => s.path === "a.one"));
  assert(!tree.surfaces.some((s) => s.path === "a.two"));
});

Deno.test("assembleUxSurface: no root but declarations present -> UXIL-011, nothing registered", () => {
  const md = `- [UXI_Y_0001] No root

  Just some prose with an element bullet:

  - \`/play : activate\` — starts playback.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZZ
`;
  const tree = assembleUxSurface(entryOf(md));
  assert(tree.diagnostics.some((d) => d.code === "UXIL-011"));
  assertEquals(tree.surfaces, []);
});

Deno.test("assembleUxSurface: entry with no uxil content at all -> no diagnostics, no surfaces", () => {
  const md = `- [UXI_Z_0001] Plain entry

  Nothing uxil-shaped here.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZZ
`;
  const tree = assembleUxSurface(entryOf(md));
  assertEquals(tree.diagnostics, []);
  assertEquals(tree.surfaces, []);
});

Deno.test("assembleUxSurface: malformed root span reports its own diagnostic, not a redundant UXIL-011", () => {
  const md = `- [UXI_W_0001] Bad root

  A malformed root: \`ux:a.b :\`.

  - \`/play : activate\` — starts playback.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZZ
`;
  const tree = assembleUxSurface(entryOf(md));
  assert(tree.diagnostics.some((d) => d.code === "UXIL-004"));
  assert(!tree.diagnostics.some((d) => d.code === "UXIL-011"));
});
