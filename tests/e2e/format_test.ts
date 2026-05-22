/**
 * @module tests/e2e/format_test
 *
 * E2E tests for `markspec format` subcommand.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const CLI_ENTRY = fromFileUrl(
  new URL("../../packages/markspec/main.ts", import.meta.url),
);

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
// PR 4 formatter cutover — canonicalization survives AST routing
// ---------------------------------------------------------------------------

/**
 * Verifies that formatting a NON-canonical body that exercises multiple AST
 * block shapes (UPPERCASE modal, extra blank lines, fenced code block, GFM
 * table) still produces the fully canonical output AND is idempotent.
 *
 * This test is the PR 4 "watch it pass" case: it proves that
 * normalizeModalKeywords and collapseBlankLines are still applied BEFORE
 * the body is emitted via render(buildBodyAst(canonicalBody)), i.e.
 * canonicalization survives the AST routing introduced in PR 4.
 */
Deno.test(
  "format: canonicalization survives AST routing (PR 4 cutover)",
  async () => {
    // Non-canonical input:
    //   - UPPERCASE modal keywords (SHALL, MUST) — must be lowercased
    //   - Extra consecutive blank lines in the body — must be collapsed
    //   - A fenced code block — must be preserved verbatim
    //   - A GFM table — must round-trip byte-identically
    const input = `# Test

- [SRS_BRK_0001] Sensor debouncing

  The sensor driver SHALL debounce raw inputs.


  It MUST reject spikes shorter than the configured window.

  \`\`\`rust
  fn debounce(v: u32) -> u32 { v }
  \`\`\`

  | Signal | Threshold |
  |--------|-----------|
  | Raw    | 50 ms     |

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
    const pass1 = await runFormat({ "req.md": input });
    assertEquals(pass1.code, 0);
    const out1 = await pass1.readFile("req.md");

    // Modal keywords must be lowercased.
    assertEquals(out1.includes("SHALL"), false, "SHALL must be lowercased");
    assertEquals(out1.includes("MUST"), false, "MUST must be lowercased");
    assertStringIncludes(out1, "shall debounce");
    assertStringIncludes(out1, "must reject");

    // Extra blank lines must be collapsed (no triple newlines).
    assertEquals(
      /\n\n\n/.test(out1),
      false,
      "multiple blank lines must collapse to one",
    );

    // Code block must be preserved verbatim.
    assertStringIncludes(
      out1,
      "```rust\n  fn debounce(v: u32) -> u32 { v }\n  ```",
    );

    // Table must be present (byte-identical round-trip via AST).
    assertStringIncludes(out1, "| Signal | Threshold |");
    assertStringIncludes(out1, "|--------|-----------|");

    // Idempotence: second format produces the exact same output.
    const pass2 = await runFormat({ "req.md": out1 });
    const out2 = await pass2.readFile("req.md");
    assertEquals(
      out1,
      out2,
      "format must be idempotent after AST routing (PR 4 cutover)",
    );
  },
);

// ---------------------------------------------------------------------------
// PR 4 safe fallback — §5.4 loss-of-information guarantee
//
// Bodies containing Markdown constructs not yet covered by the AST
// equivalence gate (thematic break `---`, hard line break, link reference
// definition, setext heading) must be preserved byte-for-byte by the
// formatter — the safe-conditional-fallback branch keeps the original string
// rather than splicing potentially lossy AST output. Each test below verifies
// both preservation (no corruption) and idempotence.
// ---------------------------------------------------------------------------

/**
 * Build an already-canonical document wrapping `body` so we can measure the
 * formatter's behaviour on the body construct alone, without also triggering
 * unrelated canonicalization (modal keywords, attr ordering, ULID assignment).
 *
 * The constructed doc has:
 *   - a fixed, pre-assigned `Id:` → no ULID stamp on pass 1
 *   - no uppercase modals → normalizeModalKeywords is a no-op
 *   - no extra blank lines → collapseBlankLines is a no-op
 * so any deviation between `format(doc).output` and `doc` is attributable
 * exclusively to the AST body step.
 */
function makeCanonicalDoc(body: string): string {
  // Each body line is indented 2 spaces (continuation indent for a top-level
  // list item). The attr block uses the 6-space trailer indent.
  const indentedBody = body
    .split("\n")
    .map((l) => (l.trim() === "" ? "" : `  ${l}`))
    .join("\n");
  return `# Test\n\n- [SRS_BRK_0001] Title\n\n${indentedBody}\n\n      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n`;
}

Deno.test(
  "format: safe fallback — thematic break body preserved and idempotent",
  async () => {
    // `---` is a valid CommonMark thematic break. The AST builder maps it to
    // an UnknownNode whose render is NOT yet guaranteed byte-identical, so
    // the mismatch branch must keep the original string.
    const body = "Paragraph before.\n\n---\n\nParagraph after.";
    const doc = makeCanonicalDoc(body);

    const pass1 = await runFormat({ "req.md": doc });
    assertEquals(pass1.code, 0);
    const out1 = await pass1.readFile("req.md");

    // The thematic break must survive unchanged.
    assertStringIncludes(
      out1,
      "---",
      `thematic break should be preserved; output:\n${out1}`,
    );

    // The formatter must be a no-op on an already-canonical document (the
    // body construct does not affect any formatter pass other than the AST step,
    // and the safe fallback keeps the original lines).
    assertEquals(
      out1,
      doc,
      `format should be a no-op on a canonical doc with a thematic-break body; output:\n${out1}`,
    );

    // Idempotence: second pass must produce identical output.
    const pass2 = await runFormat({ "req.md": out1 });
    const out2 = await pass2.readFile("req.md");
    assertEquals(
      out1,
      out2,
      "format must be idempotent on thematic-break body",
    );
  },
);

Deno.test(
  "format: safe fallback — hard line break body preserved and idempotent",
  async () => {
    // Two trailing spaces before `\n` form a CommonMark hard line break.
    // The AST round-trip does not yet guarantee preservation of trailing
    // spaces, so the mismatch branch must keep the original string.
    const body = "Line one.  \nLine two.";
    const doc = makeCanonicalDoc(body);

    const pass1 = await runFormat({ "req.md": doc });
    assertEquals(pass1.code, 0);
    const out1 = await pass1.readFile("req.md");

    // The two trailing spaces (hard line break marker) must not be stripped.
    assertEquals(
      /Line one\. {2}\n/.test(out1),
      true,
      `hard line break (two trailing spaces) should be preserved; output:\n${
        JSON.stringify(out1)
      }`,
    );

    assertEquals(
      out1,
      doc,
      `format should be a no-op on a canonical doc with a hard-line-break body; output:\n${out1}`,
    );

    const pass2 = await runFormat({ "req.md": out1 });
    const out2 = await pass2.readFile("req.md");
    assertEquals(
      out1,
      out2,
      "format must be idempotent on hard-line-break body",
    );
  },
);

Deno.test(
  "format: safe fallback — link reference definition body preserved and idempotent",
  async () => {
    // A link reference definition `[id]: url` is valid CommonMark but is not
    // currently covered by the body-AST builder, so the mismatch branch must
    // keep the original string, preventing silent deletion.
    const body = "See [foo] for details.\n\n[foo]: https://example.com";
    const doc = makeCanonicalDoc(body);

    const pass1 = await runFormat({ "req.md": doc });
    assertEquals(pass1.code, 0);
    const out1 = await pass1.readFile("req.md");

    // The link reference definition must survive.
    assertStringIncludes(
      out1,
      "[foo]: https://example.com",
      `link reference definition should be preserved; output:\n${out1}`,
    );

    assertEquals(
      out1,
      doc,
      `format should be a no-op on a canonical doc with a link-ref-def body; output:\n${out1}`,
    );

    const pass2 = await runFormat({ "req.md": out1 });
    const out2 = await pass2.readFile("req.md");
    assertEquals(
      out1,
      out2,
      "format must be idempotent on link-ref-def body",
    );
  },
);

Deno.test(
  "format: safe fallback — setext heading inside body preserved and idempotent (§5.4 no-loss)",
  async () => {
    // A setext heading (underline style) is a valid Markdown construct. It is
    // an MSL-B040 validation error (headings inside entry bodies are not allowed
    // by the spec) but the FORMATTER must still NOT destroy it — §5.4 guarantees
    // no loss of information. The safe fallback keeps the original string.
    const body = "Subheading\n----------\n\nBody paragraph.";
    const doc = makeCanonicalDoc(body);

    const pass1 = await runFormat({ "req.md": doc });
    assertEquals(pass1.code, 0);
    const out1 = await pass1.readFile("req.md");

    // The setext underline must survive.
    assertStringIncludes(
      out1,
      "----------",
      `setext heading underline should be preserved; output:\n${out1}`,
    );
    assertStringIncludes(
      out1,
      "Subheading",
      `setext heading text should be preserved; output:\n${out1}`,
    );

    assertEquals(
      out1,
      doc,
      `format should be a no-op on a canonical doc with a setext-heading body; output:\n${out1}`,
    );

    const pass2 = await runFormat({ "req.md": out1 });
    const out2 = await pass2.readFile("req.md");
    assertEquals(
      out1,
      out2,
      "format must be idempotent on setext-heading body",
    );
  },
);

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

// ---------------------------------------------------------------------------
// Formatter fallback guard — regression test (ADR-014 §Decision-2)
//
// The formatter's emitBodyViaAst() uses a safe conditional fallback:
//   render(buildBodyAst(body)) === body  →  emit via AST
//   otherwise                           →  keep original string body
//
// The build/render inverse is NOT total over valid Markdown.  Bodies that
// contain constructs not yet covered by the equivalence gate (hard line
// breaks, setext headings, link-reference definitions, thematic breaks, …)
// do not round-trip and MUST be left byte-identical by the formatter.
//
// This test uses a hard line break (`line  \nline`) — verified to NOT
// round-trip: render(buildBodyAst("Line one  \nLine two")) returns
// "Line oneLine two" (the two trailing spaces and newline are lost).
//
// If someone removes the fallback guard in emitBodyViaAst(), the formatter
// will corrupt hard-line-break bodies (stripping the trailing spaces +
// newline) and this test will fail.  That is the INTENDED guard.
// ---------------------------------------------------------------------------

Deno.test(
  "format: entry body with hard line break is preserved byte-identically (fallback guard — ADR-014 §Decision-2)",
  async () => {
    // The body contains a hard line break: two trailing spaces before \n.
    // render(buildBodyAst(body)) !== body for this construct, so the
    // formatter MUST take the string-fallback path, leaving it untouched.
    const input = [
      "# Test",
      "",
      "- [REQ-001] Hard-line-break requirement",
      "",
      "  This sentence ends here.  ",
      "  This continues on the next line.",
      "",
      "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
      "",
    ].join("\n");

    const pass1 = await runFormat({ "req.md": input });
    assertEquals(
      pass1.code,
      0,
      `format should succeed on a hard-line-break body; stderr: ${pass1.stderr}`,
    );

    const out1 = await pass1.readFile("req.md");

    // The hard line break (two trailing spaces before newline) must be intact.
    assertEquals(
      out1.includes("This sentence ends here.  \n"),
      true,
      `formatter must preserve the hard line break (two trailing spaces) byte-identically; got:\n${out1}`,
    );

    // Idempotency: a second pass must not touch the already-canonical file.
    const pass2 = await runFormat({ "req.md": out1 });
    const out2 = await pass2.readFile("req.md");
    assertEquals(
      out1,
      out2,
      "format must be idempotent on a body containing a hard line break",
    );
  },
);

// ---------------------------------------------------------------------------
// Line-ending tests — STK-WIN-0004.
//
// A CRLF source file must remain CRLF after `markspec format`; the
// formatter normalises `\r\n` → `\n` internally so entry bodies and
// AST nodes never carry a `\r`, then restores the original ending on
// write-back. A pure-LF file is never silently converted to CRLF.
// ---------------------------------------------------------------------------

Deno.test(
  "format: CRLF file round-trips byte-stable through format",
  async () => {
    const lfInput = [
      "# CRLF round-trip",
      "",
      "- [REQ-001] Sample requirement",
      "",
      "  The system shall preserve CRLF line endings on write-back.",
      "",
      "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
      "",
    ].join("\n");
    const crlfInput = lfInput.replace(/\n/g, "\r\n");

    const { code, readFile } = await runFormat({ "req.md": crlfInput });
    assertEquals(code, 0);

    const out = await readFile("req.md");
    // The file remains CRLF — no lone \n introduced, no \r dropped.
    assertEquals(
      out.includes("\r\n"),
      true,
      `output must keep CRLF line endings; got:\n${JSON.stringify(out)}`,
    );
    assertEquals(
      /(?<!\r)\n/.test(out),
      false,
      `output must not contain bare LF (would mix line endings); got:\n${
        JSON.stringify(out)
      }`,
    );
  },
);

Deno.test(
  "format: LF file is not silently converted to CRLF",
  async () => {
    const lfInput = [
      "# LF preservation",
      "",
      "- [REQ-002] LF-only requirement",
      "",
      "  The formatter shall not introduce carriage returns into a pure-LF file.",
      "",
      "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG",
      "",
    ].join("\n");

    const { code, readFile } = await runFormat({ "req.md": lfInput });
    assertEquals(code, 0);

    const out = await readFile("req.md");
    assertEquals(
      out.includes("\r"),
      false,
      `LF input must never grow a CR on output; got:\n${JSON.stringify(out)}`,
    );
  },
);

Deno.test(
  "format: CRLF file with missing ULID — stamped Id stays on its own CRLF-terminated line",
  async () => {
    // The formatter stamps a fresh ULID into the trailer. The new line
    // must use the source file's ending; without that, the line would
    // be CRLF...CRLF...LF...CRLF — mixed.
    const lfInput = [
      "- [REQ-003] Needs a ULID",
      "",
      "  The formatter shall stamp a ULID.",
      "",
      "      Id:",
      "",
    ].join("\n");
    const crlfInput = lfInput.replace(/\n/g, "\r\n");

    const { code, readFile } = await runFormat({ "req.md": crlfInput });
    assertEquals(code, 0);

    const out = await readFile("req.md");
    assertEquals(out.includes("\r\n"), true);
    assertEquals(/(?<!\r)\n/.test(out), false);
    // The stamped Id must be a valid ULID — i.e. format actually wrote
    // one rather than passing through the empty `Id:` line.
    assertStringIncludes(out, "Id: 01");
  },
);
