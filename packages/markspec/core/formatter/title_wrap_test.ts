import { assert, assertEquals } from "@std/assert";
import { format } from "./mod.ts";
import { loadMarkdownFormatter } from "./dprint.ts";
import { wrapEntryTitles } from "./title_wrap.ts";
import { parse } from "../parser/mod.ts";

const ID = "01HGW2Q8MNP3RSTVWXYZABCDEF";

function entry(title: string, indent = ""): string {
  return `${indent}- [SAD_DESK_0012] ${title}\n\n` +
    `${indent}  The backend shall answer HTTP status 404.\n\n` +
    `${indent}      Id: ${ID}\n`;
}

const LONG_TITLE =
  "Read endpoints for documents, rendered entries, and source text";

async function fmt(text: string, lineWidth?: number) {
  const formatMarkdownProse = await loadMarkdownFormatter();
  return format(text, { file: "doc.md", formatMarkdownProse, lineWidth });
}

Deno.test("title wrap: a title longer than the line width wraps", async () => {
  const result = await fmt(entry(LONG_TITLE));
  assertEquals(
    result.output,
    "- [SAD_DESK_0012] Read endpoints for documents, rendered entries, and source\n" +
      "  text\n\n" +
      "  The backend shall answer HTTP status 404.\n\n" +
      `      Id: ${ID}\n`,
  );
});

Deno.test("title wrap: a wrapped title is stable and unchanged", async () => {
  const once = (await fmt(entry(LONG_TITLE))).output;
  const twice = await fmt(once);
  assertEquals(twice.output, once);
  assertEquals(twice.changed, false);
});

Deno.test("title wrap: a short title stays on one line", async () => {
  const text = entry("Read endpoints");
  const result = await fmt(text);
  assertEquals(result.output, text);
  assertEquals(result.changed, false);
});

Deno.test("title wrap: the line width option is honored", async () => {
  const text = entry(LONG_TITLE);
  assertEquals((await fmt(text, 100)).output, text);
});

Deno.test("title wrap: the wrapped title parses to the same title", async () => {
  const out = (await fmt(entry(LONG_TITLE))).output;
  const [parsed] = parse(out);
  assertEquals(parsed.title, LONG_TITLE);
  assertEquals(parsed.id, ID);
});

Deno.test("title wrap: a missing Id is stamped below a wrapped title", async () => {
  const text = `- [SAD_DESK_0012] ${LONG_TITLE}\n\n  Body text.\n`;
  const out = (await fmt(text)).output;
  const lines = out.split("\n");
  assertEquals(lines[1], "  text");
  const [parsed] = parse(out);
  assertEquals(parsed.title, LONG_TITLE);
  assert(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(parsed.id ?? ""));
});

Deno.test("title wrap: a continuation is never indented as a trailer", async () => {
  const out = (await fmt(entry(LONG_TITLE, "  "))).output;
  for (const line of out.split("\n").slice(1, 2)) {
    assertEquals(line, "    text");
  }
  const [parsed] = parse(out);
  assertEquals(parsed.title, LONG_TITLE);
});

Deno.test("title wrap: without a prose formatter the title stays on one line", () => {
  const text = entry(LONG_TITLE);
  assertEquals(format(text, { file: "doc.md" }).output, text);
});

// --- Guards (review of #1050) ----------------------------------------------

const TITLE_LINE =
  "- [SAD_DESK_0012] Read endpoints for documents, rendered entries, and source text";

Deno.test("title wrap: a nested indent reduces the width budget", async () => {
  // At width 80 with a 2-column indent, `source` ends at column 78 and
  // `xyz` no longer fits on the first line.
  const out = (await fmt(entry(`${LONG_TITLE} xyz more`, "  "))).output;
  for (const line of out.split("\n")) assert([...line].length <= 80, line);
  assertEquals(out.split("\n")[1], "    text xyz more");
});

Deno.test("title wrap: a trailer-shaped continuation stays title text", async () => {
  const title = "Read endpoints for documents, rendered entries, and source " +
    "Satisfies: STK_0001";
  const once = await fmt(entry(title));
  const [parsed] = parse(once.output);
  assertEquals(parsed.title, title);
  assertEquals(parsed.rawAttributes.map((a) => a.key), ["Id"]);
  assertEquals((await fmt(once.output)).output, once.output);
});

Deno.test("title wrap: an emphasised title wraps like prim", async () => {
  const title =
    "Read *endpoints* for documents, rendered entries, and source text";
  const out = (await fmt(entry(title))).output;
  assertEquals(out.split("\n").slice(0, 2), [
    "- [SAD_DESK_0012] Read _endpoints_ for documents, rendered entries, and source",
    "  text",
  ]);
});

Deno.test("title wrap: a title in a dprint-ignore region is left alone", async () => {
  const text = "<!-- dprint-ignore-start -->\n\n" + entry(LONG_TITLE) +
    "\n<!-- dprint-ignore-end -->\n";
  assertEquals((await fmt(text)).output, text);
});

Deno.test("title wrap: an entry fmt leaves unchanged keeps its title", async () => {
  // An `id:` line (MSL-I009) excludes the entry from fmt.
  const text = `- [SAD_DESK_0012] ${LONG_TITLE}\n\n  Body.\n\n      id: x\n`;
  assertEquals((await fmt(text)).output.split("\n")[0], text.split("\n")[0]);
});

Deno.test("title wrap: an ordered entry continues at its content column", async () => {
  const text =
    `1. [SAD_DESK_0012] ${LONG_TITLE}\n\n   Body.\n\n       Id: ${ID}\n`;
  const out = (await fmt(text)).output;
  assertEquals(out.split("\n")[1], "   text");
});

Deno.test("wrapEntryTitles: a wrap with different content is rejected", () => {
  const result = wrapEntryTitles(
    [TITLE_LINE],
    [{ line: 0, column: 0 }],
    () => "- [SAD_DESK_0012] Read endpoints\n  changed words\n",
    80,
  );
  assertEquals(result.lines, [TITLE_LINE]);
  assertEquals(result.rejected, [0]);
});

Deno.test("wrapEntryTitles: a continuation at trailer indent is rejected", () => {
  const result = wrapEntryTitles(
    [TITLE_LINE],
    [{ line: 0, column: 0 }],
    () =>
      "- [SAD_DESK_0012] Read endpoints for documents, rendered entries, and\n" +
      "    source text\n",
    80,
  );
  assertEquals(result.lines, [TITLE_LINE]);
  assertEquals(result.rejected, [0]);
});

Deno.test("wrapEntryTitles: a throwing formatter keeps the title", () => {
  const result = wrapEntryTitles(
    [TITLE_LINE],
    [{ line: 0, column: 0 }],
    () => {
      throw new Error("boom");
    },
    80,
  );
  assertEquals(result.lines, [TITLE_LINE]);
});

Deno.test("title wrap: a rejected wrap reports MSL-F012", () => {
  const result = format(entry(LONG_TITLE), {
    file: "doc.md",
    formatMarkdownProse: (text) =>
      text.startsWith("- [") ? "- [SAD_DESK_0012] other\n  words\n" : text,
  });
  assert(result.diagnostics.some((d) => d.code === "MSL-F012"));
});
