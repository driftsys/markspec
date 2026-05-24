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
// Setup: load grammars once per language for all tests
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

let javaLanguage: Parser.Language;

async function getJavaLanguage(): Promise<Parser.Language> {
  if (javaLanguage) return javaLanguage;
  await Parser.init();
  javaLanguage = await Parser.Language.load(
    join(grammarsDir, "tree-sitter-java.wasm"),
  );
  return javaLanguage;
}

let kotlinLanguage: Parser.Language;

async function getKotlinLanguage(): Promise<Parser.Language> {
  if (kotlinLanguage) return kotlinLanguage;
  await Parser.init();
  kotlinLanguage = await Parser.Language.load(
    join(grammarsDir, "tree-sitter-kotlin.wasm"),
  );
  return kotlinLanguage;
}

let cppLanguage: Parser.Language;

async function getCppLanguage(): Promise<Parser.Language> {
  if (cppLanguage) return cppLanguage;
  await Parser.init();
  cppLanguage = await Parser.Language.load(
    join(grammarsDir, "tree-sitter-cpp.wasm"),
  );
  return cppLanguage;
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
///     Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
///     Satisfies: SYS_BRK_0042
///     Labels: ASIL-B
#[test]
fn swt_brk_0001() {}
`;

  const result = parseSource(source, {
    file: "src/braking.rs",
    language,
    languageId: "rust",
  });
  assertEquals(result.entries.length, 1);
  assertEquals(result.entries[0].displayId, "SRS_BRK_0001");
  assertEquals(result.entries[0].title, "Sensor input debouncing");
  assertEquals(result.entries[0].id, "01HGW2Q8MNP3RSTVWXYZABCDEF");
  assertEquals(result.entries[0].shape, "Authored");
  assertEquals(result.entries[0].source, "doc-comment");
  assertEquals(result.entries[0].location.file, "src/braking.rs");
  assertEquals(result.entries[0].location.line, 1);
  assertEquals(result.entries[0].location.column, 1);

  // NEW: bodyTokens is non-empty and file-relative.
  const modals = result.entries[0].bodyTokens.filter(
    (t) => t.kind === "modal",
  );
  assertEquals(modals.length, 1);
  assertEquals(modals[0].text, "shall");
  // "shall" appears on source line 3 ("/// The sensor driver shall reject…").
  assertEquals(modals[0].location.line, 3);
  // "shall" starts at source column 23.
  // (/// = 3 chars, space = 1, "The sensor driver " = 18 chars, then 's')
  // → 3 + 1 + 18 + 1 = 23.
  assertEquals(modals[0].location.column, 23);
  assertEquals(modals[0].location.file, "src/braking.rs");
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

  const { entries } = parseSource(source, {
    file: "test.rs",
    language,
    languageId: "rust",
  });
  assertEquals(entries.length, 1);
  assertStringIncludes(entries[0].body, "reject transient noise");
});

Deno.test("parseSource: extracts attributes from Rust doc comment", async () => {
  const language = await getRustLanguage();
  const source = `/// [SRS_BRK_0001] Title
///
/// Body text.
///
///     Id: SRS_01HGW2Q8MNP3
///     Satisfies: SYS_BRK_0042
///     Labels: ASIL-B
fn foo() {}
`;

  const { entries } = parseSource(source, {
    file: "test.rs",
    language,
    languageId: "rust",
  });
  assertEquals(entries[0].rawAttributes.length, 3);
  assertEquals(entries[0].rawAttributes[0].key, "Id");
  assertEquals(entries[0].rawAttributes[0].value, "SRS_01HGW2Q8MNP3");
  assertEquals(entries[0].rawAttributes[1].key, "Satisfies");
  assertEquals(entries[0].rawAttributes[1].value, "SYS_BRK_0042");
  assertEquals(entries[0].rawAttributes[2].key, "Labels");
  assertEquals(entries[0].rawAttributes[2].value, "ASIL-B");
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

  const { entries } = parseSource(source, {
    file: "test.rs",
    language,
    languageId: "rust",
  });
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

  const { entries } = parseSource(source, {
    file: "test.rs",
    language,
    languageId: "rust",
  });
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

  const { entries } = parseSource(source, {
    file: "test.rs",
    language,
    languageId: "rust",
  });
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

  const { entries } = parseSource(source, {
    file: "test.rs",
    language,
    languageId: "rust",
  });
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

  const { entries } = parseSource(source, {
    file: "test.rs",
    language,
    languageId: "rust",
  });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  assertStringIncludes(entries[0].body, "gherkin");
});

Deno.test("parseSource: returns empty for file with no doc comments", async () => {
  const language = await getRustLanguage();
  const source = `fn foo() {}
fn bar() {}
`;

  const { entries } = parseSource(source, {
    file: "test.rs",
    language,
    languageId: "rust",
  });
  assertEquals(entries.length, 0);
});

Deno.test("parseSource: returns empty for empty source", async () => {
  const language = await getRustLanguage();
  const { entries } = parseSource("", {
    file: "test.rs",
    language,
    languageId: "rust",
  });
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
    languageId: "rust",
  });

  // Two entries: the /// block (SRS_BRK_0001) and the //! block (SRS_BRK_0002).
  assertEquals(entries.length, 2);
  const first = entries.find((e) => e.displayId === "SRS_BRK_0001")!;
  assertEquals(first.displayId, "SRS_BRK_0001");
  assertEquals(first.title, "Sensor input debouncing");
  assertEquals(first.id, "SRS_01HGW2Q8MNP3");
  assertEquals(first.source, "doc-comment");
  assertStringIncludes(first.body, "debounce window");
  assertEquals(first.rawAttributes.length, 3);
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

  const { entries } = parseSource(source, {
    file: "test.rs",
    language,
    languageId: "rust",
  });
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

    const { entries } = parseSource(source, {
      file: "test.rs",
      language,
      languageId: "rust",
    });
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

  const { entries } = parseSource(source, { language, languageId: "rust" });
  assertEquals(entries[0].location.file, "<unknown>");
});

// ---------------------------------------------------------------------------
// Traceability surface
// ---------------------------------------------------------------------------

Deno.test("parseSource: links is always empty under the four-family model", async () => {
  const language = await getRustLanguage();
  const source = `/// [SRS_BRK_0001] Title
///
/// Body text.
///
///     Id: SRS_01HGW2Q8MNP3
///     Verifies: STK_BRK_0001
fn foo() {}
`;

  const { entries } = parseSource(source, {
    file: "test.rs",
    language,
    languageId: "rust",
  });
  assertEquals(entries.length, 1);
  // Verifies inside the entry block becomes an attribute.
  const verifies = entries[0].rawAttributes.find((a) => a.key === "Verifies");
  assertEquals(verifies?.value, "STK_BRK_0001");
});

Deno.test("parseSource: Gherkin tokens in Rust fixture are file-relative", async () => {
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
    languageId: "rust",
  });
  // Two entries: the /// block (SRS_BRK_0001) and the //! block (SRS_BRK_0002).
  assertEquals(entries.length, 2);
  // The fixture's Gherkin block is in the first entry (SRS_BRK_0001).
  const first = entries.find((e) => e.displayId === "SRS_BRK_0001")!;
  // The fixture's Gherkin block starts with "Scenario: Noise spike..."
  // on source line 7 (after the title, blank, body, blank, ```gherkin).
  // Verify the "Scenario" gherkin-section token is at the expected
  // file-relative position.
  const sections = first.bodyTokens.filter(
    (t) => t.kind === "gherkin-section",
  );
  // The fixture contains "Scenario:" twice — both should be present.
  assertEquals(sections.length, 2);
  // First "Scenario" is on source line 7, after "/// " (4 chars), so col 5.
  assertEquals(sections[0].text, "Scenario");
  assertEquals(sections[0].location.line, 7);
  assertEquals(sections[0].location.column, 5);
  assertEquals(sections[0].location.file, "in-code-rust.rs");
});

