/**
 * @module tests/e2e/book_build_test
 *
 * E2E tests for `markspec book build` subcommand.
 *
 * Verifies that the HTML renderer emits correct MarkSpec CSS classes for
 * entry blocks, pills, and alerts (closes #182).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────

const PROJECT_YAML = `name: io.test.book\ndomain: TST\nversion: "1.0.0"\n`;

const SUMMARY_MD = `# Summary

- [Requirements](requirements.md)
- [Specs](specs.md)
`;

/** Chapter with all three entry categories (req/spec/test) plus a GFM alert. */
const REQUIREMENTS_MD = `# Requirements

- [STK_BRK_0001] Stakeholder requirement

  Braking system shall stop the vehicle within 3 seconds.

  Id: STK_01HGW2Q8MNP3\\
  Labels: ASIL-B, Safety

- [SRS_BRK_0001] Sensor input debouncing

  The sensor driver shall debounce raw inputs.

  Id: SRS_01HGW2R9QLP4\\
  Satisfies: STK_BRK_0001\\
  Labels: ASIL-B

> [!WARNING]
> Failure to debounce may lead to spurious brake activation.
`;

/** Chapter with ARC entries (spec category) and a figure caption. */
const SPECS_MD = `# Architecture Specs

- [ARC_BRK_0001] Braking ECU interface

  The braking ECU shall expose a CAN bus interface.

  Id: ARC_01HGW2S0ABC5\\
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

Deno.test("book build: emits req-block for default (req) entry", async () => {
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
        new URL("../../packages/markspec/main.ts", import.meta.url).pathname,
        "book",
        "build",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    });
    await cmd.output();

    const html = await Deno.readTextFile(`${dir}/_site/requirements.html`);
    assertStringIncludes(html, 'class="req-block"');
    assertStringIncludes(html, 'data-entry-type="req"');
    assertStringIncludes(html, "STK_BRK_0001");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("book build: emits correct data-entry-type for spec (ARC) entries", async () => {
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
        new URL("../../packages/markspec/main.ts", import.meta.url).pathname,
        "book",
        "build",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    });
    await cmd.output();

    const html = await Deno.readTextFile(`${dir}/_site/specs.html`);
    assertStringIncludes(html, 'data-entry-type="spec"');
    assertStringIncludes(html, "ARC_BRK_0001");
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
        new URL("../../packages/markspec/main.ts", import.meta.url).pathname,
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
        new URL("../../packages/markspec/main.ts", import.meta.url).pathname,
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
        new URL("../../packages/markspec/main.ts", import.meta.url).pathname,
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
        new URL("../../packages/markspec/main.ts", import.meta.url).pathname,
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
  assertStringIncludes(stderr, "out/index.html");
});
