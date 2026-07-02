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

/**
 * Genuinely non-canonical documents, held in-memory: every committed
 * fixture under tests/fixtures/ must already be dprint-canonical (the
 * repo's own dprint gate formats that directory), so an on-disk fixture
 * can never carry ragged input. These exercise the reflow-then-stabilize
 * property the corpus test cannot.
 */
const RAW_DOCUMENTS: Record<string, string> = {
  "ragged-prose.md":
    "# Overview\n\nThis introductory chapter line is deliberately written to be far longer than the eighty column limit so the wrap pass genuinely has reflow work to do on the first run.\n",
  "misaligned-table.md":
    "| Mode | Longer heading |\n|--|--|\n| Fast | x |\n| Safe | a much longer cell value |\n",
  "entry-with-ragged-body.md":
    "- [STK_9002] Raw body entry\n\n  The system shall demonstrate a deliberately very ragged body paragraph that exceeds the eighty column limit so the body polish pass must reflow it.\n\n  | Key | Value |\n  |--|--|\n  | a | 1 |\n\n      Id: 01JADYKACKQKGVGHT9K7Y6PBPC\n",
};

Deno.test("ADR-029: raw non-canonical input reflows then stabilizes (in-memory)", async () => {
  const proseFormat = await loadMarkdownFormatter();
  for (const [name, src] of Object.entries(RAW_DOCUMENTS)) {
    const once = format(src, { file: name, formatMarkdownProse: proseFormat });
    if (!once.changed) {
      throw new Error(
        `expected first pass to reformat ${name} — raw input was already canonical`,
      );
    }
    const twice = format(once.output, {
      file: name,
      formatMarkdownProse: proseFormat,
    });
    assertEquals(twice.output, once.output, `not idempotent: ${name}`);
    assertEquals(twice.changed, false, `changed=true on 2nd run: ${name}`);
  }
});
