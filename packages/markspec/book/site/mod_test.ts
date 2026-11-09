import { assertEquals, assertStringIncludes } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { spy } from "@std/testing/mock";
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

for (
  const token of [
    "docs/SYS_A/notes.md",
    "/tmp/SYS_A",
    "s3://bucket/SYS_A",
    "SYS_A/SYS_B",
    "/SYS_A",
    "SYS_A/",
    "SYS_A//SYS_A",
  ]
) {
  Deno.test(`renderChapterHtml: leaves ${token} unlinked when only SYS_A is known`, () => {
    const { html } = renderChapterHtml(`See ${token}.`, {
      knownDisplayIds: new Set(["SYS_A"]),
    });
    assertEquals(html, `<p>See ${token}.</p>`);
  });
}

for (const id of ["A", "AB"]) {
  Deno.test(`renderChapterHtml: links the short known ID ${id}`, () => {
    const { html } = renderChapterHtml(`See (${id}), then ${id}.`, {
      knownDisplayIds: new Set([id]),
    });
    const span = `<span class="cross-ref" data-display-id="${id}">${id}</span>`;
    assertEquals(html, `<p>See (${span}), then ${span}.</p>`);
  });
}

Deno.test("renderChapterHtml: slash-separated known IDs each become a cross-ref", () => {
  const { html } = renderChapterHtml("See SYS_A/SYS_B.", {
    knownDisplayIds: new Set(["SYS_A", "SYS_B"]),
  });
  assertEquals(
    html,
    '<p>See <span class="cross-ref" data-display-id="SYS_A">SYS_A</span>/<span class="cross-ref" data-display-id="SYS_B">SYS_B</span>.</p>',
  );
});

for (const shorterIdKnown of [false, true]) {
  Deno.test(`renderChapterHtml: preserves a period in a known slash segment when REQ is ${shorterIdKnown ? "known" : "unknown"}`, () => {
    const knownDisplayIds = new Set(["SYS_A", "REQ."]);
    if (shorterIdKnown) knownDisplayIds.add("REQ");
    const { html } = renderChapterHtml("See SYS_A/REQ.", {
      knownDisplayIds,
    });
    assertEquals(
      html,
      '<p>See <span class="cross-ref" data-display-id="SYS_A">SYS_A</span>/<span class="cross-ref" data-display-id="REQ.">REQ.</span></p>',
    );
  });
}

Deno.test("renderChapterHtml: an exact known slash ID with an empty segment takes precedence", () => {
  const { html } = renderChapterHtml("See SYS_A//SYS_B.", {
    knownDisplayIds: new Set(["SYS_A", "SYS_B", "SYS_A//SYS_B"]),
  });
  assertEquals(
    html,
    '<p>See <span class="cross-ref" data-display-id="SYS_A//SYS_B">SYS_A//SYS_B</span>.</p>',
  );
});

Deno.test("renderChapterHtml: an exact known slash ID takes precedence over its parts", () => {
  const { html } = renderChapterHtml("See SYS_A/SYS_B.", {
    knownDisplayIds: new Set(["SYS_A", "SYS_B", "SYS_A/SYS_B"]),
  });
  assertEquals(
    html,
    '<p>See <span class="cross-ref" data-display-id="SYS_A/SYS_B">SYS_A/SYS_B</span>.</p>',
  );
});

for (const id of ["REQ_", "REQ-", "REQ.", "REQ/", "REQ.part-_"]) {
  Deno.test(`renderChapterHtml: links known ${id} including its trailing ID characters`, () => {
    const literalId = id.replaceAll("_", "\\_");
    const { html } = renderChapterHtml(
      `See (${literalId}), then ${literalId}.`,
      {
        knownDisplayIds: new Set([id]),
      },
    );
    const span = `<span class="cross-ref" data-display-id="${id}">${id}</span>`;
    assertEquals(html, `<p>See (${span}), then ${span}.</p>`);
  });
}

