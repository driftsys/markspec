import { assertStringIncludes } from "@std/assert";
import { generateTypstDocument } from "./template.ts";
import type { DocumentMetadata } from "./template.ts";
import type { Entry } from "../../core/mod.ts";
import { makeDisplayId } from "../../core/mod.ts";

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

// ---------------------------------------------------------------------------
// Import prefix + image base prefix (relative-image support)
// ---------------------------------------------------------------------------

Deno.test("generateTypstDocument: applies typstPackageImportPrefix to imports", () => {
  const result = generateTypstDocument(
    "content",
    {},
    [],
    "/driftsys/markspec/packages/markspec-typst/",
  );
  assertStringIncludes(
    result,
    '#import "/driftsys/markspec/packages/markspec-typst/lib.typ":',
  );
  assertStringIncludes(
    result,
    '#import "/driftsys/markspec/packages/markspec-typst/vendor/cmarker/lib.typ":',
  );
});

Deno.test("generateTypstDocument: emits ms-image scope binding when imageBasePrefix set", () => {
  const result = generateTypstDocument(
    "![alt](asset.svg)",
    {},
    [],
    "",
    "/asdk/project/docs/",
  );
  // ms-image wrapper is defined
  assertStringIncludes(result, "#let ms-image(src, alt: none, ..args)");
  // The base prefix is embedded
  assertStringIncludes(result, '"/asdk/project/docs/" + src');
  // render() is called with the scope override
  assertStringIncludes(result, "scope: (image: ms-image)");
});

Deno.test("generateTypstDocument: no ms-image binding when imageBasePrefix empty", () => {
  const result = generateTypstDocument("![alt](asset.svg)", {}, [], "", "");
  if (result.includes("ms-image")) {
    throw new Error("ms-image should not appear when imageBasePrefix is empty");
  }
  if (result.includes("scope: (image:")) {
    throw new Error(
      "render() should not carry a scope override when no imageBasePrefix",
    );
  }
});

// ---------------------------------------------------------------------------
// Entry rendering — color: argument
// ---------------------------------------------------------------------------

/** Minimal identified entry fixture for template tests. */
function makeIdentifiedEntry(
  { displayId, ...overrides }: Partial<Omit<Entry, "displayId">> & {
    displayId?: string;
  } = {},
): Entry {
  return {
    displayId: makeDisplayId(displayId ?? "STK_0001"),
    title: "Test requirement",
    body: "The system shall do something.",
    rawAttributes: [],
    typedAttributes: new Map(),
    id: "01HGABCDEFGHJKMNPQRSTVWXYZ",
    shape: "Authored",
    source: { kind: "markdown" },
    location: { file: "test.md", line: 1, column: 1 },
    bodyTokens: [],
    ...overrides,
  };
}

/** Minimal referenced entry fixture. */
function makeReferencedEntry(
  { displayId, ...overrides }: Partial<Omit<Entry, "displayId">> & {
    displayId?: string;
  } = {},
): Entry {
  return {
    displayId: makeDisplayId(displayId ?? "EXT_0001"),
    title: "External reference",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    id: "https://example.com/ext/0001",
    shape: "Reference",
    source: { kind: "markdown" },
    location: { file: "test.md", line: 1, column: 1 },
    bodyTokens: [],
    ...overrides,
  };
}

Deno.test('generateTypstDocument: identified entry without profile emits color: "blue"', () => {
  const entry = makeIdentifiedEntry();
  // Build minimal markdown that matches the entry's line 1
  const markdown =
    `- [STK_0001] Test requirement\n\n  The system shall do something.\n\n  Id: 01HGABCDEFGHJKMNPQRSTVWXYZ \\\n`;
  const result = generateTypstDocument(markdown, {}, [entry]);
  assertStringIncludes(result, 'color: "blue"');
});

Deno.test("generateTypstDocument: referenced entry emits color: none", () => {
  const entry = makeReferencedEntry();
  const markdown =
    `- [EXT_0001] External reference\n\n  Id: https://example.com/ext/0001 \\\n`;
  const result = generateTypstDocument(markdown, {}, [entry]);
  assertStringIncludes(result, "color: none");
});

Deno.test("generateTypstDocument: identified entry does not emit legacy type: argument", () => {
  const entry = makeIdentifiedEntry();
  const markdown =
    `- [STK_0001] Test requirement\n\n  The system shall do something.\n\n  Id: 01HGABCDEFGHJKMNPQRSTVWXYZ \\\n`;
  const result = generateTypstDocument(markdown, {}, [entry]);
  // The old "type:" argument should no longer appear in req-block calls
  if (
    result.includes('type: "req"') || result.includes('type: "spec"') ||
    result.includes('type: "test"')
  ) {
    throw new Error("Legacy type: category argument found in output");
  }
});
