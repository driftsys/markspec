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

  const result = parseSource(source, { file: "src/braking.rs", language });
  assertEquals(result.entries.length, 1);
  assertEquals(result.entries[0].displayId, "SRS_BRK_0001");
  assertEquals(result.entries[0].title, "Sensor input debouncing");
  assertEquals(result.entries[0].id, "SRS_01HGW2Q8MNP3");
  assertEquals(result.entries[0].entryType, "SRS");
  assertEquals(result.entries[0].source, "doc-comment");
  assertEquals(result.entries[0].location.file, "src/braking.rs");
  assertEquals(result.entries[0].location.line, 1);
  assertEquals(result.entries[0].location.column, 1);
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

  const { entries } = parseSource(source, { file: "test.rs", language });
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

  const { entries } = parseSource(source, { file: "test.rs", language });
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

  const { entries } = parseSource(source, { file: "test.rs", language });
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

  const { entries } = parseSource(source, { file: "test.rs", language });
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

  const { entries } = parseSource(source, { file: "test.rs", language });
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

  const { entries } = parseSource(source, { file: "test.rs", language });
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

  const { entries } = parseSource(source, { file: "test.rs", language });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  assertStringIncludes(entries[0].body, "gherkin");
});

Deno.test("parseSource: returns empty for file with no doc comments", async () => {
  const language = await getRustLanguage();
  const source = `fn foo() {}
fn bar() {}
`;

  const { entries } = parseSource(source, { file: "test.rs", language });
  assertEquals(entries.length, 0);
});

Deno.test("parseSource: returns empty for empty source", async () => {
  const language = await getRustLanguage();
  const { entries } = parseSource("", { file: "test.rs", language });
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
  const { entries } = parseSource(content, {
    file: "in-code-rust.rs",
    language,
  });

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

  const { entries } = parseSource(source, { file: "test.rs", language });
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

    const { entries } = parseSource(source, { file: "test.rs", language });
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

  const { entries } = parseSource(source, { language });
  assertEquals(entries[0].location.file, "<unknown>");
});

// ---------------------------------------------------------------------------
// Rust: standalone annotations (Verifies/Implements)
// ---------------------------------------------------------------------------

Deno.test("parseSource: extracts Verifies annotation", async () => {
  const language = await getRustLanguage();
  const source = `/// Verifies: STK_AEB_0001
#[test]
fn val_aeb_0001_vehicle_stops() {}
`;

  const { entries, links } = parseSource(source, { file: "test.rs", language });
  assertEquals(entries.length, 0);
  assertEquals(links.length, 1);
  assertEquals(links[0].kind, "verifies");
  assertEquals(links[0].to, "STK_AEB_0001");
  assertEquals(links[0].from, "val_aeb_0001_vehicle_stops");
});

Deno.test("parseSource: extracts Implements annotation", async () => {
  const language = await getRustLanguage();
  const source = `/// Implements: SRS_BRK_0001
fn impl_braking() {}
`;

  const { entries, links } = parseSource(source, { file: "test.rs", language });
  assertEquals(entries.length, 0);
  assertEquals(links.length, 1);
  assertEquals(links[0].kind, "implements");
  assertEquals(links[0].to, "SRS_BRK_0001");
  assertEquals(links[0].from, "impl_braking");
});

Deno.test("parseSource: extracts comma-separated annotation targets", async () => {
  const language = await getRustLanguage();
  const source = `/// Verifies: STK_AEB_0001, STK_AEB_0002
#[test]
fn val_aeb_both() {}
`;

  const { links } = parseSource(source, { file: "test.rs", language });
  assertEquals(links.length, 2);
  assertEquals(links[0].to, "STK_AEB_0001");
  assertEquals(links[1].to, "STK_AEB_0002");
});

Deno.test("parseSource: mixed entries and annotations", async () => {
  const language = await getRustLanguage();
  const source = `/// [SRS_BRK_0001] Brake pressure
///
/// Body text.
///
/// Id: SRS_01HGW2Q8MNP3
fn brake() {}

/// Verifies: SRS_BRK_0001
#[test]
fn swt_brk_0001() {}
`;

  const { entries, links } = parseSource(source, { file: "test.rs", language });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  assertEquals(links.length, 1);
  assertEquals(links[0].kind, "verifies");
  assertEquals(links[0].to, "SRS_BRK_0001");
});

Deno.test("parseSource: annotation inside entry block is attribute, not link", async () => {
  const language = await getRustLanguage();
  const source = `/// [SRS_BRK_0001] Title
///
/// Body text.
///
/// Id: SRS_01HGW2Q8MNP3 \\
/// Verifies: STK_BRK_0001
fn foo() {}
`;

  const { entries, links } = parseSource(source, { file: "test.rs", language });
  assertEquals(entries.length, 1);
  assertEquals(links.length, 0);
  // Verifies is an attribute on the entry, not a standalone link.
  const verifies = entries[0].attributes.find((a) => a.key === "Verifies");
  assertEquals(verifies?.value, "STK_BRK_0001");
});

Deno.test("parseSource: annotation fallback from when no function name", async () => {
  const language = await getRustLanguage();
  const source = `/// Verifies: STK_AEB_0001
`;

  const { links } = parseSource(source, { file: "test.rs", language });
  assertEquals(links.length, 1);
  assertEquals(links[0].from, "test.rs:1");
});

Deno.test("parseSource: fixture — in-code-rust-annotations.rs", async () => {
  const language = await getRustLanguage();
  const fixturePath = join(
    import.meta.dirname!,
    "..",
    "..",
    "..",
    "..",
    "tests",
    "fixtures",
    "in-code-rust-annotations.rs",
  );
  const content = await Deno.readTextFile(fixturePath);
  const { entries, links } = parseSource(content, {
    file: "in-code-rust-annotations.rs",
    language,
  });

  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0010");
  assertEquals(links.length, 4); // 1 Verifies + 2 Implements + 1 Verifies
  assertEquals(links[0].kind, "verifies");
  assertEquals(links[0].to, "STK_AEB_0001");
  assertEquals(links[1].kind, "implements");
  assertEquals(links[1].to, "SRS_BRK_0001");
  assertEquals(links[2].kind, "implements");
  assertEquals(links[2].to, "SRS_BRK_0002");
  assertEquals(links[3].kind, "verifies");
  assertEquals(links[3].to, "SRS_BRK_0010");
});
