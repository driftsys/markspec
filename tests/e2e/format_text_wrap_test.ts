/**
 * @module tests/e2e/format_text_wrap_test
 *
 * E2E: the `.markspec.yaml` `format:` section selects how `markspec fmt`
 * wraps prose (ADR-029 amendment) — `always` (default, hard-wrapped at the
 * line width that `.editorconfig` gives the file, 80 when unset),
 * `maintain` (the author's line breaks are kept) or `never`
 * (one line per paragraph) — in entry bodies and in prose outside entries,
 * idempotently, and the `check` MSL-F010 drift gate applies the same style.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspec, markspecInDir, markspecPersist } from "./helpers.ts";

const PROJECT_YAML = `name: text-wrap-e2e\nversion: 0.1.0\n`;

const PROFILE_YAML = `id: "@acme/text-wrap"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`;

function files(
  format: string | undefined,
  document: string,
  editorconfig?: string,
): Record<string, string> {
  return {
    "project.yaml": PROJECT_YAML,
    ".markspec.yaml": `profiles:\n  - ./profiles/p\n${format ?? ""}`,
    "profiles/p/markspec.yaml": PROFILE_YAML,
    "docs/req.md": document,
    ...(editorconfig === undefined ? {} : { ".editorconfig": editorconfig }),
  };
}

// The author's own line breaks: a short first line, then a line far longer
// than 80 columns, in the overview prose and in an entry body.
const LONG =
  "and which are applicable completely or partially, a sentence long enough to pass eighty columns.";
const DOCUMENT = `# Requirements

The overview lists the documents referenced here
${LONG}

- [REQ-0001] Referenced documents

  The system shall list the documents referenced here
  ${LONG}

      Id: 01REQ000000000000000000001
      Type: requirement
`;

async function formatted(
  format: string | undefined,
  editorconfig?: string,
): Promise<string> {
  const run = await markspecPersist(
    ["fmt"],
    files(format, DOCUMENT, editorconfig),
  );
  try {
    assertEquals(run.code, 0, run.stderr);
    const once = await Deno.readTextFile(join(run.dir, "docs/req.md"));
    const again = await markspecInDir(run.dir, ["fmt"]);
    assertEquals(again.code, 0, again.stderr);
    assertStringIncludes(again.stderr, "0 file(s) formatted");
    assertEquals(
      await Deno.readTextFile(join(run.dir, "docs/req.md")),
      once,
      "format ∘ format === format",
    );
    return once;
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
}

function longestLine(text: string): number {
  return Math.max(...text.split("\n").map((line) => line.length));
}

Deno.test("fmt text-wrap: always is the default and wraps at 80 columns", async () => {
  const output = await formatted(undefined);
  assertEquals(longestLine(output) <= 80, true, output);
  assertEquals(output, await formatted("format:\n  text-wrap: always\n"));
});

Deno.test("fmt text-wrap: always wraps at the .editorconfig max_line_length", async () => {
  const output = await formatted(
    "format:\n  text-wrap: always\n",
    "root = true\n\n[*.md]\nmax_line_length = 100\n",
  );
  assertEquals(longestLine(output) <= 100, true, output);
  assertEquals(longestLine(output) > 80, true, output);
});

Deno.test("fmt text-wrap: maintain keeps the author's line breaks", async () => {
  const output = await formatted("format:\n  text-wrap: maintain\n");
  assertStringIncludes(
    output,
    `The overview lists the documents referenced here\n${LONG}\n`,
  );
  assertStringIncludes(
    output,
    `  The system shall list the documents referenced here\n  ${LONG}\n`,
  );
});

Deno.test("fmt text-wrap: never puts each paragraph on one line", async () => {
  const output = await formatted("format:\n  text-wrap: never\n");
  assertStringIncludes(
    output,
    `The overview lists the documents referenced here ${LONG}\n`,
  );
  assertStringIncludes(
    output,
    `  The system shall list the documents referenced here ${LONG}\n`,
  );
});

Deno.test("fmt text-wrap: hard breaks and trailers survive every style", async () => {
  const document = DOCUMENT.replace(
    "  The system shall list the documents referenced here\n",
    "  The system shall list the documents referenced here.\\\n",
  );
  for (const style of ["always", "maintain", "never"]) {
    const run = await markspecPersist(
      ["fmt"],
      files(`format:\n  text-wrap: ${style}\n`, document),
    );
    try {
      assertEquals(run.code, 0, run.stderr);
      const output = await Deno.readTextFile(join(run.dir, "docs/req.md"));
      assertStringIncludes(output, "referenced here.\\\n", style);
      assertStringIncludes(
        output,
        "      Id: 01REQ000000000000000000001\n      Type: requirement\n",
        style,
      );
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  }
});

Deno.test("check text-wrap: MSL-F010 applies the configured style", async () => {
  // Formatted as `never`: clean under `never`, drift under the default.
  const oneLine = await formatted("format:\n  text-wrap: never\n");
  const clean = await markspec(["check"], {
    files: files("format:\n  text-wrap: never\n", oneLine),
  });
  assertEquals(clean.stderr.includes("MSL-F010"), false, clean.stderr);
  assertEquals(clean.code, 0, clean.stderr);
  const drift = await markspec(["check"], { files: files(undefined, oneLine) });
  assertStringIncludes(drift.stderr, "MSL-F010");
  assertEquals(drift.code, 1);
});

Deno.test("fmt text-wrap: an invalid style is a configuration error", async () => {
  const { code, stderr } = await markspec(["fmt"], {
    files: files("format:\n  text-wrap: sometimes\n", DOCUMENT),
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "format.text-wrap");
});
