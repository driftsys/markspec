import { assert, assertEquals } from "@std/assert";
import { format } from "./mod.ts";
import { loadMarkdownFormatter } from "./dprint.ts";
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
