/**
 * @module tests/e2e/format_test
 *
 * E2E tests for `markspec format` subcommand.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";

const CLI_ENTRY = new URL(
  "../../packages/markspec/main.ts",
  import.meta.url,
).pathname;

/** Run markspec format in a temp dir, return result + file contents. */
async function runFormat(
  files: Record<string, string>,
  args: string[] = [],
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  readFile: (name: string) => Promise<string>;
}> {
  const dir = await Deno.makeTempDir();
  const filePaths: string[] = [];

  for (const [name, content] of Object.entries(files)) {
    const fullPath = `${dir}/${name}`;
    await Deno.writeTextFile(fullPath, content);
    filePaths.push(fullPath);
  }

  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      CLI_ENTRY,
      "format",
      ...args,
      ...filePaths,
    ],
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await cmd.output();

  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    readFile: (name: string) => Deno.readTextFile(`${dir}/${name}`),
  };
}

// ---------------------------------------------------------------------------
// Attribute normalization
// ---------------------------------------------------------------------------

Deno.test("format: normalizes attribute order in file", async () => {
  const input = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Labels: ASIL-B\\
  Id: SRS_01HGW2Q8MNP3\\
  Satisfies: SYS_BRK_0042
`;
  const { code, stderr } = await runFormat({ "req.md": input });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "1 file(s) formatted");
});

Deno.test("format: writes normalized attributes back to file", async () => {
  const input = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Labels: ASIL-B\\
  Id: SRS_01HGW2Q8MNP3
`;
  const { readFile } = await runFormat({ "req.md": input });
  const output = await readFile("req.md");
  // Id should come before Labels
  const idIdx = output.indexOf("Id:");
  const labelsIdx = output.indexOf("Labels:");
  assertEquals(idIdx < labelsIdx, true, "Id should come before Labels");
});

// ---------------------------------------------------------------------------
// ULID assignment
// ---------------------------------------------------------------------------

Deno.test("format: assigns ULID to entry missing Id", async () => {
  const input = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B
`;
  const { code, stderr, readFile } = await runFormat({ "req.md": input });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "assigned Id:");
  const output = await readFile("req.md");
  assertStringIncludes(output, "Id: SRS_");
});

// ---------------------------------------------------------------------------
// Idempotent
// ---------------------------------------------------------------------------

Deno.test("format: second run reports 0 formatted", async () => {
  const input = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Id: SRS_01HGW2Q8MNP3\\
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B
`;
  const { stderr } = await runFormat({ "req.md": input });
  assertStringIncludes(stderr, "0 file(s) formatted");
});

// ---------------------------------------------------------------------------
// --check mode
// ---------------------------------------------------------------------------

Deno.test("format: --check exits 1 when changes needed", async () => {
  const input = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Labels: ASIL-B\\
  Id: SRS_01HGW2Q8MNP3
`;
  const { code, readFile } = await runFormat({ "req.md": input }, ["--check"]);
  assertEquals(code, 1);
  // File should NOT be modified in check mode
  const output = await readFile("req.md");
  assertEquals(output, input);
});

Deno.test("format: --check exits 0 when clean", async () => {
  const input = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Id: SRS_01HGW2Q8MNP3\\
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B
`;
  const { code } = await runFormat({ "req.md": input }, ["--check"]);
  assertEquals(code, 0);
});

// ---------------------------------------------------------------------------
// No args
// ---------------------------------------------------------------------------

Deno.test("format: no files exits 1", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        CLI_ENTRY,
        "format",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    });
    const result = await cmd.output();
    assertEquals(result.code, 1);
    const stderr = new TextDecoder().decode(result.stderr);
    assertStringIncludes(stderr, "no files specified");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

Deno.test("format: reports summary to stderr", async () => {
  const input = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Id: SRS_01HGW2Q8MNP3\\
  Labels: ASIL-B
`;
  const { stderr } = await runFormat({ "req.md": input });
  assertStringIncludes(stderr, "file(s) formatted");
  assertStringIncludes(stderr, "total)");
});
