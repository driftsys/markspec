/**
 * @module tests/e2e/book_build_test
 *
 * E2E tests for `markspec book build` subcommand.
 *
 * Verifies that the HTML renderer emits correct MarkSpec CSS classes for
 * entry blocks, pills, and alerts (closes #182).
 */

import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { markspec } from "./helpers.ts";

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
