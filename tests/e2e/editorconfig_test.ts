/**
 * @module tests/e2e/editorconfig_test
 *
 * E2E tests for the `.editorconfig` style source of `markspec fmt` and of
 * the `check` MSL-F010 gate (#984): `max_line_length` sets the Markdown line
 * width and `end_of_line` sets the line ending, as in `prim fmt`.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspecInDir, markspecPersist } from "./helpers.ts";

/** A minimal project, so bare `check` runs the MSL-F010 gate. */
const BASE_FILES = {
  "project.yaml": "name: demo\nversion: 0.1.0\n",
  ".markspec.yaml": "{}\n",
};

/** One paragraph of 93 characters: one line at width 100, two at 80. */
const LONG_LINE = "This paragraph is long enough to pass eighty " +
  "columns but it stays shorter than one hundred cols.";

const DOC = `# Doc\n\n${LONG_LINE}\n`;

/** Run `markspec fmt <file>` on the given tree; return the formatted file. */
async function fmtFile(
  files: Record<string, string>,
  target: string,
): Promise<{ code: number; stderr: string; output: string }> {
  const run = await markspecPersist(["fmt", target], { files });
  try {
    const output = await Deno.readTextFile(join(run.dir, target));
    return { code: run.code, stderr: run.stderr, output };
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
}

Deno.test("fmt: no .editorconfig wraps Markdown at 80 columns", async () => {
  const { code, output } = await fmtFile({ "doc.md": DOC }, "doc.md");
  assertEquals(code, 0);
  assertEquals(output.split("\n").length, 5, output);
});

Deno.test("fmt: max_line_length = 100 from .editorconfig widens the wrap", async () => {
  const { code, output } = await fmtFile({
    ".editorconfig": "root = true\n\n[*.md]\nmax_line_length = 100\n",
    "doc.md":
      `# Doc\n\nThis paragraph is long enough to pass eighty columns\n` +
      `but it stays shorter than one hundred cols.\n`,
  }, "doc.md");
  assertEquals(code, 0);
  assertEquals(output, DOC);
});

Deno.test("fmt: max_line_length = off falls back to 80 columns", async () => {
  const { output } = await fmtFile({
    ".editorconfig": "root = true\n[*]\nmax_line_length = off\n",
    "doc.md": DOC,
  }, "doc.md");
  assertEquals(output.split("\n").length, 5, output);
});

Deno.test("fmt: a section for another extension does not apply", async () => {
  const { output } = await fmtFile({
    ".editorconfig": "root = true\n[*.ts]\nmax_line_length = 100\n",
    "doc.md": DOC,
  }, "doc.md");
  assertEquals(output.split("\n").length, 5, output);
});

Deno.test("fmt: end_of_line = crlf writes CRLF line endings", async () => {
  const { code, output } = await fmtFile({
    ".editorconfig": "root = true\n[*]\nend_of_line = crlf\n",
    "doc.md": "# Doc\n\nShort line.\n",
  }, "doc.md");
  assertEquals(code, 0);
  assertEquals(output, "# Doc\r\n\r\nShort line.\r\n");
});

Deno.test("fmt: end_of_line = lf converts a CRLF file to LF", async () => {
  const { output } = await fmtFile({
    ".editorconfig": "root = true\n[*]\nend_of_line = lf\n",
    "doc.md": "# Doc\r\n\r\nShort line.\r\n",
  }, "doc.md");
  assertEquals(output, "# Doc\n\nShort line.\n");
});

Deno.test("fmt: without .editorconfig a CRLF file becomes LF", async () => {
  const { output } = await fmtFile({
    "doc.md": "# Doc\r\n\r\nShort line.\r\n",
  }, "doc.md");
  assertEquals(output, "# Doc\n\nShort line.\n");
});

Deno.test("fmt: with end_of_line unset a CRLF file becomes LF", async () => {
  const { output } = await fmtFile({
    ".editorconfig": "root = true\n[*.md]\nmax_line_length = 80\n",
    "doc.md": "# Doc\r\n\r\nShort line.\r\n",
  }, "doc.md");
  assertEquals(output, "# Doc\n\nShort line.\n");
});

Deno.test("fmt: a nested .editorconfig overrides the outer one", async () => {
  const files = {
    ".editorconfig": "root = true\n[*.md]\nmax_line_length = 100\n",
    "sub/.editorconfig": "[*.md]\nmax_line_length = 80\n",
    "doc.md": DOC,
    "sub/doc.md": DOC,
  };
  const outer = await fmtFile(files, "doc.md");
  assertEquals(outer.output, DOC);
  const inner = await fmtFile(files, "sub/doc.md");
  assertEquals(inner.output.split("\n").length, 5, inner.output);
});

Deno.test("fmt: root = true stops the walk at the nested .editorconfig", async () => {
  const { output } = await fmtFile({
    ".editorconfig": "root = true\n[*]\nend_of_line = crlf\n" +
      "max_line_length = 100\n",
    "sub/.editorconfig": "root = true\n[*]\nindent_size = 2\n",
    "sub/doc.md": DOC,
  }, "sub/doc.md");
  // Neither the outer CRLF nor the outer width applies.
  assertEquals(output.includes("\r"), false);
  assertEquals(output.split("\n").length, 5, output);
});

Deno.test("check: MSL-F010 names line endings when they are the only drift", async () => {
  const run = await markspecPersist(["check"], {
    files: {
      ...BASE_FILES,
      ".editorconfig": "root = true\n[*]\nend_of_line = lf\n",
      "docs/req.md": "# Requirements\r\n\r\nShort line.\r\n",
    },
  });
  try {
    assertStringIncludes(run.stderr, "MSL-F010");
    assertStringIncludes(run.stderr, "`end_of_line` set in .editorconfig");
    assertEquals(run.code, 1);
    // After `fmt`, the same check passes.
    await markspecInDir(run.dir, ["fmt"]);
    const again = await markspecInDir(run.dir, ["check"]);
    assertEquals(again.code, 0, again.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("check: MSL-F010 uses the .editorconfig line width", async () => {
  const run = await markspecPersist(["check"], {
    files: {
      ...BASE_FILES,
      ".editorconfig": "root = true\n[*.md]\nmax_line_length = 100\n",
      "docs/doc.md": DOC,
    },
  });
  try {
    // One 93-column line is formatted at width 100.
    assertEquals(run.stderr.includes("MSL-F010"), false, run.stderr);
    assertEquals(run.code, 0, run.stderr);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("check: MSL-F010 names the LF default when end_of_line is not set", async () => {
  const { code, stderr } = await markspecPersist(["check"], {
    files: {
      ...BASE_FILES,
      "docs/req.md": "# Requirements\r\n\r\nShort line.\r\n",
    },
  }).then(async (run) => {
    await Deno.remove(run.dir, { recursive: true });
    return run;
  });
  assertStringIncludes(stderr, "MSL-F010");
  assertStringIncludes(stderr, "does not use LF line endings");
  assertStringIncludes(stderr, "end_of_line = crlf");
  assertEquals(stderr.includes("set in .editorconfig"), false, stderr);
  assertEquals(code, 1);
});
