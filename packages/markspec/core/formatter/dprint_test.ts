import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  loadMarkdownFormatter,
  MARKSPEC_MARKDOWN_GLOBAL_CONFIG,
  MARKSPEC_MARKDOWN_PLUGIN_CONFIG,
} from "./dprint.ts";

Deno.test("MarkSpec markdown config: the exported style objects are frozen", () => {
  // The single canonical style is exported through the public barrel;
  // freezing stops a consumer from mutating it out from under the
  // already-instantiated formatter (#669).
  assertEquals(Object.isFrozen(MARKSPEC_MARKDOWN_GLOBAL_CONFIG), true);
  assertEquals(Object.isFrozen(MARKSPEC_MARKDOWN_PLUGIN_CONFIG), true);
});

Deno.test("loadMarkdownFormatter: wraps ragged prose at 80 columns", async () => {
  const fmt = await loadMarkdownFormatter();
  const input =
    "This is a very long line of prose that will certainly exceed the eighty column limit because it just keeps going and going.\n";
  const out = fmt(input);
  for (const line of out.split("\n")) {
    if (line.length > 80) {
      throw new Error(`line exceeds 80 cols: ${line}`);
    }
  }
  assertStringIncludes(out, "This is a very long line");
});

Deno.test("loadMarkdownFormatter: applies the fixed MarkSpec style", async () => {
  const fmt = await loadMarkdownFormatter();
  // emphasis → underscores, strong → asterisks, lists → dashes
  assertEquals(fmt("*em* and __strong__\n"), "_em_ and **strong**\n");
  assertEquals(fmt("* item one\n* item two\n"), "- item one\n- item two\n");
});

Deno.test("loadMarkdownFormatter: aligns tables and lets wide rows exceed 80", async () => {
  const fmt = await loadMarkdownFormatter();
  const out = fmt("| Mode | Longer heading |\n|--|--|\n| Fast | x |\n");
  assertStringIncludes(out, "| Mode | Longer heading |");
  assertStringIncludes(out, "| ---- | -------------- |");
});

Deno.test("loadMarkdownFormatter: caches — second call returns same instance fast", async () => {
  const a = await loadMarkdownFormatter();
  const b = await loadMarkdownFormatter();
  assertEquals(a === b, true);
});

Deno.test("loadMarkdownFormatter: per-call lineWidth override narrows the wrap", async () => {
  const fmt = await loadMarkdownFormatter();
  const input =
    "word word word word word word word word word word word word word word word word\n";
  const at80 = fmt(input);
  const at40 = fmt(input, { lineWidth: 40 });
  for (const line of at40.split("\n")) {
    if (line.length > 40) throw new Error(`line exceeds 40 cols: ${line}`);
  }
  if (at40.split("\n").length <= at80.split("\n").length) {
    throw new Error("narrower width should produce more lines");
  }
});
