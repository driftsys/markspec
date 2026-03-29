/**
 * @module parser/source_test
 *
 * Unit tests for source-code doc comment entry extraction.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import Parser from "web-tree-sitter";
import { join } from "@std/path";
import { parseSource } from "./source.ts";

// ---------------------------------------------------------------------------
// Setup: load Rust grammar once for all tests
// ---------------------------------------------------------------------------

const grammarsDir = join(
  import.meta.dirname!,
  "..",
  "..",
  "..",
  "..",
  "grammars",
);
let rustLanguage: Parser.Language;

async function getRustLanguage(): Promise<Parser.Language> {
  if (rustLanguage) return rustLanguage;
  await Parser.init();
  rustLanguage = await Parser.Language.load(
    join(grammarsDir, "tree-sitter-rust.wasm"),
  );
  return rustLanguage;
}

// ---------------------------------------------------------------------------
// Rust: basic entry extraction
// ---------------------------------------------------------------------------

Deno.test("parseSource: extracts Rust doc comment entry", async () => {
  const language = await getRustLanguage();
  const source = `/// [SRS_BRK_0001] Sensor input debouncing
///
/// The sensor driver shall reject transient noise.
///
/// Id: SRS_01HGW2Q8MNP3 \\
/// Satisfies: SYS_BRK_0042 \\
/// Labels: ASIL-B
#[test]
fn swt_brk_0001() {}
`;

  const entries = parseSource(source, { file: "src/braking.rs", language });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  assertEquals(entries[0].title, "Sensor input debouncing");
  assertEquals(entries[0].id, "SRS_01HGW2Q8MNP3");
  assertEquals(entries[0].entryType, "SRS");
  assertEquals(entries[0].source, "doc-comment");
  assertEquals(entries[0].location.file, "src/braking.rs");
  assertEquals(entries[0].location.line, 1);
  assertEquals(entries[0].location.column, 1);
});

Deno.test("parseSource: extracts body from Rust doc comment", async () => {
  const language = await getRustLanguage();
  const source = `/// [SRS_BRK_0001] Title
///
/// The sensor driver shall reject transient noise.
///
/// Id: SRS_01HGW2Q8MNP3
fn foo() {}
`;

  const entries = parseSource(source, { file: "test.rs", language });
  assertEquals(entries.length, 1);
  assertStringIncludes(entries[0].body, "reject transient noise");
});

Deno.test("parseSource: extracts attributes from Rust doc comment", async () => {
  const language = await getRustLanguage();
  const source = `/// [SRS_BRK_0001] Title
///
/// Body text.
///
/// Id: SRS_01HGW2Q8MNP3 \\
/// Satisfies: SYS_BRK_0042 \\
/// Labels: ASIL-B
fn foo() {}
`;

  const entries = parseSource(source, { file: "test.rs", language });
  assertEquals(entries[0].attributes.length, 3);
  assertEquals(entries[0].attributes[0].key, "Id");
  assertEquals(entries[0].attributes[0].value, "SRS_01HGW2Q8MNP3");
  assertEquals(entries[0].attributes[1].key, "Satisfies");
  assertEquals(entries[0].attributes[1].value, "SYS_BRK_0042");
  assertEquals(entries[0].attributes[2].key, "Labels");
  assertEquals(entries[0].attributes[2].value, "ASIL-B");
});

// ---------------------------------------------------------------------------
// Rust: multiple entries
// ---------------------------------------------------------------------------

Deno.test("parseSource: extracts multiple Rust doc comment entries", async () => {
  const language = await getRustLanguage();
  const source = `/// [SRS_BRK_0001] First entry
///
/// Body one.
///
/// Id: SRS_01HGW2Q8MNP3
fn first() {}

/// [SRS_BRK_0002] Second entry
///
/// Body two.
///
/// Id: SRS_01HGW2R9QLP4
fn second() {}
`;

  const entries = parseSource(source, { file: "test.rs", language });
  assertEquals(entries.length, 2);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  assertEquals(entries[1].displayId, "SRS_BRK_0002");
});

// ---------------------------------------------------------------------------
// Rust: source location
// ---------------------------------------------------------------------------

Deno.test("parseSource: preserves source location for offset entries", async () => {
  const language = await getRustLanguage();
  const source = `fn preamble() {}

/// [SRS_BRK_0001] Title
///
/// Body text.
///
/// Id: SRS_01HGW2Q8MNP3
fn foo() {}
`;

  const entries = parseSource(source, { file: "test.rs", language });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].location.line, 3);
  assertEquals(entries[0].location.column, 1);
});

// ---------------------------------------------------------------------------
// Rust: non-entry doc comments ignored
// ---------------------------------------------------------------------------

Deno.test("parseSource: ignores regular doc comments without entry ID", async () => {
  const language = await getRustLanguage();
  const source = `/// This is just a regular doc comment.
/// It does not contain a MarkSpec entry.
fn documented() {}

/// [SRS_BRK_0001] Actual entry
///
/// Body text.
///
/// Id: SRS_01HGW2Q8MNP3
fn entry() {}
`;

  const entries = parseSource(source, { file: "test.rs", language });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
});

Deno.test("parseSource: ignores regular // comments", async () => {
  const language = await getRustLanguage();
  const source = `// Regular comment
// Not a doc comment
fn foo() {}

/// [SRS_BRK_0001] Entry
///
/// Body.
///
/// Id: SRS_01HGW2Q8MNP3
fn bar() {}
`;

  const entries = parseSource(source, { file: "test.rs", language });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
});

// ---------------------------------------------------------------------------
// Rust: empty doc comments and edge cases
// ---------------------------------------------------------------------------

Deno.test("parseSource: handles doc comment with code block", async () => {
  const language = await getRustLanguage();
  const source = `/// [SRS_BRK_0001] Title
///
/// Body text with code:
///
/// \`\`\`gherkin
/// Scenario: Test
///   Given something
///   Then result
/// \`\`\`
///
/// Id: SRS_01HGW2Q8MNP3
fn foo() {}
`;

  const entries = parseSource(source, { file: "test.rs", language });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  assertStringIncludes(entries[0].body, "gherkin");
});

Deno.test("parseSource: returns empty for file with no doc comments", async () => {
  const language = await getRustLanguage();
  const source = `fn foo() {}
fn bar() {}
`;

  const entries = parseSource(source, { file: "test.rs", language });
  assertEquals(entries.length, 0);
});

Deno.test("parseSource: returns empty for empty source", async () => {
  const language = await getRustLanguage();
  const entries = parseSource("", { file: "test.rs", language });
  assertEquals(entries.length, 0);
});

// ---------------------------------------------------------------------------
// Rust: fixture file
// ---------------------------------------------------------------------------

Deno.test("parseSource: fixture — in-code-rust.rs", async () => {
  const language = await getRustLanguage();
  const fixturePath = join(
    import.meta.dirname!,
    "..",
    "..",
    "..",
    "..",
    "tests",
    "fixtures",
    "in-code-rust.rs",
  );
  const content = await Deno.readTextFile(fixturePath);
  const entries = parseSource(content, { file: "in-code-rust.rs", language });

  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  assertEquals(entries[0].title, "Sensor input debouncing");
  assertEquals(entries[0].id, "SRS_01HGW2Q8MNP3");
  assertEquals(entries[0].source, "doc-comment");
  assertStringIncludes(entries[0].body, "debounce window");
  assertEquals(entries[0].attributes.length, 3);
});

// ---------------------------------------------------------------------------
// Rust: nested mod blocks
// ---------------------------------------------------------------------------

Deno.test("parseSource: extracts entries inside mod blocks", async () => {
  const language = await getRustLanguage();
  const source = `mod tests {
    /// [SRS_BRK_0001] Nested entry
    ///
    /// Body inside mod.
    ///
    /// Id: SRS_01HGW2Q8MNP3
    #[test]
    fn test_one() {}
}
`;

  const entries = parseSource(source, { file: "test.rs", language });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  assertStringIncludes(entries[0].body, "inside mod");
  assertEquals(entries[0].location.line, 2);
  assertEquals(entries[0].location.column, 5);
});

Deno.test(
  "parseSource: extracts entries from both top-level and nested",
  async () => {
    const language = await getRustLanguage();
    const source = `/// [SRS_BRK_0001] Top-level entry
///
/// Body one.
///
/// Id: SRS_01HGW2Q8MNP3
fn top() {}

mod tests {
    /// [SRS_BRK_0002] Nested entry
    ///
    /// Body two.
    ///
    /// Id: SRS_01HGW2R9QLP4
    #[test]
    fn nested() {}
}
`;

    const entries = parseSource(source, { file: "test.rs", language });
    assertEquals(entries.length, 2);
    assertEquals(entries[0].displayId, "SRS_BRK_0001");
    assertEquals(entries[1].displayId, "SRS_BRK_0002");
  },
);

// ---------------------------------------------------------------------------
// Default file path
// ---------------------------------------------------------------------------

Deno.test("parseSource: uses '<unknown>' when no file specified", async () => {
  const language = await getRustLanguage();
  const source = `/// [SRS_BRK_0001] Title
///
/// Body.
///
/// Id: SRS_01HGW2Q8MNP3
fn foo() {}
`;

  const entries = parseSource(source, { language });
  assertEquals(entries[0].location.file, "<unknown>");
});
