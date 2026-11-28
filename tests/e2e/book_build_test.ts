/**
 * @module tests/e2e/book_build_test
 *
 * E2E tests for `markspec book build` subcommand.
 *
 * Verifies that the HTML renderer emits correct MarkSpec CSS classes for
 * entry blocks, pills, and alerts (closes #182).
 */

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "@std/assert";
import { fromFileUrl, toFileUrl } from "@std/path";
import { markspec, markspecInDir, markspecPersist } from "./helpers.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────

const PROJECT_YAML = `name: io.test.book\nversion: "1.0.0"\n`;

const SUMMARY_MD = `# Summary

- [Requirements](requirements.md)
- [Specs](specs.md)
`;

/** Chapter with all three entry categories (req/spec/test) plus a GFM alert. */
const REQUIREMENTS_MD = `# Requirements

- [STK_BRK_0001] Stakeholder requirement

  Braking system shall stop the vehicle within 3 seconds.

      Id: STK_01HGW2Q8MNP3
      Labels: ASIL-B, Safety

- [SRS_BRK_0001] Sensor input debouncing

  The sensor driver shall debounce raw inputs.

      Id: SRS_01HGW2R9QLP4
      Satisfies: STK_BRK_0001
      Labels: ASIL-B

> [!WARNING]
> Failure to debounce may lead to spurious brake activation.
`;

/** Chapter with ARC entries (spec category) and a figure caption. */
const SPECS_MD = `# Architecture Specs

- [ARC_BRK_0001] Braking ECU interface

  The braking ECU shall expose a CAN bus interface.

      Id: ARC_01HGW2S0ABC5
      Satisfies: STK_BRK_0001

![Braking ECU interface diagram](arch.png)

*Figure: Braking ECU interface diagram.*
`;

const FIXTURE = {
  "project.yaml": PROJECT_YAML,
  "SUMMARY.md": SUMMARY_MD,
  "requirements.md": REQUIREMENTS_MD,
  "specs.md": SPECS_MD,
};

// ── Tests ──────────────────────────────────────────────────────────────────

Deno.test("book build: exits 0 and writes HTML files", async () => {
  const { code, stderr } = await markspec(["book", "build"], {
    files: FIXTURE,
  });
  assertEquals(code, 0, `expected exit 0, stderr: ${stderr}`);
  assertStringIncludes(stderr, "wrote");
  assertStringIncludes(stderr, "index.html");
});

