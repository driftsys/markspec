import { assertEquals, assertStringIncludes } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { parse } from "../../core/mod.ts";
import { renderChapterHtml, renderEntryHtml } from "./mod.ts";

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

Deno.test("renderChapterHtml: rewrites reference-style links ([text][id] + [id]: target)", () => {
  const md = `See [Entry format][ef] for details.

[ef]: entry-format.md
`;
  const chapterSlugs = new Map([
    ["index.md", "index"],
    ["entry-format.md", "entry-format"],
  ]);
  const { html } = renderChapterHtml(md, { file: "index.md", chapterSlugs });
  assertStringIncludes(html, 'href="entry-format.html"');
});

const ANCHOR_FIXTURE = `# Braking

Intro mentions SYS_BRK_0003 in prose.

- [SRS_BRK_0001] Sensor debouncing

  The driver shall debounce inputs, see SYS_BRK_0003.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Satisfies: SYS_BRK_0003
      Labels: ASIL-B
`;

const KNOWN = new Set(["SYS_BRK_0003"]);

Deno.test("renderChapterHtml: entry block carries id and data-display-id", () => {
  const { html } = renderChapterHtml(ANCHOR_FIXTURE, { file: "a.md" });
  assertStringIncludes(html, 'id="entry-SRS_BRK_0001"');
  assertStringIncludes(html, 'data-display-id="SRS_BRK_0001"');
});

Deno.test("renderChapterHtml: trace value in knownDisplayIds becomes a cross-ref", () => {
  const { html } = renderChapterHtml(ANCHOR_FIXTURE, {
    file: "a.md",
    knownDisplayIds: KNOWN,
  });
  assertStringIncludes(
    html,
    '<code><span class="cross-ref" data-display-id="SYS_BRK_0003">SYS_BRK_0003</span></code>',
  );
});

Deno.test("renderChapterHtml: unknown trace value stays plain", () => {
  const { html } = renderChapterHtml(ANCHOR_FIXTURE, {
    file: "a.md",
    knownDisplayIds: new Set(),
  });
  assertEquals(html.includes("cross-ref"), false);
  assertStringIncludes(html, "Satisfies: <code>SYS_BRK_0003</code>");
});

Deno.test("renderChapterHtml: known ID in prose becomes a cross-ref, not inside code", () => {
  const md = "See SYS_BRK_0003 and `SYS_BRK_0003`.\n";
  const { html } = renderChapterHtml(md, {
    file: "a.md",
    knownDisplayIds: KNOWN,
  });
  assertEquals(html.split('class="cross-ref"').length - 1, 1);
  assertStringIncludes(html, "<code>SYS_BRK_0003</code>");
});

Deno.test("renderChapterHtml: known ID before sentence punctuation becomes a cross-ref", () => {
  const md = "See SYS_BRK_0003.\n";
  const { html } = renderChapterHtml(md, {
    file: "a.md",
    knownDisplayIds: KNOWN,
  });
  assertStringIncludes(
    html,
    '<span class="cross-ref" data-display-id="SYS_BRK_0003">SYS_BRK_0003</span>.',
  );
});

Deno.test("renderChapterHtml: known ID is matched as a whole token only", () => {
  const md = "See SYS_BRK_00031 and XSYS_BRK_0003.\n";
  const { html } = renderChapterHtml(md, {
    file: "a.md",
    knownDisplayIds: KNOWN,
  });
  assertEquals(html.includes("cross-ref"), false);
});

Deno.test("renderChapterHtml: without knownDisplayIds only anchors are added", async (t) => {
  const { html } = renderChapterHtml(ANCHOR_FIXTURE, { file: "a.md" });
  await assertSnapshot(t, html);
});

Deno.test("renderEntryHtml: renders one entry like the chapter renderer", () => {
  const md = `- [SRS_BRK_0001] Sensor debouncing

  The driver shall debounce inputs, see SYS_BRK_0003.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Satisfies: SYS_BRK_0003
`;
  const options = { knownDisplayIds: KNOWN };
  const { html } = renderChapterHtml(md, { file: "a.md", ...options });
  const [entry] = parse(md, { file: "a.md" });
  assertEquals(renderEntryHtml(entry, options), html);
});