Deno.test("renderChapterHtml: an exact known dotted ID takes precedence over a shorter ID", () => {
  const { html } = renderChapterHtml("See (REQ.).", {
    knownDisplayIds: new Set(["REQ", "REQ."]),
  });
  assertEquals(
    html,
    '<p>See (<span class="cross-ref" data-display-id="REQ.">REQ.</span>).</p>',
  );
});

Deno.test("renderChapterHtml: does not link fragments of unknown tokens", () => {
  const { html } = renderChapterHtml(
    "SYS_A.extra SYS_A_ SYS_A- _SYS_A -SYS_A .SYS_A (SYS_A), SYS_A!",
    { knownDisplayIds: new Set(["SYS_A"]) },
  );
  const span = '<span class="cross-ref" data-display-id="SYS_A">SYS_A</span>';
  assertEquals(
    html,
    `<p>SYS_A.extra SYS_A_ SYS_A- _SYS_A -SYS_A .SYS_A (${span}), ${span}!</p>`,
  );
});

Deno.test("renderChapterHtml: leaves slash-separated and trailing IDs inside code unlinked", () => {
  const { html } = renderChapterHtml(
    "`SYS_A/SYS_B REQ_ REQ- REQ.`\n\n```text\nSYS_A/SYS_B REQ_ REQ- REQ.\n```",
    { knownDisplayIds: new Set(["SYS_A", "SYS_B", "REQ_", "REQ-", "REQ."]) },
  );
  assertEquals(html.includes("cross-ref"), false);
  assertStringIncludes(html, "<code>SYS_A/SYS_B REQ_ REQ- REQ.</code>");
  assertStringIncludes(
    html,
    '<pre><code class="language-text">SYS_A/SYS_B REQ_ REQ- REQ.\n</code></pre>',
  );
});

