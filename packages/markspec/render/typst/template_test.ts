import { assertStringIncludes } from "@std/assert";
import { generateTypstDocument } from "./template.ts";
import type { DocumentMetadata } from "./template.ts";

Deno.test("generateTypstDocument: imports markspec-doc and cmarker", () => {
  const result = generateTypstDocument("Hello world");
  assertStringIncludes(result, '#import "lib.typ": markspec-doc');
  assertStringIncludes(result, '#import "vendor/cmarker/lib.typ": render');
});

Deno.test("generateTypstDocument: applies show rule with metadata", () => {
  const metadata: DocumentMetadata = {
    title: "Test Document",
    project: "io.driftsys.markspec",
    version: "1.0.0",
  };
  const result = generateTypstDocument("# Hello", metadata);
  assertStringIncludes(result, 'title: "Test Document"');
  assertStringIncludes(result, 'project: "io.driftsys.markspec"');
  assertStringIncludes(result, 'version: "1.0.0"');
  assertStringIncludes(result, "#show: markspec-doc.with(");
});

Deno.test("generateTypstDocument: renders markdown via cmarker", () => {
  const result = generateTypstDocument("# Chapter\n\nSome text.");
  assertStringIncludes(result, '#render("');
  assertStringIncludes(result, "# Chapter");
  assertStringIncludes(result, "Some text.");
});

Deno.test("generateTypstDocument: escapes special characters", () => {
  const result = generateTypstDocument('He said "hello" \\ world');
  // Backslashes and quotes should be escaped in the Typst string
  assertStringIncludes(result, 'He said \\"hello\\" \\\\ world');
});

Deno.test("generateTypstDocument: handles empty metadata", () => {
  const result = generateTypstDocument("content");
  // Empty metadata should produce no arguments
  assertStringIncludes(result, "#show: markspec-doc.with()");
});

Deno.test("generateTypstDocument: formats date as datetime", () => {
  const result = generateTypstDocument("content", {
    date: "2026-03-30",
  });
  assertStringIncludes(
    result,
    "date: datetime(year: 2026, month: 3, day: 30)",
  );
});

Deno.test("generateTypstDocument: handles multiline markdown", () => {
  const md = "# Title\n\nParagraph one.\n\n## Section\n\nParagraph two.";
  const result = generateTypstDocument(md);
  // Newlines should be escaped in the string
  assertStringIncludes(result, "\\n");
  // But the content should be present
  assertStringIncludes(result, "# Title");
  assertStringIncludes(result, "## Section");
});
