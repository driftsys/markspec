import { assert, assertEquals } from "@std/assert";
import { buildUxRegistry } from "./registry.ts";
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

Deno.test("buildUxRegistry: aggregates surfaces across entries; keeps duplicates", () => {
  const a = `- [UXI_A_0001] A

  \`ux:media.home : screen\` offers:

  - \`/play : activate\` — play.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const b = `- [UXI_B_0001] B (duplicate surface)

  \`ux:media.home : screen\` again.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZB
`;
  const reg = buildUxRegistry(entriesOf({ "a.md": a, "b.md": b }));
  assertEquals(reg.surfaces.get("media.home")?.length, 2); // both kept
  assert(
    reg.surfaces.get("media.home")?.[0].elements.some((e) => e.name === "play"),
  );
  assertEquals(
    reg.surfaces.get("media.home")?.[0].owningEntryDisplayId,
    "UXI_A_0001",
  );
  assertEquals(reg.surfaces.get("media.home")?.[0].owningEntryFile, "a.md");
  assertEquals(
    reg.surfaces.get("media.home")?.[1].owningEntryDisplayId,
    "UXI_B_0001",
  );
});

Deno.test("buildUxRegistry: entry with no uxil content contributes nothing", () => {
  const md = `- [UXI_C_0001] Plain

  No uxil here.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZC
`;
  const reg = buildUxRegistry(entriesOf({ "c.md": md }));
  assertEquals(reg.surfaces.size, 0);
});
