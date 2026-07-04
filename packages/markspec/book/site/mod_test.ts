import { assertStringIncludes } from "@std/assert";
import { renderChapterHtml } from "./mod.ts";

Deno.test("renderChapterHtml: rewrites a same-directory chapter link's .md extension to .html", () => {
  const md = `# Overview

See [Entry format](entry-format.md) for details.
`;
  const chapterSlugs = new Map([
    ["index.md", "index"],
    ["entry-format.md", "entry-format"],
  ]);
  const { html } = renderChapterHtml(md, { file: "index.md", chapterSlugs });
  assertStringIncludes(html, 'href="entry-format.html"');
});

Deno.test("renderChapterHtml: rewrites a parent-relative link from a nested chapter, preserving the fragment", () => {
  const md = `# Deploy

See [Profiles](../profiles.md#profile-specifiers).
`;
  const chapterSlugs = new Map([
    ["recipes/deploy.md", "recipes-deploy"],
    ["profiles.md", "profiles"],
  ]);
  const { html } = renderChapterHtml(md, {
    file: "recipes/deploy.md",
    chapterSlugs,
  });
  assertStringIncludes(html, 'href="profiles.html#profile-specifiers"');
});

Deno.test("renderChapterHtml: leaves a link to a path not in chapterSlugs untouched", () => {
  const md = `See [some external doc](../architecture/adr-030.md).`;
  const chapterSlugs = new Map([["index.md", "index"]]);
  const { html } = renderChapterHtml(md, { file: "index.md", chapterSlugs });
  assertStringIncludes(html, 'href="../architecture/adr-030.md"');
});

Deno.test("renderChapterHtml: leaves absolute/external URLs untouched", () => {
  const md = `See [GitHub](https://github.com/driftsys/markspec).`;
  const chapterSlugs = new Map([["index.md", "index"]]);
  const { html } = renderChapterHtml(md, { file: "index.md", chapterSlugs });
  assertStringIncludes(html, 'href="https://github.com/driftsys/markspec"');
});

Deno.test("renderChapterHtml: rewrites links inside entry bodies too", () => {
  const md = `- [STK_BRK_0001] Braking

  See [Entry format](entry-format.md) for the block grammar.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const chapterSlugs = new Map([
    ["index.md", "index"],
    ["entry-format.md", "entry-format"],
  ]);
  const { html } = renderChapterHtml(md, { file: "index.md", chapterSlugs });
  assertStringIncludes(html, 'href="entry-format.html"');
});

Deno.test("renderChapterHtml: without chapterSlugs option, links pass through unchanged", () => {
  const md = `See [Entry format](entry-format.md).`;
  const { html } = renderChapterHtml(md, { file: "index.md" });
  assertStringIncludes(html, 'href="entry-format.md"');
});

Deno.test("renderChapterHtml: rewrites a link with no leading directory reference from a nested chapter", () => {
  // A nested chapter linking to a sibling file in the SAME subdirectory
  // (no ../) must resolve relative to its own directory, not the book root.
  const md = `See [Sibling](sibling.md).`;
  const chapterSlugs = new Map([
    ["recipes/deploy.md", "recipes-deploy"],
    ["recipes/sibling.md", "recipes-sibling"],
  ]);
  const { html } = renderChapterHtml(md, {
    file: "recipes/deploy.md",
    chapterSlugs,
  });
  assertStringIncludes(html, 'href="recipes-sibling.html"');
});

Deno.test("renderChapterHtml: rewrites a query-string-free link exactly, ignoring trailing slashes in unrelated paths", () => {
  const md = `See [Types](types.md) and [unrelated](/absolute/path.md).`;
  const chapterSlugs = new Map([
    ["index.md", "index"],
    ["types.md", "types"],
  ]);
  const { html } = renderChapterHtml(md, { file: "index.md", chapterSlugs });
  assertStringIncludes(html, 'href="types.html"');
  assertStringIncludes(html, 'href="/absolute/path.md"');
});
