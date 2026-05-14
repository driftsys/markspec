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

      Labels: ASIL-B
      Id: SRS_01HGW2Q8MNP3
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

      Labels: ASIL-B
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
// Trailer key re-casing (spec §3.3.4)
// ---------------------------------------------------------------------------

Deno.test("format: rewrites trailer keys to TitleCase-Hyphenated", async () => {
  const input = "# Test\n\n" +
    "- [REQ-001] Title\n\n" +
    "  Body.\n\n" +
    "      ID: 01HGW2Q8MNP3RSTVWXYZABCDEF\n" +
    "      LABELS: ASIL-B\n";
  const { readFile } = await runFormat({ "req.md": input });
  const output = await readFile("req.md");
  // Keys must land in canonical TitleCase-Hyphenated form.
  assertEquals(
    /^\s*Id:\s/m.test(output),
    true,
    `'Id:' should be canonical; output:\n${output}`,
  );
  assertEquals(
    /^\s*Labels:\s/m.test(output),
    true,
    `'Labels:' should be canonical; output:\n${output}`,
  );
  // Loud-case inputs must be gone.
  assertEquals(output.includes("ID: "), false);
  assertEquals(output.includes("LABELS: "), false);
});

Deno.test("format: lowercases interior of hyphenated key", async () => {
  const input = "# Test\n\n" +
    "- [REF-001] My reference\n\n" +
    "  Body.\n\n" +
    "      Id: urn:iso:std:iso:26262:-6:ed-2\n" +
    "      Reference-URL: https://example.org/spec\n";
  const { readFile } = await runFormat({ "req.md": input });
  const output = await readFile("req.md");
  // Canonical form is `Reference-url` (lowercase after hyphen) per
  // spec §3.3.4 examples.
  assertEquals(
    /^\s*Reference-url:\s/m.test(output),
    true,
    `'Reference-url:' should be the canonical form; output:\n${output}`,
  );
  assertEquals(output.includes("Reference-URL: "), false);
});

// ---------------------------------------------------------------------------
// Blank-line collapse (spec §3.4.3 / §5.2)
// ---------------------------------------------------------------------------

Deno.test("format: collapses consecutive blank lines to one", async () => {
  const input = "# Test\n\n" +
    "- [REQ-001] Title\n\n" +
    "  Body line one.\n\n\n\n" +
    "  Body line two.\n\n" +
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n";
  const { readFile } = await runFormat({ "req.md": input });
  const output = await readFile("req.md");
  assertEquals(
    /\n\n\n/.test(output),
    false,
    `multi-blank should collapse to a single blank line; output:\n${output}`,
  );
});

Deno.test("format: blank-line collapse is idempotent", async () => {
  const input = "# Test\n\n" +
    "- [REQ-001] Title\n\n\n\n" +
    "  Body.\n\n\n" +
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n";
  const pass1 = await runFormat({ "req.md": input });
  const out1 = await pass1.readFile("req.md");

  const pass2 = await runFormat({ "req.md": out1 });
  const out2 = await pass2.readFile("req.md");

  assertEquals(out1, out2);
});

// ---------------------------------------------------------------------------
// Idempotence — spec §3.1 / §5.3
// ---------------------------------------------------------------------------

Deno.test("format: idempotent after bullet rewrite", async () => {
  const input = "# Test\n\n" +
    "* [REQ-001] Title\n\n" +
    "  Body.\n\n" +
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n";
  const pass1 = await runFormat({ "req.md": input });
  const out1 = await pass1.readFile("req.md");

  const pass2 = await runFormat({ "req.md": out1 });
  const out2 = await pass2.readFile("req.md");

  assertEquals(out1, out2, "format must be idempotent on bullet rewrite");
});

Deno.test("format: idempotent after key re-casing", async () => {
  const input = "# Test\n\n" +
    "- [REQ-001] Title\n\n" +
    "  Body.\n\n" +
    "      ID: 01HGW2Q8MNP3RSTVWXYZABCDEF\n" +
    "      LABELS: ASIL-B\n";
  const pass1 = await runFormat({ "req.md": input });
  const out1 = await pass1.readFile("req.md");

  const pass2 = await runFormat({ "req.md": out1 });
  const out2 = await pass2.readFile("req.md");

  assertEquals(out1, out2, "format must be idempotent on key re-casing");
});

Deno.test("format: idempotent across combined transforms", async () => {
  const input = "# Test\n\n" +
    "* [REQ-001] Title\n\n" +
    "  The driver SHALL debounce raw inputs.\n\n" +
    "      ID: 01HGW2Q8MNP3RSTVWXYZABCDEF\n" +
    "      LABELS: ASIL-B\n";
  const pass1 = await runFormat({ "req.md": input });
  const out1 = await pass1.readFile("req.md");

  const pass2 = await runFormat({ "req.md": out1 });
  const out2 = await pass2.readFile("req.md");

  assertEquals(
    out1,
    out2,
    "format must be idempotent across bullet + key-case + modal normalisation",
  );
});

// ---------------------------------------------------------------------------
// Title-line normalisation — bullet character (spec §3.2)
// ---------------------------------------------------------------------------

Deno.test("format: rewrites * bullet to - on entry title line", async () => {
  const input = "# Test\n\n" +
    "* [REQ-001] Title\n\n" +
    "  Body.\n\n" +
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n";
  const { readFile } = await runFormat({ "req.md": input });
  const output = await readFile("req.md");
  // Bullet should have been rewritten.
  assertEquals(
    output.includes("* [REQ-001]"),
    false,
    `'*' bullet should be normalised to '-'; output:\n${output}`,
  );
  assertEquals(
    output.includes("- [REQ-001]"),
    true,
    `'-' bullet should be in output; output:\n${output}`,
  );
});

