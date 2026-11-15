import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `\
name: io.test.project
version: "1.0.0"
`;

const SIMPLE_DOC = `\
# Test Document

This is a simple test document with **bold** and *italic* text.

## Section Two

A second section with a list:

- Item one
- Item two
- Item three
`;

// `markspec doc build` works on Windows even when the source document
// lives on a different drive than the bundled markspec-typst package
// (e.g., installed CLI on C:, docs on D:) — see `stageTypstPackage` in
// cli/commands/doc.ts for the cross-drive staging behaviour.
Deno.test("doc build: produces PDF from Markdown", async () => {
  const { code, stderr } = await markspec(["doc", "build", "doc.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      "doc.md": SIMPLE_DOC,
    },
    permissions: ["--allow-env", "--allow-ffi"],
  });

  assertEquals(code, 0, `expected exit 0, stderr: ${stderr}`);
  assertStringIncludes(stderr, "wrote");
});

Deno.test("doc build: output file has PDF magic bytes", async () => {
  // Create a temp dir manually to inspect the output file
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/project.yaml`, PROJECT_YAML);
    await Deno.writeTextFile(`${dir}/doc.md`, SIMPLE_DOC);

    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-ffi",
        fromFileUrl(
          new URL("../../packages/markspec/main.ts", import.meta.url),
        ),
        "doc",
        "build",
        "doc.md",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    });
    const result = await cmd.output();
    assertEquals(
      result.code,
      0,
      `exit ${result.code}: ${new TextDecoder().decode(result.stderr)}`,
    );

    // Check the output PDF exists and has valid header
    const pdf = await Deno.readFile(`${dir}/doc.pdf`);
    assert(
      pdf.length > 1000,
      `expected non-trivial PDF, got ${pdf.length} bytes`,
    );

    const header = new TextDecoder().decode(pdf.slice(0, 5));
    assertEquals(header, "%PDF-");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("doc build: --output flag writes to custom path", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/project.yaml`, PROJECT_YAML);
    await Deno.writeTextFile(`${dir}/doc.md`, SIMPLE_DOC);

    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-ffi",
        fromFileUrl(
          new URL("../../packages/markspec/main.ts", import.meta.url),
        ),
        "doc",
        "build",
        "--output",
        "custom-output.pdf",
        "doc.md",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    });
    const result = await cmd.output();
    assertEquals(
      result.code,
      0,
      `exit ${result.code}: ${new TextDecoder().decode(result.stderr)}`,
    );

    const pdf = await Deno.readFile(`${dir}/custom-output.pdf`);
    const header = new TextDecoder().decode(pdf.slice(0, 5));
    assertEquals(header, "%PDF-");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("doc build <file>: a Satisfies target in another file reports no MSL-L006 (#950)", async () => {
  const { code, stderr } = await markspec(["doc", "build", "doc.md"], {
    files: {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": "profiles:\n  - ./profiles/p\n",
      "profiles/p/markspec.yaml": `id: "@acme/doc-trace"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
      traceability:
        Satisfies:
          target: [requirement]
          cardinality: 0..3
          required: false
`,
      "doc.md": `# Doc

- [REQ-0001] First

  The system shall respond.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
      Satisfies: REQ-0900
`,
      "other.md": `- [REQ-0900] Elsewhere

  The system shall exist.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Type: requirement
`,
    },
    permissions: ["--allow-env", "--allow-ffi"],
  });
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("MSL-L006"), false, stderr);
});
