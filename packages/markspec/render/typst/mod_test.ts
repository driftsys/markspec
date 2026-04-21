import { assert, assertEquals } from "@std/assert";
import { compileTypst } from "./mod.ts";

const WORKSPACE = new URL(
  "../../../markspec-typst/",
  import.meta.url,
).pathname;

const FONT_PATH = new URL(
  "../../../markspec-typst/fonts/",
  import.meta.url,
).pathname;

Deno.test("compileTypst: compiles simple Typst to PDF", () => {
  const source = `#set page(width: 210mm, height: 297mm)
Hello, Typst!`;

  const result = compileTypst(source, {
    workspace: WORKSPACE,
    fontPaths: [FONT_PATH],
  });

  assertEquals(result.diagnostics.length, 0);
  assert(result.pdf !== undefined, "expected PDF output");
  assert(result.pdf.length > 100, "expected non-trivial PDF");

  // Check PDF magic bytes
  const header = new TextDecoder().decode(result.pdf.slice(0, 5));
  assertEquals(header, "%PDF-");
});

Deno.test("compileTypst: compiles with markspec-doc template", () => {
  const source = `#import "lib.typ": markspec-doc
#show: markspec-doc.with(title: "Test Document", project: "test", version: "1.0")

Hello from markspec-doc template.`;

  const result = compileTypst(source, {
    workspace: WORKSPACE,
    fontPaths: [FONT_PATH],
  });

  assertEquals(
    result.diagnostics.map((d) => d.message),
    [],
    "expected no diagnostics",
  );
  assert(result.pdf !== undefined, "expected PDF output");

  const header = new TextDecoder().decode(result.pdf.slice(0, 5));
  assertEquals(header, "%PDF-");
});

Deno.test("compileTypst: compiles with cmarker", () => {
  const source = `#import "lib.typ": markspec-doc
#import "vendor/cmarker/lib.typ": render

#show: markspec-doc.with(title: "Cmarker Test")

#render("# Hello World\\n\\nThis is **bold** and *italic*.")`;

  const result = compileTypst(source, {
    workspace: WORKSPACE,
    fontPaths: [FONT_PATH],
  });

  assertEquals(
    result.diagnostics.map((d) => d.message),
    [],
    "expected no diagnostics from cmarker",
  );
  assert(result.pdf !== undefined, "expected PDF output");
  assert(result.pdf.length > 1000, "expected PDF with content");
});

Deno.test("compileTypst: reports error for invalid Typst", () => {
  const source = "#undefined-function()";

  const result = compileTypst(source, {
    workspace: WORKSPACE,
    fontPaths: [FONT_PATH],
  });

  assert(result.diagnostics.length > 0, "expected diagnostics");
  assertEquals(result.pdf, undefined);
});

Deno.test("compileTypst: mainFilePath lets relative paths resolve from source dir", async () => {
  // Create a temp SVG in a scratch directory, then compile a Typst source
  // that references it relatively. Without `mainFilePath`, the path would
  // resolve from the workspace root and fail; with `mainFilePath` pointing
  // at a shadow file next to the SVG, it resolves correctly.
  const tempDir = await Deno.makeTempDir();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>`;
  await Deno.writeTextFile(`${tempDir}/chart.svg`, svg);

  try {
    const source = `#image("chart.svg", width: 10pt)`;
    const result = compileTypst(source, {
      workspace: tempDir,
      fontPaths: [FONT_PATH],
      mainFilePath: `${tempDir}/main.typ`,
    });

    assertEquals(
      result.diagnostics.map((d) => d.message),
      [],
      "expected no diagnostics when relative SVG resolves from source dir",
    );
    assert(result.pdf !== undefined, "expected PDF output");
    assert(result.pdf.length > 100, "expected non-trivial PDF");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