Deno.test("book build: identified entry without profile gets hue-blue fallback", async () => {
  const dir = await Deno.makeTempDir();
  try {
    for (const [name, content] of Object.entries(FIXTURE)) {
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        fromFileUrl(
          new URL("../../packages/markspec/main.ts", import.meta.url),
        ),
        "book",
        "build",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    });
    await cmd.output();

    const html = await Deno.readTextFile(`${dir}/_site/requirements.html`);
    // Identified entries with no profile loaded fall back to palette blue;
    // referenced entries would get .uncolored. The fixture has no profile.
    assertStringIncludes(html, 'class="req-block hue-blue"');
    assertStringIncludes(html, "STK_BRK_0001");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("book build: prefix heuristic is gone — ARC entries do NOT auto-color spec", async () => {
  // Regression test for the V-model prefix removal. Pre-PR-#257, ARC_*
  // display IDs auto-mapped to data-entry-type="spec". Now color must come
  // from the active profile's per-type binding; without a profile, every
  // identified entry falls back to palette blue.
  const dir = await Deno.makeTempDir();
  try {
    for (const [name, content] of Object.entries(FIXTURE)) {
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        fromFileUrl(
          new URL("../../packages/markspec/main.ts", import.meta.url),
        ),
        "book",
        "build",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    });
    await cmd.output();

    const html = await Deno.readTextFile(`${dir}/_site/specs.html`);
    assertStringIncludes(html, 'class="req-block hue-blue"');
    assertStringIncludes(html, "ARC_BRK_0001");
    if (html.includes("data-entry-type") || html.includes("hue-spec")) {
      throw new Error(
        "legacy data-entry-type or 'hue-spec' class still present in book HTML",
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("book build: emits pill elements for Labels", async () => {
  const dir = await Deno.makeTempDir();
  try {
    for (const [name, content] of Object.entries(FIXTURE)) {
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        fromFileUrl(
          new URL("../../packages/markspec/main.ts", import.meta.url),
        ),
        "book",
        "build",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    });
    await cmd.output();

    const html = await Deno.readTextFile(`${dir}/_site/requirements.html`);
    assertStringIncludes(html, 'class="pill"');
    assertStringIncludes(html, "ASIL-B");
    assertStringIncludes(html, "Safety");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("book build: emits alert div for GFM [!WARNING] alert", async () => {
  const dir = await Deno.makeTempDir();
  try {
    for (const [name, content] of Object.entries(FIXTURE)) {
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        fromFileUrl(
          new URL("../../packages/markspec/main.ts", import.meta.url),
        ),
        "book",
        "build",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    });
    await cmd.output();

    const html = await Deno.readTextFile(`${dir}/_site/requirements.html`);
    assertStringIncludes(html, 'class="alert warning"');
    assertStringIncludes(html, "Failure to debounce");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("book build: emits caption paragraph for Figure caption", async () => {
  const dir = await Deno.makeTempDir();
  try {
    for (const [name, content] of Object.entries(FIXTURE)) {
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        fromFileUrl(
          new URL("../../packages/markspec/main.ts", import.meta.url),
        ),
        "book",
        "build",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    });
    await cmd.output();

    const html = await Deno.readTextFile(`${dir}/_site/specs.html`);
    assertStringIncludes(html, 'class="caption"');
    assertStringIncludes(html, "Figure 1:");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("book build: renders images followed by their numbered captions", async () => {
  const { code, stderr, dir } = await markspecPersist(["book", "build"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "SUMMARY.md": "- [Figures](figures.md)\n",
      "figures.md": `![Alt & fallback](https://example.com/first.svg
"Overview")

![Alt only](https://example.com/second.svg)

_Figure: An explicit
caption._

![](/plain.svg)

![Ordinary](//example.com/third.svg)

*Ordinary emphasis.*
`,
    },
  });
  try {
    assertEquals(code, 0, stderr);
    const html = await Deno.readTextFile(`${dir}/_site/figures.html`);
    assertMatch(
      html,
      /<img src="https:\/\/example\.com\/first\.svg" alt="Alt &#x26; fallback" title="Overview"><\/p>\s*<p class="caption">Figure 1: Alt &amp; fallback<\/p>/,
    );
    assertMatch(
      html,
      /<img src="https:\/\/example\.com\/second\.svg" alt="Alt only"><\/p>\s*<p class="caption">Figure 2: An explicit\s+caption\.<\/p>/,
    );
    assertStringIncludes(html, '<img src="/plain.svg" alt="">');
    assertMatch(
      html,
      /<img src="\/\/example\.com\/third\.svg" alt="Ordinary"><\/p>\s*<p class="caption">Figure 3: Ordinary<\/p>/,
    );
    assertStringIncludes(html, "<em>Ordinary emphasis.</em>");
    assertEquals(html.includes("<em>Figure:"), false);
    assertEquals(html.match(/class="caption"/g)?.length, 3);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("book build: each chapter image URL resolves to its own copied asset", async () => {
  const westDiagram =
    '<svg xmlns="http://www.w3.org/2000/svg"><desc>West</desc></svg>';
  const eastDiagram =
    '<svg xmlns="http://www.w3.org/2000/svg"><desc>East</desc></svg>';
  const sharedDiagram =
    '<svg xmlns="http://www.w3.org/2000/svg"><desc>Shared</desc></svg>';
  const { code, stderr, dir } = await markspecPersist(
    ["book", "build", "--output", "build/output"],
    {
      files: {
        "project.yaml": PROJECT_YAML,
        "SUMMARY.md":
          "- [West](west/overview.md)\n- [East](east/overview.md)\n",
        "west/overview.md": "![West](./media/diagram.svg)\n",
        "west/media/diagram.svg": westDiagram,
        "east/overview.md": `![East](media/diagram.svg)

See this ![Shared](../shared%20diagram.svg?scale=1&mode=night#layer) in detail.

![Embedded](data:image/png;base64,YQ==)
`,
        "east/media/diagram.svg": eastDiagram,
        "shared diagram.svg": sharedDiagram,
      },
    },
  );
  try {
    assertEquals(code, 0, stderr);
    const site = `${dir}/build/output`;
    for (
      const [chapter, alt, diagram] of [
        ["west-overview.html", "West", westDiagram],
        ["east-overview.html", "East", eastDiagram],
        ["east-overview.html", "Shared", sharedDiagram],
      ]
    ) {
      const page = toFileUrl(`${site}/${chapter}`);
      const html = await Deno.readTextFile(page);
      const src = html.match(new RegExp(`<img src="([^"]+)" alt="${alt}"`))
        ?.[1];
      assert(src, `missing image ${alt} in ${chapter}`);
      assert(!src.startsWith("/"), "expected a relocatable image URL");
      const url = new URL(src.replaceAll("&#x26;", "&"), page);
      assertStringIncludes(url.pathname, "/build/output/");
      assertEquals(await Deno.readTextFile(fromFileUrl(url)), diagram);
      if (alt === "Shared") {
        assertEquals(url.search, "?scale=1&mode=night");
        assertEquals(url.hash, "#layer");
        assertStringIncludes(
          html,
          '<img src="data:image/png;base64,YQ==" alt="Embedded">',
        );
      }
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("book build: leaves unavailable and outside-project image URLs in place", async () => {
  const { code, stderr, dir } = await markspecPersist(["book", "build"], {
    cwd: "project",
    files: {
      "private.svg": "<svg/>",
      "project/project.yaml": PROJECT_YAML,
      "project/SUMMARY.md": "- [Figures](figures.md)\n",
      "project/figures.md":
        "![Missing](missing.svg)\n\n![Outside](%2e%2e/private.svg)\n",
    },
  });
  try {
    assertEquals(code, 0, stderr);
    const site = `${dir}/project/_site`;
    const html = await Deno.readTextFile(`${site}/figures.html`);
    assertStringIncludes(html, '<img src="missing.svg" alt="Missing">');
    assertStringIncludes(html, '<img src="%2e%2e/private.svg" alt="Outside">');
    assertStringIncludes(stderr, "missing.svg");
    assertStringIncludes(stderr, "outside the project");
    const files = [];
    for await (const file of Deno.readDir(site)) files.push(file.name);
    assertEquals(files.sort(), ["figures.html", "index.html"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  name:
    "book build: warns about an unreadable image and still writes the chapter",
  ignore: Deno.build.os === "windows",
  async fn() {
    const dir = await Deno.makeTempDir();
    const files = {
      "project.yaml": PROJECT_YAML,
      "SUMMARY.md": "- [Figures](figures.md)\n",
      "figures.md": "![Readable](good.svg)\n\n![Unreadable](bad.svg)\n",
      "good.svg": "<svg/>",
      "bad.svg": "<svg/>",
    };
    try {
      for (const [name, content] of Object.entries(files)) {
        await Deno.writeTextFile(`${dir}/${name}`, content);
      }
      const image = `${dir}/bad.svg`;
      await Deno.chmod(image, 0o000);
      try {
        (await Deno.open(image)).close();
        return; // A privileged runner can still read this file.
      } catch (error) {
        if (!(error instanceof Deno.errors.PermissionDenied)) throw error;
      }
      const { code, stderr } = await markspecInDir(dir, ["book", "build"]);
      assertEquals(code, 0, stderr);
      assertStringIncludes(stderr, "image 'bad.svg' could not be read");
      const html = await Deno.readTextFile(`${dir}/_site/figures.html`);
      assertStringIncludes(html, '<img src="bad.svg" alt="Unreadable">');
      assertEquals(
        await Deno.readTextFile(`${dir}/_site/_assets/good.svg`),
        "<svg/>",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test("book build: preserves the source when an asset already occupies its output path", async () => {
  const diagram = "<svg><desc>Original diagram</desc></svg>";
  const { code, stderr, dir } = await markspecPersist(
    ["book", "build", "--output", ".."],
    {
      cwd: "_assets",
      files: {
        "_assets/project.yaml": PROJECT_YAML,
        "_assets/SUMMARY.md": "- [Figures](figures.md)\n",
        "_assets/figures.md": "![Diagram](diagram.svg)\n",
        "_assets/diagram.svg": diagram,
      },
    },
  );
  try {
    assertEquals(code, 0, stderr);
    assertEquals(
      await Deno.readTextFile(`${dir}/_assets/diagram.svg`),
      diagram,
    );
    const html = await Deno.readTextFile(`${dir}/figures.html`);
    assertStringIncludes(html, '<img src="_assets/diagram.svg" alt="Diagram">');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("book build: resolves reference figures across caption boundaries", async () => {
  const { code, stderr, dir } = await markspecPersist(["book", "build"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "SUMMARY.md": "- [Figures](figures.md)\n",
      "figures.md": `![First figure][diagram]

_Figure: Explicit caption_

![Second figure][diagram]

See [the details][details].

> [Diagram]: <a diagram.svg>
>   "Title & more"

[details]: figures.md#details
`,
      "a diagram.svg": "<svg/>",
    },
  });
  try {
    assertEquals(code, 0, stderr);
    const html = await Deno.readTextFile(`${dir}/_site/figures.html`);
    assertMatch(
      html,
      /<img src="_assets\/a%20diagram\.svg" alt="First figure" title="Title &#x26; more"><\/p>\s*<p class="caption">Figure 1: Explicit caption<\/p>/,
    );
    assertMatch(
      html,
      /<img src="_assets\/a%20diagram\.svg" alt="Second figure" title="Title &#x26; more"><\/p>\s*<p class="caption">Figure 2: Second figure<\/p>/,
    );
    assertStringIncludes(html, 'href="figures.html#details"');
    assertEquals(
      await Deno.readTextFile(`${dir}/_site/_assets/a diagram.svg`),
      "<svg/>",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("book build: detects an asset output that would overwrite another image source", async () => {
  const original = "<svg><desc>Original</desc></svg>";
  const { code, stderr, dir } = await markspecPersist(
    ["book", "build", "--output", "."],
    {
      files: {
        "project.yaml": PROJECT_YAML,
        "SUMMARY.md": "- [Figures](figures.md)\n",
        "figures.md":
          "![First](diagram.svg)\n\n![Second](_assets/diagram.svg)\n",
        "diagram.svg": "<svg/>",
        "_assets/diagram.svg": original,
      },
    },
  );
  try {
    assertEquals(await Deno.readTextFile(`${dir}/diagram.svg`), "<svg/>");
    assertEquals(
      await Deno.readTextFile(`${dir}/_assets/diagram.svg`),
      original,
    );
    assertEquals(code, 1, stderr);
    assertStringIncludes(stderr, "would overwrite an image source");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("book build: HTML shell links markspec.css", async () => {
  const dir = await Deno.makeTempDir();
  try {
    for (const [name, content] of Object.entries(FIXTURE)) {
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        fromFileUrl(
          new URL("../../packages/markspec/main.ts", import.meta.url),
        ),
        "book",
        "build",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    });
    await cmd.output();

    const html = await Deno.readTextFile(`${dir}/_site/requirements.html`);
    assertStringIncludes(html, 'href="markspec.css"');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("book build: --output flag writes to custom directory", async () => {
  const { code, stderr } = await markspec(
    ["book", "build", "--output", "out"],
    { files: FIXTURE },
  );
  assertEquals(code, 0, `expected exit 0, stderr: ${stderr}`);
  // `wrote out/index.html` on POSIX; `wrote out\index.html` on Windows.
  assertMatch(stderr, /out[\\/]index\.html/);
});

// ── index.md as a real chapter (not just an auto-generated nav page) ───────

const INDEX_MD_SUMMARY = `# Summary

- [Overview](index.md)
- [Requirements](requirements.md)
- [Specs](specs.md)
`;

// Deliberately mentions neither other chapter — regression fixture for the
// "chapter content wins but strands the rest of the book" bug: an index.md
// chapter's own prose is not a substitute for full site navigation.
const INDEX_MD_CONTENT =
  `# Overview\n\nOVERVIEW-MARKER-TEXT this is the book's real homepage content.\n`;

const INDEX_MD_FIXTURE = {
  "project.yaml": PROJECT_YAML,
  "SUMMARY.md": INDEX_MD_SUMMARY,
  "index.md": INDEX_MD_CONTENT,
  "requirements.md": REQUIREMENTS_MD,
  "specs.md": SPECS_MD,
};

Deno.test("book build: a chapter mapped from index.md becomes index.html — its content wins, but every chapter stays linked from it", async () => {
  const { code, stderr } = await markspec(["book", "build"], {
    files: INDEX_MD_FIXTURE,
  });
  assertEquals(code, 0, `expected exit 0, stderr: ${stderr}`);

  const dir = await Deno.makeTempDir();
  try {
    for (const [name, content] of Object.entries(INDEX_MD_FIXTURE)) {
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        fromFileUrl(
          new URL("../../packages/markspec/main.ts", import.meta.url),
        ),
        "book",
        "build",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    });
    await cmd.output();

    const html = await Deno.readTextFile(`${dir}/_site/index.html`);
    assertStringIncludes(html, "OVERVIEW-MARKER-TEXT");
    // The chapter's own content must win — no separate, redundant nav-only
    // page should be written for a chapter that already maps to "index".
    // But every OTHER chapter — including one index.md's own prose never
    // mentions — must still be reachable from the homepage: the auto nav
    // section is appended, not skipped, when a real chapter claims "index".
    assertStringIncludes(html, 'href="requirements.html"');
    assertStringIncludes(html, 'href="specs.html"');

    const requirementsHtml = await Deno.readTextFile(
      `${dir}/_site/requirements.html`,
    );
    assertStringIncludes(requirementsHtml, "STK_BRK_0001");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ── Cross-chapter link rewriting (#773) ────────────────────────────────────

const LINKS_SUMMARY = `# Summary

- [Overview](index.md)
- [Sibling](sibling.md)

# Recipes

- [Deploy](recipes/deploy.md)
`;

const LINKS_INDEX_MD = `# Overview\n\nSee [Sibling](sibling.md) for details.\n`;
const LINKS_SIBLING_MD = `# Sibling\n\nSIBLING-MARKER-TEXT.\n`;
const LINKS_DEPLOY_MD =
  `# Deploy\n\nSee [Sibling](../sibling.md#section) for prerequisites.\n`;

const LINKS_FIXTURE = {
  "project.yaml": PROJECT_YAML,
  "SUMMARY.md": LINKS_SUMMARY,
  "index.md": LINKS_INDEX_MD,
  "sibling.md": LINKS_SIBLING_MD,
  "recipes/deploy.md": LINKS_DEPLOY_MD,
};

Deno.test("book build: rewrites a same-directory chapter link's .md extension to .html", async () => {
  const { code, stderr, dir } = await markspecPersist(["book", "build"], {
    files: LINKS_FIXTURE,
  });
  try {
    assertEquals(code, 0, `expected exit 0, stderr: ${stderr}`);
    const html = await Deno.readTextFile(`${dir}/_site/index.html`);
    assertStringIncludes(html, 'href="sibling.html"');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("book build: rewrites a nested chapter's parent-relative link, preserving the fragment", async () => {
  const { code, stderr, dir } = await markspecPersist(["book", "build"], {
    files: LINKS_FIXTURE,
  });
  try {
    assertEquals(code, 0, `expected exit 0, stderr: ${stderr}`);
    const html = await Deno.readTextFile(`${dir}/_site/recipes-deploy.html`);
    assertStringIncludes(html, 'href="sibling.html#section"');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// A chapter declared in SUMMARY.md whose file is intentionally never written
// (a common in-progress-book authoring state — SUMMARY.md scaffolded ahead
// of content) plus a chapter path with a redundant "./" prefix.
const GHOST_SUMMARY = `# Summary

- [Overview](./index.md)
- [Ghost](ghost.md)
`;

const GHOST_INDEX_MD =
  `# Overview\n\nSee [Ghost](ghost.md) and back to [self](./index.md).\n`;

const GHOST_FIXTURE = {
  "project.yaml": PROJECT_YAML,
  "SUMMARY.md": GHOST_SUMMARY,
  "index.md": GHOST_INDEX_MD,
  // "ghost.md" is deliberately absent.
};

Deno.test("book build: a link to a chapter declared in SUMMARY.md but missing on disk is left unrewritten", async () => {
  const { code, stderr, dir } = await markspecPersist(["book", "build"], {
    files: GHOST_FIXTURE,
  });
  try {
    assertEquals(code, 0, `expected exit 0, stderr: ${stderr}`);
    assertStringIncludes(stderr, "warning: chapter file not found: ghost.md");
    const html = await Deno.readTextFile(`${dir}/_site/index.html`);
    // "ghost.md" has no backing file and will never get a ghost.html — a
    // link to it must stay an honest (if dead) .md reference, not be
    // confidently rewritten to a same-site page that will never exist.
    assertStringIncludes(html, 'href="ghost.md"');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("book build: a chapter path declared with a redundant './' prefix in SUMMARY.md still resolves incoming links", async () => {
  const { code, stderr, dir } = await markspecPersist(["book", "build"], {
    files: GHOST_FIXTURE,
  });
  try {
    assertEquals(code, 0, `expected exit 0, stderr: ${stderr}`);
    const html = await Deno.readTextFile(`${dir}/_site/index.html`);
    // "./index.md" (as declared in SUMMARY.md) must match a link resolving
    // to the plain, normalized "index.md" from within the same chapter.
    assertStringIncludes(html, 'href="index.html"');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ── Chapter slug collision (#778) ──────────────────────────────────────────

// Two distinct chapters whose source paths both flatten to the slug
// "recipes-deploy": "recipes/deploy.md" (nested) and "recipes-deploy.md"
// (hyphenated top-level). Left undetected, the second write silently
// overwrites the first and #776's link rewriting sends "Deploy" links to
// whichever chapter won the write race — a reader lands on the wrong content.
const COLLISION_SUMMARY = `# Summary

- [Deploy](recipes/deploy.md)
- [Recipes Deploy](recipes-deploy.md)
- [Specs](specs.md)
`;

const COLLISION_FIXTURE = {
  "project.yaml": PROJECT_YAML,
  "SUMMARY.md": COLLISION_SUMMARY,
  "recipes/deploy.md": `# Deploy\n\nDEPLOY-CHAPTER-MARKER content.\n`,
  "recipes-deploy.md":
    `# Recipes Deploy\n\nRECIPES-DEPLOY-CHAPTER-MARKER content.\n`,
  "specs.md": SPECS_MD,
};

Deno.test("book build: colliding chapter slugs fail the build with MSL-K001 and write nothing", async () => {
  const { code, stderr, dir } = await markspecPersist(["book", "build"], {
    files: COLLISION_FIXTURE,
  });
  try {
    // Fail loud: a build that would silently serve the wrong chapter aborts.
    assertEquals(code, 1, `expected exit 1, stderr: ${stderr}`);
    assertStringIncludes(stderr, "MSL-K001");
    // The message must name both colliding source paths and the shared slug
    // so the author knows exactly which two chapters to disambiguate.
    assertStringIncludes(stderr, "recipes/deploy.md");
    assertStringIncludes(stderr, "recipes-deploy.md");
    assertStringIncludes(stderr, "recipes-deploy.html");
    // No output is produced — the abort happens before any file is written,
    // so the wrong-content page never reaches disk.
    let siteExists = true;
    try {
      await Deno.stat(`${dir}/_site`);
    } catch {
      siteExists = false;
    }
    assertEquals(
      siteExists,
      false,
      "expected no _site output on a failed build",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  name: "book build: keeps image reads and copies within their roots",
  ignore: Deno.build.os === "windows",
  async fn(t) {
    const dir = await Deno.makeTempDir();
    const project = `${dir}/project`;
    const outside = `${dir}/outside`;
    const sentinel = "<svg><desc>Outside</desc></svg>";
    try {
      await Deno.mkdir(project);
      await Deno.mkdir(outside);
      await Deno.writeTextFile(`${outside}/diagram.svg`, sentinel);
      await Deno.writeTextFile(`${project}/project.yaml`, PROJECT_YAML);
      await Deno.writeTextFile(
        `${project}/SUMMARY.md`,
        "- [Figures](figures.md)\n",
      );
      await Deno.writeTextFile(
        `${project}/figures.md`,
        "![Diagram](diagram.svg)\n",
      );

      await t.step(
        "an input symlink keeps its URL and skips copying",
        async () => {
          await Deno.symlink(
            `${outside}/diagram.svg`,
            `${project}/diagram.svg`,
          );
          const { code, stderr } = await markspecInDir(project, [
            "book",
            "build",
          ]);
          assertEquals(code, 0, stderr);
          assertStringIncludes(
            stderr,
            "image 'diagram.svg' is outside the project",
          );
          const html = await Deno.readTextFile(`${project}/_site/figures.html`);
          assertStringIncludes(html, '<img src="diagram.svg" alt="Diagram">');
          const output = Array.fromAsync(Deno.readDir(`${project}/_site`));
          assertEquals((await output).map((item) => item.name).sort(), [
            "figures.html",
            "index.html",
          ]);
          await Deno.remove(`${project}/diagram.svg`);
        },
      );

      await Deno.writeTextFile(`${project}/diagram.svg`, "<svg/>");
      await t.step(
        "an output directory symlink leaves its target intact",
        async () => {
          await Deno.mkdir(`${project}/redirected`);
          await Deno.symlink(outside, `${project}/redirected/_assets`);
          const { code, stderr } = await markspecInDir(project, [
            "book",
            "build",
            "--output",
            "redirected",
          ]);
          assertEquals(code, 1, stderr);
          assertEquals(
            await Deno.readTextFile(`${outside}/diagram.svg`),
            sentinel,
          );
        },
      );

      await t.step(
        "an output file symlink is replaced by the copied image",
        async () => {
          await Deno.mkdir(`${project}/_site/_assets`);
          const asset = `${project}/_site/_assets/diagram.svg`;
          await Deno.symlink(`${outside}/diagram.svg`, asset);
          const { code, stderr } = await markspecInDir(project, [
            "book",
            "build",
          ]);
          assertEquals(code, 0, stderr);
          assertEquals((await Deno.lstat(asset)).isSymlink, false);
          assertEquals(await Deno.readTextFile(asset), "<svg/>");
          assertEquals(
            await Deno.readTextFile(`${outside}/diagram.svg`),
            sentinel,
          );
        },
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
