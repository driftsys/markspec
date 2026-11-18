import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  loadMarkdownFormatter,
  MARKSPEC_MARKDOWN_GLOBAL_CONFIG,
  MARKSPEC_MARKDOWN_PLUGIN_CONFIG,
  withHiddenMarkdownFenceTags,
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

// ---------------------------------------------------------------------------
// `md` / `markdown` fences (#984)
// ---------------------------------------------------------------------------

const FENCE_CONTENT = "*  item one\n*  item two\n\nSome   text   here.";

for (
  const opener of [
    "```md",
    "```markdown",
    "~~~md",
    "~~~~Markdown",
    "``` MD title=x",
    "```markdown {.class}",
  ]
) {
  Deno.test(`loadMarkdownFormatter: keeps the content of a '${opener}' fence`, async () => {
    const fmt = await loadMarkdownFormatter();
    const close = opener.match(/^[`~]+/)![0];
    const fence = `${opener}\n${FENCE_CONTENT}\n${close}`;
    const input = `Para   one\nwrapped.\n\n${fence}\n\nPara   two.\n`;
    const out = fmt(input);
    // dprint may normalize the fence delimiters; the content stays.
    assertStringIncludes(out, `\n${FENCE_CONTENT}\n`);
    assertStringIncludes(out, "Para one wrapped.");
    assertStringIncludes(out, "Para two.");
  });
}

Deno.test("withHiddenMarkdownFenceTags: hides the tag from the inner formatter", () => {
  const seen: string[] = [];
  const wrapped = withHiddenMarkdownFenceTags((text) => {
    seen.push(text);
    return text;
  });
  const input =
    "> ```md\n> x\n> ```\n\n- ~~~markdown\n  y\n  ~~~\n\n```mdx\nz\n```";
  assertEquals(wrapped(input), input);
  assertEquals(seen[0].includes("```md\n"), false);
  assertEquals(seen[0].includes("~~~markdown"), false);
  assertStringIncludes(seen[0], "```mdx");
});

Deno.test("withHiddenMarkdownFenceTags: keeps placeholder text the author wrote", () => {
  const wrapped = withHiddenMarkdownFenceTags((text) => text);
  const input =
    "Text markspec-hidden-fence-tag-0-0 here.\n\n```md\nx\n```\n\n" +
    "```markspec-hidden-fence-tag-0-0\ny\n```";
  assertEquals(wrapped(input), input);
});

Deno.test("withHiddenMarkdownFenceTags: ignores a backtick paragraph with a backtick in its info", () => {
  const seen: string[] = [];
  const wrapped = withHiddenMarkdownFenceTags((text) => {
    seen.push(text);
    return text;
  });
  const input = "```md `x`\nnot a fence\n";
  assertEquals(wrapped(input), input);
  assertEquals(seen[0], input);
});

Deno.test("withHiddenMarkdownFenceTags: hides tags of fences nested in lists and quotes", () => {
  const seen: string[] = [];
  const wrapped = withHiddenMarkdownFenceTags((text) => {
    seen.push(text);
    return text;
  });
  const input =
    "> - item\n>\n>   ```md\n>   x\n>   ```\n\n1. a\n   - b\n\n     ~~~Markdown t\n     y\n     ~~~\n";
  assertEquals(wrapped(input), input);
  assertEquals(/```md|~~~Markdown/.test(seen[0]), false);
});

Deno.test("withHiddenMarkdownFenceTags: restores tags after an inner formatter rewrites the text", () => {
  const fences = Array.from(
    { length: 12 },
    (_, i) => `~~~${i % 2 ? "Markdown" : "md"} n=${i}\n*  c${i}\n~~~`,
  );
  const input = fences.join("\nsome\nwrapped\nprose\n") + "\n";
  // Rewrites `~~~` to backticks and joins the prose lines between fences.
  const inner = (text: string): string =>
    text.replace(/~~~/g, "```").replace(
      /\nsome\nwrapped\nprose\n/g,
      "\n\nsome wrapped prose\n\n",
    );
  const out = withHiddenMarkdownFenceTags(inner)(input);
  const expected = inner(input);
  assertEquals(out, expected);
  assertStringIncludes(out, "```Markdown n=11\n*  c11\n```");
});
