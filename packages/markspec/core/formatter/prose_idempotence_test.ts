/**
 * ADR-029 idempotency gate: format ∘ format === format over the whole
 * fixture corpus, with the REAL dprint-markdown plugin injected.
 * MSL-F010 (fmt drift in `check`) depends on this property — a
 * non-idempotent file would drift forever.
 */
import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl } from "@std/path";
import { format } from "./mod.ts";
import { loadMarkdownFormatter } from "./dprint.ts";

const FIXTURES = fromFileUrl(
  new URL("../../../../tests/fixtures/", import.meta.url),
);

Deno.test("ADR-029: format is idempotent over the fixture corpus", async () => {
  const proseFormat = await loadMarkdownFormatter();
  let count = 0;
  for await (const f of walk(FIXTURES, { exts: [".md"], includeDirs: false })) {
    const src = await Deno.readTextFile(f.path);
    const once = format(src, {
      file: f.path,
      formatMarkdownProse: proseFormat,
    });
    const twice = format(once.output, {
      file: f.path,
      formatMarkdownProse: proseFormat,
    });
    assertEquals(twice.output, once.output, `not idempotent: ${f.path}`);
    assertEquals(twice.changed, false, `changed=true on 2nd run: ${f.path}`);
    count++;
  }
  if (count === 0) throw new Error("no fixtures found — wrong path?");
});