Deno.test("parseSource: doc comments without entry blocks produce no entries", async () => {
  const language = await getRustLanguage();
  const source = `/// Verifies: STK_AEB_0001
#[test]
fn val_aeb_0001_vehicle_stops() {}
`;

  const { entries } = parseSource(source, {
    file: "test.rs",
    language,
    languageId: "rust",
  });
  assertEquals(entries.length, 0);
});

// ---------------------------------------------------------------------------
// Rust: //! inner doc comment
// ---------------------------------------------------------------------------

Deno.test("parseSource: extracts Rust //! inner doc comment entry", async () => {
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
    languageId: "rust",
  });
  // Two entries: the original /// block and the new //! block.
  assertEquals(entries.length, 2);
  const inner = entries.find((e) => e.displayId === "SRS_BRK_0002");
  assertEquals(inner?.title, "Module-level sensor debouncing policy");
  // bodyTokens for the //! entry's "must" modal.
  // Source line 30: "//! All sensor drivers in this module must apply..."
  // prefixWidth = 4 ("//! "), buffer col of "must":
  //   "  All sensor drivers in this module " = 2 + 34 = 36 chars, so col 37.
  // File column = (37 - 2) + 4 = 39.
  const modals = inner!.bodyTokens.filter((t) => t.kind === "modal");
  assertEquals(modals.length, 1);
  assertEquals(modals[0].text, "must");
  assertEquals(modals[0].location.line, 30);
  assertEquals(modals[0].location.column, 39);
});