Deno.test("format: rewrites + bullet to - on entry title line", async () => {
  const input = "# Test\n\n" +
    "+ [REQ-001] Title\n\n" +
    "  Body.\n\n" +
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n";
  const { readFile } = await runFormat({ "req.md": input });
  const output = await readFile("req.md");
  assertEquals(output.includes("+ [REQ-001]"), false);
  assertEquals(output.includes("- [REQ-001]"), true);
});

// ---------------------------------------------------------------------------
// Body normalisation — modal keywords (spec §3.4.1)
// ---------------------------------------------------------------------------

Deno.test("format: EARS keywords lowercased mid-sentence, preserved sentence-initial", async () => {
  const input = `# Test

- [SRS_BRK_0001] Sensor input

  When invalid, the driver shall ignore. The system reports When errors
  occur, and While running, it shall check the cycle counter.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const { readFile } = await runFormat({ "req.md": input });
  const output = await readFile("req.md");
  // Sentence-initial "When" (line start) → preserved
  assertStringIncludes(output, "When invalid");
  // Mid-sentence "When" (after ", and ") → lowercased
  assertStringIncludes(output, "reports when errors");
  // Mid-sentence "While" (after "and ") → lowercased
  assertStringIncludes(output, "and while running");
});

Deno.test("format: lowercases uppercase modal keywords in body prose", async () => {
  const input = `# Test

- [SRS_BRK_0001] Sensor debouncing

  The sensor driver SHALL debounce raw inputs and MUST reject spikes
  shorter than the configured window; MAY emit telemetry.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const { code, readFile } = await runFormat({ "req.md": input });
  assertEquals(code, 0);
  const output = await readFile("req.md");
  assertStringIncludes(output, "shall debounce");
  assertStringIncludes(output, "must reject");
  assertStringIncludes(output, "may emit");
  assertEquals(
    output.includes("SHALL"),
    false,
    `SHALL should be normalised; output:\n${output}`,
  );
  assertEquals(
    output.includes("MUST"),
    false,
    `MUST should be normalised; output:\n${output}`,
  );
  assertEquals(
    output.includes("MAY "),
    false,
    `MAY should be normalised; output:\n${output}`,
  );
});

// ---------------------------------------------------------------------------
// Canonical trailer ordering — spec §3.3.2 six-group rule
// ---------------------------------------------------------------------------

Deno.test("format: trailer ordering follows §3.3.2 six-group rule", async () => {
  const input = `# Test

- [SRS_BRK_0001] Title

  Body text.

      Labels: ASIL-B
      Satisfies: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: Specification
      Part-of: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
`;
  const { code, readFile } = await runFormat({ "req.md": input });
  assertEquals(code, 0);
  const output = await readFile("req.md");

  const trailerKeys = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[A-Z][A-Za-z0-9-]*:\s/.test(l))
    .map((l) => l.split(":")[0]);

  assertEquals(
    trailerKeys,
    ["Id", "Type", "Part-of", "Satisfies", "Labels"],
    "trailers must follow §3.3.2 order: Id/Type → trace-upstream → Labels",
  );
});

// ---------------------------------------------------------------------------
// ULID assignment
// ---------------------------------------------------------------------------

Deno.test("format: assigns Id to identified entry missing identity", async () => {
  const input = `# Test

- [SRS_BRK_0001] Title

  Body text.

  Labels: ASIL-B
`;
  const { code, stderr, readFile } = await runFormat({ "req.md": input });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "assigned Id:");
  const output = await readFile("req.md");
  assertStringIncludes(output, "Id: ");
});

Deno.test("format: synthesized origin derives deterministic ULID from Source", async () => {
  // First run: Origin: synthesized + Source: → ULID derived per §3.5.
  const input = `# Test

- [serde] serde framework

  Body text.

      Origin: synthesized
      Source: crates/foo/Cargo.toml
`;
  const { code: code1, readFile: readFile1 } = await runFormat({
    "req.md": input,
  });
  assertEquals(code1, 0);
  const output1 = await readFile1("req.md");

  // ULID(timestamp=0, randomness=truncate(SHA-256("crates/foo/Cargo.toml"), 80))
  // The timestamp half is "0000000000" — assert that prefix appears.
  assertStringIncludes(output1, "Id: 0000000000");

  // Determinism: re-run on the *same input again* → same Id.
  const { readFile: readFile2 } = await runFormat({ "req.md": input });
  const output2 = await readFile2("req.md");
  assertEquals(extractId(output1), extractId(output2));
});

/** Extract the bare ULID value of the first `Id:` trailer in a file. */
function extractId(content: string): string {
  const m = /Id:\s*([0-9A-HJKMNP-TV-Z]{26})/.exec(content);
  if (!m) throw new Error(`no Id: trailer found in:\n${content}`);
  return m[1];
}

// ---------------------------------------------------------------------------
// Idempotent
// ---------------------------------------------------------------------------

Deno.test("format: second run reports 0 formatted", async () => {
  const input = `# Test

- [SRS_BRK_0001] Title

  Body text.

      Id: SRS_01HGW2Q8MNP3
      Satisfies: SYS_BRK_0042
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

      Labels: ASIL-B
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

      Id: SRS_01HGW2Q8MNP3
      Satisfies: SYS_BRK_0042
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

      Id: SRS_01HGW2Q8MNP3
      Labels: ASIL-B
`;
  const { stderr } = await runFormat({ "req.md": input });
  assertStringIncludes(stderr, "file(s) formatted");
  assertStringIncludes(stderr, "total)");
});