Deno.test("renderChapterHtml: attribute values use the same ID boundaries as prose", () => {
  const { html } = renderChapterHtml(
    "- [REQ_001] Title\n\n      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n      Rationale: SYS_A/SYS_B REQ_ REQ- REQ..",
    { knownDisplayIds: new Set(["SYS_A", "SYS_B", "REQ_", "REQ-", "REQ."]) },
  );
  const spans = ["SYS_A", "SYS_B", "REQ_", "REQ-", "REQ."].map((id) =>
    `<span class="cross-ref" data-display-id="${id}">${id}</span>`
  );
  assertStringIncludes(
    html,
    `<code>${spans[0]}/${spans.slice(1).join(" ")}.</code>`,
  );
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

Deno.test("renderChapterHtml: escapes markup in an attribute value with a known ID", () => {
  const md = `- [SRS_BRK_0001] Sensor debouncing

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Satisfies: SYS_BRK_0003 <b>x</b>
      Rationale: SYS_BRK_0003 <b>x</b>
`;
  const { html } = renderChapterHtml(md, {
    file: "a.md",
    knownDisplayIds: KNOWN,
  });
  assertStringIncludes(html, "&lt;b&gt;");
  assertEquals(html.includes("<b>"), false);
  assertStringIncludes(html, 'data-display-id="SYS_BRK_0003"');
});

const RAW_HTML_PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
];

Deno.test("renderChapterHtml: never passes raw HTML from prose or an entry body through", () => {
  for (const payload of RAW_HTML_PAYLOADS) {
    const md = `# Title

Prose ${payload} here.

${payload}

- [SRS_BRK_0001] Sensor debouncing

  Body ${payload} text.

  ${payload}

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
    const { html } = renderChapterHtml(md, {
      file: "a.md",
      knownDisplayIds: KNOWN,
    });
    assertEquals(html.includes(payload), false, payload);
    assertEquals(html.includes("<script"), false, payload);
    assertEquals(html.includes("<img"), false, payload);
  }
});

Deno.test("renderEntryHtml: never passes raw HTML from an entry body through", () => {
  for (const payload of RAW_HTML_PAYLOADS) {
    const md = `- [SRS_BRK_0001] Sensor debouncing

  Body ${payload} text.

  ${payload}

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
    const [entry] = parse(md, { file: "a.md" });
    const html = renderEntryHtml(entry, { knownDisplayIds: KNOWN });
    assertEquals(html.includes(payload), false, payload);
    assertEquals(html.includes("<script"), false, payload);
    assertEquals(html.includes("<img"), false, payload);
  }
});

Deno.test("renderChapterHtml: a known ID in link text or a fenced block is not a cross-ref", () => {
  const md = `See [SYS_BRK_0003](x.md).

\`\`\`text
SYS_BRK_0003
\`\`\`
`;
  const { html } = renderChapterHtml(md, {
    file: "a.md",
    knownDisplayIds: KNOWN,
  });
  assertEquals(html.includes("cross-ref"), false);
  assertStringIncludes(html, ">SYS_BRK_0003</a>");
});

Deno.test("renderChapterHtml: duplicate display IDs keep only the first anchor", () => {
  const { html } = renderChapterHtml(
    "- [X_0001] First\n\n  First body.\n\n- [X_0001] Second\n\n  Second body.\n\n- [X_0002] Third\n\n  Third body.\n",
  );
  assertEquals(html.split('id="entry-X_0001"').length - 1, 1);
  assertEquals(html.split('data-display-id="X_0001"').length - 1, 2);
  assertEquals(html.split('id="entry-X_0002"').length - 1, 1);
  assertStringIncludes(
    html,
    'id="entry-X_0001" data-display-id="X_0001">\n  <div class="req-title">\n    <code class="req-id">X_0001</code>\n    <span class="req-name">First</span>',
  );
});

Deno.test("renderChapterHtml: chapter link processors are never cached", () => {
  const knownDisplayIds = new Set(["X_0001"]);
  const chapterSlugs = new Map([
    ["one/target.md", "one-target"],
    ["two/target.md", "two-target"],
  ]);
  const cacheWrites = spy(WeakMap.prototype, "set");
  try {
    for (const folder of ["one", "two"]) {
      const { html } = renderChapterHtml("See [Target](target.md).", {
        file: `${folder}/index.md`,
        chapterSlugs,
        knownDisplayIds,
      });
      assertStringIncludes(html, `href="${folder}-target.html"`);
    }
    assertEquals(
      cacheWrites.calls.filter((call) => call.args[0] === knownDisplayIds)
        .length,
      0,
    );
  } finally {
    cacheWrites.restore();
  }
});

Deno.test("renderEntryHtml: reuses the chapter prose processor for the same known-ID set", () => {
  const knownDisplayIds = new Set(["X_0001"]);
  // Observe the cached processor without exporting it from the renderer.
  const cacheWrites = spy(WeakMap.prototype, "set");
  try {
    renderChapterHtml("See X_0001.", { knownDisplayIds });
    const writes = cacheWrites.calls.filter((call) =>
      call.args[0] === knownDisplayIds
    );
    assertEquals(writes.length, 1);
    const processor = writes[0].args[1] as {
      processSync(markdown: string): { toString(): string };
    };
    const process = spy(processor, "processSync");
    try {
      const [entry] = parse("- [X_0002] Child\n\n  See X_0001.\n");
      const html = renderEntryHtml(entry, { knownDisplayIds });
      assertStringIncludes(
        html,
        '<span class="cross-ref" data-display-id="X_0001">X_0001</span>',
      );
      assertEquals(process.calls.length, 1);
    } finally {
      process.restore();
    }
  } finally {
    cacheWrites.restore();
  }
});

Deno.test("renderChapterHtml: multi-value Satisfies links each known ID", () => {
  const { html } = renderChapterHtml(
    "- [X_0001] Child\n\n      Satisfies: A_0001, A_0002\n",
    { knownDisplayIds: new Set(["A_0001", "A_0002"]) },
  );
  for (const id of ["A_0001", "A_0002"]) {
    assertStringIncludes(
      html,
      `<span class="cross-ref" data-display-id="${id}">${id}</span>`,
    );
  }
});