// ---------------------------------------------------------------------------
// Java: /** */ doc comment
// ---------------------------------------------------------------------------

Deno.test("parseSource: extracts Java /** */ doc comment entry", async () => {
  const language = await getJavaLanguage();
  const fixturePath = join(
    import.meta.dirname!,
    "..",
    "..",
    "..",
    "..",
    "tests",
    "fixtures",
    "in-code-java.java",
  );
  const content = await Deno.readTextFile(fixturePath);
  const { entries } = parseSource(content, {
    file: "in-code-java.java",
    language,
    languageId: "java",
  });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  assertEquals(entries[0].title, "Sensor input debouncing");

  // bodyTokens file-relative check: "shall" appears on source line 4
  // (" * The sensor driver shall reject..."). Prefix " * " stripped (3 chars).
  // Buffer line 3: "  The sensor driver shall..." — "shall" at buffer col 21.
  // File column = (21 - 2) + 3 = 22.
  const modals = entries[0].bodyTokens.filter((t) => t.kind === "modal");
  assertEquals(modals.length, 1);
  assertEquals(modals[0].text, "shall");
  assertEquals(modals[0].location.line, 4);
  assertEquals(modals[0].location.column, 22);
});

// ---------------------------------------------------------------------------
// Kotlin: /** */ doc comment
// ---------------------------------------------------------------------------

Deno.test("parseSource: extracts Kotlin /** */ doc comment entry", async () => {
  const language = await getKotlinLanguage();
  const fixturePath = join(
    import.meta.dirname!,
    "..",
    "..",
    "..",
    "..",
    "tests",
    "fixtures",
    "in-code-kotlin.kt",
  );
  const content = await Deno.readTextFile(fixturePath);
  const { entries } = parseSource(content, {
    file: "in-code-kotlin.kt",
    language,
    languageId: "kotlin",
  });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");

  // The Kotlin fixture has the same /** */ shape as the Java fixture.
  // Source line 4: " * The sensor driver shall reject..."
  // Prefix " * " stripped (3 chars). Buffer line 3: "  The sensor driver shall..."
  // "shall" at buffer col 21. File column = (21 - 2) + 3 = 22.
  const modals = entries[0].bodyTokens.filter((t) => t.kind === "modal");
  assertEquals(modals.length, 1);
  assertEquals(modals[0].text, "shall");
  assertEquals(modals[0].location.line, 4);
  assertEquals(modals[0].location.column, 22);
});

// ---------------------------------------------------------------------------
// C++: /** */ doc comment
// ---------------------------------------------------------------------------

Deno.test("parseSource: extracts C++ /** */ doc comment entry", async () => {
  const language = await getCppLanguage();
  const fixturePath = join(
    import.meta.dirname!,
    "..",
    "..",
    "..",
    "..",
    "tests",
    "fixtures",
    "in-code-cpp.cpp",
  );
  const content = await Deno.readTextFile(fixturePath);
  const { entries } = parseSource(content, {
    file: "in-code-cpp.cpp",
    language,
    languageId: "cpp",
  });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");

  // Same fixture shape as Java → same expected position.
  // Source line 4: " * The sensor driver shall reject..."
  // Prefix " * " stripped (3 chars). Buffer line 3: "  The sensor driver shall..."
  // "shall" at buffer col 21. File column = (21 - 2) + 3 = 22.
  const modals = entries[0].bodyTokens.filter((t) => t.kind === "modal");
  assertEquals(modals.length, 1);
  assertEquals(modals[0].text, "shall");
  assertEquals(modals[0].location.line, 4);
  assertEquals(modals[0].location.column, 22);
});
