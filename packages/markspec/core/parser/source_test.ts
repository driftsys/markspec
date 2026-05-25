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

let typescriptLanguage: Parser.Language;

async function getTypescriptLanguage(): Promise<Parser.Language> {
  if (typescriptLanguage) return typescriptLanguage;
  await Parser.init();
  typescriptLanguage = await Parser.Language.load(
    join(grammarsDir, "tree-sitter-typescript.wasm"),
  );
  return typescriptLanguage;
}

let tsxLanguage: Parser.Language;

async function getTsxLanguage(): Promise<Parser.Language> {
  if (tsxLanguage) return tsxLanguage;
  await Parser.init();
  tsxLanguage = await Parser.Language.load(
    join(grammarsDir, "tree-sitter-tsx.wasm"),
  );
  return tsxLanguage;
}

let javascriptLanguage: Parser.Language;

async function getJavascriptLanguage(): Promise<Parser.Language> {
  if (javascriptLanguage) return javascriptLanguage;
  await Parser.init();
  javascriptLanguage = await Parser.Language.load(
    join(grammarsDir, "tree-sitter-javascript.wasm"),
  );
  return javascriptLanguage;
}

let csharpLanguage: Parser.Language;

async function getCsharpLanguage(): Promise<Parser.Language> {
  if (csharpLanguage) return csharpLanguage;
  await Parser.init();
  csharpLanguage = await Parser.Language.load(
    join(grammarsDir, "tree-sitter-c-sharp.wasm"),
  );
  return csharpLanguage;
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
  assertEquals(result.entries[0].source.kind, "doc-comment");
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
  assertEquals(first.source.kind, "doc-comment");
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

// ---------------------------------------------------------------------------
// Rule detection: outer-doc-comment, inner-doc-comment, block-doc-comment
// ---------------------------------------------------------------------------

Deno.test("parseSource: Rust /// → rule outer-doc-comment", async () => {
  const language = await getRustLanguage();
  const source =
    `/// [SRS_BRK_0001] Title\n///\n/// Body.\n///\n///     Id: SRS_01HGW2Q8MNP3\nfn foo() {}\n`;
  const { entries } = parseSource(source, {
    file: "t.rs",
    language,
    languageId: "rust",
  });
  assertEquals(entries.length, 1);
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.rule, "outer-doc-comment");
  assertEquals(entries[0].source.language, "rust");
});

Deno.test("parseSource: Rust //! → rule inner-doc-comment", async () => {
  const language = await getRustLanguage();
  const source =
    `//! [SRS_BRK_0001] Title\n//!\n//! Body.\n//!\n//!     Id: SRS_01HGW2Q8MNP3\n`;
  const { entries } = parseSource(source, {
    file: "t.rs",
    language,
    languageId: "rust",
  });
  assertEquals(entries.length, 1);
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.rule, "inner-doc-comment");
});

Deno.test("parseSource: Java /** */ → rule block-doc-comment", async () => {
  const language = await getJavaLanguage();
  const source =
    `/**\n * [SRS_BRK_0001] Title\n *\n * Body.\n *\n *     Id: SRS_01HGW2Q8MNP3\n */\nclass Foo {}\n`;
  const { entries } = parseSource(source, {
    file: "t.java",
    language,
    languageId: "java",
  });
  assertEquals(entries.length, 1);
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.rule, "block-doc-comment");
});

// ---------------------------------------------------------------------------
// source.function: enclosing item name capture
// ---------------------------------------------------------------------------

Deno.test("parseSource: Rust /// → function captures enclosing fn name", async () => {
  const language = await getRustLanguage();
  const source =
    `/// [SRS_BRK_0001] Title\n///\n/// Body.\n///\n///     Id: SRS_01HGW2Q8MNP3\nfn debounce_sensor() {}\n`;
  const { entries } = parseSource(source, {
    file: "t.rs",
    language,
    languageId: "rust",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "debounce_sensor");
});

Deno.test("parseSource: Rust /// → function captures struct name", async () => {
  const language = await getRustLanguage();
  const source =
    `/// [SRS_BRK_0001] Title\n///\n/// Body.\n///\n///     Id: SRS_01HGW2Q8MNP3\nstruct SensorState { x: u32 }\n`;
  const { entries } = parseSource(source, {
    file: "t.rs",
    language,
    languageId: "rust",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "SensorState");
});

Deno.test("parseSource: Rust /// → impl_item returns target type (not trait)", async () => {
  const language = await getRustLanguage();
  // Trait impl: target type is MyType, trait is Display. itemName must return MyType.
  const source =
    `struct MyType;\n/// [SRS_BRK_0001] Title\n///\n/// Body.\n///\n///     Id: SRS_01HGW2Q8MNP3\nimpl Display for MyType { fn fmt() {} }\n`;
  const { entries } = parseSource(source, {
    file: "t.rs",
    language,
    languageId: "rust",
  });
  const target = entries.find((e) => e.displayId === "SRS_BRK_0001")!;
  if (target.source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(target.source.function, "MyType");
});

Deno.test("parseSource: Rust function with 3 attributes → function name still captured", async () => {
  const language = await getRustLanguage();
  const source =
    `/// [SRS_BRK_0001] Title\n///\n/// Body.\n///\n///     Id: SRS_01HGW2Q8MNP3\n#[derive(Debug)]\n#[cfg(test)]\n#[allow(dead_code)]\nfn foo() {}\n`;
  const { entries } = parseSource(source, {
    file: "t.rs",
    language,
    languageId: "rust",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "foo");
});

Deno.test("parseSource: Rust //! at file scope → function undefined", async () => {
  const language = await getRustLanguage();
  const source =
    `//! [SRS_BRK_0001] Title\n//!\n//! Body.\n//!\n//!     Id: SRS_01HGW2Q8MNP3\n\nuse std::collections::HashMap;\n`;
  const { entries } = parseSource(source, {
    file: "t.rs",
    language,
    languageId: "rust",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, undefined);
});

Deno.test("parseSource: Java /** */ → function captures class name", async () => {
  const language = await getJavaLanguage();
  const source =
    `/**\n * [SRS_BRK_0001] Title\n *\n * Body.\n *\n *     Id: SRS_01HGW2Q8MNP3\n */\nclass Foo {}\n`;
  const { entries } = parseSource(source, {
    file: "t.java",
    language,
    languageId: "java",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "Foo");
});

Deno.test("parseSource: Kotlin /** */ → function captures fun name", async () => {
  const language = await getKotlinLanguage();
  const source =
    `/**\n * [SRS_BRK_0001] Title\n *\n * Body.\n *\n *     Id: SRS_01HGW2Q8MNP3\n */\nfun debounce() {}\n`;
  const { entries } = parseSource(source, {
    file: "t.kt",
    language,
    languageId: "kotlin",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "debounce");
});

Deno.test("parseSource: Kotlin extension function → function captures fun name (not receiver type)", async () => {
  const language = await getKotlinLanguage();
  // Extension function: `fun List<Int>.foo()` — must return "foo" NOT "List".
  const source =
    `/**\n * [SRS_BRK_0001] Title\n *\n * Body.\n *\n *     Id: SRS_01HGW2Q8MNP3\n */\nfun List<Int>.foo(): Int = 0\n`;
  const { entries } = parseSource(source, {
    file: "t.kt",
    language,
    languageId: "kotlin",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "foo");
});

Deno.test("parseSource: C++ /** */ → function captures function name", async () => {
  const language = await getCppLanguage();
  const source =
    `/**\n * [SRS_BRK_0001] Title\n *\n * Body.\n *\n *     Id: SRS_01HGW2Q8MNP3\n */\nvoid debounce_sensor() {}\n`;
  const { entries } = parseSource(source, {
    file: "t.cpp",
    language,
    languageId: "cpp",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "debounce_sensor");
});

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

// ---------------------------------------------------------------------------
// TypeScript / TSX / JavaScript: itemName extraction
// ---------------------------------------------------------------------------

const TS_DOC_BLOCK =
  `/**\n * [SRS_BRK_0001] Title\n *\n * Body.\n *\n *     Id: SRS_01HGW2Q8MNP3\n */`;

Deno.test("parseSource: TypeScript /** */ → function captures class name", async () => {
  const language = await getTypescriptLanguage();
  const source = `${TS_DOC_BLOCK}\nclass Foo {}\n`;
  const { entries } = parseSource(source, {
    file: "t.ts",
    language,
    languageId: "typescript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "Foo");
});

Deno.test("parseSource: TypeScript /** */ → function captures function name", async () => {
  const language = await getTypescriptLanguage();
  const source = `${TS_DOC_BLOCK}\nfunction debounce() {}\n`;
  const { entries } = parseSource(source, {
    file: "t.ts",
    language,
    languageId: "typescript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "debounce");
});

Deno.test("parseSource: TypeScript /** */ → const arrow extracts name", async () => {
  const language = await getTypescriptLanguage();
  const source = `${TS_DOC_BLOCK}\nconst Foo = () => 0;\n`;
  const { entries } = parseSource(source, {
    file: "t.ts",
    language,
    languageId: "typescript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "Foo");
});

Deno.test("parseSource: TypeScript /** */ → const function-expression extracts name", async () => {
  const language = await getTypescriptLanguage();
  const source = `${TS_DOC_BLOCK}\nconst Foo = function () {};\n`;
  const { entries } = parseSource(source, {
    file: "t.ts",
    language,
    languageId: "typescript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "Foo");
});

Deno.test("parseSource: TypeScript /** */ → export class extracts name", async () => {
  const language = await getTypescriptLanguage();
  const source = `${TS_DOC_BLOCK}\nexport class Foo {}\n`;
  const { entries } = parseSource(source, {
    file: "t.ts",
    language,
    languageId: "typescript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "Foo");
});

Deno.test("parseSource: TypeScript /** */ → export const arrow extracts name", async () => {
  const language = await getTypescriptLanguage();
  const source = `${TS_DOC_BLOCK}\nexport const Foo = () => 0;\n`;
  const { entries } = parseSource(source, {
    file: "t.ts",
    language,
    languageId: "typescript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "Foo");
});

Deno.test("parseSource: TypeScript /** */ → interface extracts name", async () => {
  const language = await getTypescriptLanguage();
  const source = `${TS_DOC_BLOCK}\ninterface Foo { x: number; }\n`;
  const { entries } = parseSource(source, {
    file: "t.ts",
    language,
    languageId: "typescript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "Foo");
});

Deno.test("parseSource: TypeScript /** */ → type alias extracts name", async () => {
  const language = await getTypescriptLanguage();
  const source = `${TS_DOC_BLOCK}\ntype Foo = number;\n`;
  const { entries } = parseSource(source, {
    file: "t.ts",
    language,
    languageId: "typescript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "Foo");
});

Deno.test("parseSource: TypeScript /** */ → enum extracts name", async () => {
  const language = await getTypescriptLanguage();
  const source = `${TS_DOC_BLOCK}\nenum Foo { A, B }\n`;
  const { entries } = parseSource(source, {
    file: "t.ts",
    language,
    languageId: "typescript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "Foo");
});

Deno.test("parseSource: TypeScript /** */ → namespace extracts name", async () => {
  const language = await getTypescriptLanguage();
  const source = `${TS_DOC_BLOCK}\nnamespace Foo { export const x = 0; }\n`;
  const { entries } = parseSource(source, {
    file: "t.ts",
    language,
    languageId: "typescript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "Foo");
});

Deno.test("parseSource: TypeScript /** */ → anonymous export default returns undefined", async () => {
  const language = await getTypescriptLanguage();
  const source = `${TS_DOC_BLOCK}\nexport default class {}\n`;
  const { entries } = parseSource(source, {
    file: "t.ts",
    language,
    languageId: "typescript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, undefined);
});

Deno.test("parseSource: TSX /** */ → const-arrow component extracts name", async () => {
  const language = await getTsxLanguage();
  const source = `${TS_DOC_BLOCK}\nexport const Foo = () => <div>x</div>;\n`;
  const { entries } = parseSource(source, {
    file: "t.tsx",
    language,
    languageId: "tsx",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "Foo");
});

Deno.test("parseSource: JavaScript /** */ → function captures function name", async () => {
  const language = await getJavascriptLanguage();
  const source = `${TS_DOC_BLOCK}\nfunction debounce() {}\n`;
  const { entries } = parseSource(source, {
    file: "t.js",
    language,
    languageId: "javascript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "debounce");
});

Deno.test("parseSource: JavaScript /** */ → const arrow extracts name", async () => {
  const language = await getJavascriptLanguage();
  const source = `${TS_DOC_BLOCK}\nconst Foo = () => 0;\n`;
  const { entries } = parseSource(source, {
    file: "t.js",
    language,
    languageId: "javascript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "Foo");
});

Deno.test("parseSource: JavaScript /** */ → const function-expression extracts name", async () => {
  const language = await getJavascriptLanguage();
  const source = `${TS_DOC_BLOCK}\nconst Foo = function () {};\n`;
  const { entries } = parseSource(source, {
    file: "t.js",
    language,
    languageId: "javascript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "Foo");
});

Deno.test("parseSource: JavaScript /** */ → export class extracts name", async () => {
  const language = await getJavascriptLanguage();
  const source = `${TS_DOC_BLOCK}\nexport class Foo {}\n`;
  const { entries } = parseSource(source, {
    file: "t.js",
    language,
    languageId: "javascript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "Foo");
});

Deno.test("parseSource: TypeScript fixture in-code-typescript.ts", async () => {
  const language = await getTypescriptLanguage();
  const fixturePath = join(
    import.meta.dirname!,
    "..",
    "..",
    "..",
    "..",
    "tests",
    "fixtures",
    "in-code-typescript.ts",
  );
  const content = await Deno.readTextFile(fixturePath);
  const { entries } = parseSource(content, {
    file: "in-code-typescript.ts",
    language,
    languageId: "typescript",
  });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "BrakingSensor");
  assertEquals(entries[0].source.language, "typescript");
});

Deno.test("parseSource: TSX fixture in-code-tsx.tsx", async () => {
  const language = await getTsxLanguage();
  const fixturePath = join(
    import.meta.dirname!,
    "..",
    "..",
    "..",
    "..",
    "tests",
    "fixtures",
    "in-code-tsx.tsx",
  );
  const content = await Deno.readTextFile(fixturePath);
  const { entries } = parseSource(content, {
    file: "in-code-tsx.tsx",
    language,
    languageId: "tsx",
  });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "BrakingSensor");
  assertEquals(entries[0].source.language, "tsx");
});

Deno.test("parseSource: JavaScript fixture in-code-javascript.js", async () => {
  const language = await getJavascriptLanguage();
  const fixturePath = join(
    import.meta.dirname!,
    "..",
    "..",
    "..",
    "..",
    "tests",
    "fixtures",
    "in-code-javascript.js",
  );
  const content = await Deno.readTextFile(fixturePath);
  const { entries } = parseSource(content, {
    file: "in-code-javascript.js",
    language,
    languageId: "javascript",
  });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "BrakingSensor");
  assertEquals(entries[0].source.language, "javascript");
});

Deno.test("parseSource: TypeScript /** */ → decorated class skips decorator and captures name", async () => {
  // `decorator` is in attributeSkipTypes; the decorator wraps the
  // class_declaration inside an export_statement, so jsLikeItemName's
  // export_statement recursion reaches the class.
  const language = await getTypescriptLanguage();
  const source = `${TS_DOC_BLOCK}\n@Component()\nexport class MyClass {}\n`;
  const { entries } = parseSource(source, {
    file: "t.ts",
    language,
    languageId: "typescript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "MyClass");
});

Deno.test("parseSource: TypeScript /** */ → abstract class extracts name", async () => {
  const language = await getTypescriptLanguage();
  const source = `${TS_DOC_BLOCK}\nabstract class MyAbs {}\n`;
  const { entries } = parseSource(source, {
    file: "t.ts",
    language,
    languageId: "typescript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "MyAbs");
});

Deno.test("parseSource: TypeScript /** */ → method_definition inside a class extracts method name", async () => {
  const language = await getTypescriptLanguage();
  const source =
    `class Outer {\n  /**\n   * [SRS_BRK_0001] Title\n   *\n   * Body.\n   *\n   *     Id: SRS_01HGW2Q8MNP3\n   */\n  myMethod() {}\n}\n`;
  const { entries } = parseSource(source, {
    file: "t.ts",
    language,
    languageId: "typescript",
  });
  if (entries[0].source.kind !== "doc-comment") {
    throw new Error("expected doc-comment");
  }
  assertEquals(entries[0].source.function, "myMethod");
});

// C#: basic entry extraction
// ---------------------------------------------------------------------------

Deno.test("parseSource: extracts C# /// doc comment entry", async () => {
  const language = await getCsharpLanguage();
  const source = `/// [SRS_BRK_0001] Sensor input debouncing
///
/// The sensor driver shall reject transient noise.
///
///     Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
///     Satisfies: SYS_BRK_0042
///     Labels: ASIL-B
public class BrakingSensor {}
`;

  const result = parseSource(source, {
    file: "BrakingSensor.cs",
    language,
    languageId: "csharp",
  });
  assertEquals(result.entries.length, 1);
  const entry = result.entries[0];
  assertEquals(entry.displayId, "SRS_BRK_0001");
  assertEquals(entry.title, "Sensor input debouncing");
  assertEquals(entry.id, "01HGW2Q8MNP3RSTVWXYZABCDEF");
  assertEquals(entry.source.kind, "doc-comment");
  if (entry.source.kind === "doc-comment") {
    assertEquals(entry.source.language, "csharp");
    assertEquals(entry.source.rule, "outer-doc-comment");
    assertEquals(entry.source.function, "BrakingSensor");
  }
});

Deno.test("parseSource: C# /// → function captures enclosing name for every item type", async () => {
  const language = await getCsharpLanguage();
  // One entry per node type, each carrying a distinct display ID so we
  // can assert function-name attribution per row.
  const source = `namespace Foo.Bar {
    /// [REQ_0001] On namespace
    ///
    ///     Id: 01HGW0000000000000000001AA
    /// dummy line so the parser stops searching for siblings on namespace
    class _NamespaceCarrier {}

    /// [REQ_0002] On class
    ///
    ///     Id: 01HGW0000000000000000002AA
    public class Cls {}

    /// [REQ_0003] On struct
    ///
    ///     Id: 01HGW0000000000000000003AA
    public struct Strct {}

    /// [REQ_0004] On interface
    ///
    ///     Id: 01HGW0000000000000000004AA
    public interface IThing {}

    /// [REQ_0005] On record
    ///
    ///     Id: 01HGW0000000000000000005AA
    public record Rec(int X);

    /// [REQ_0006] On record struct
    ///
    ///     Id: 01HGW0000000000000000006AA
    public record struct RecStruct(int X);

    /// [REQ_0007] On enum
    ///
    ///     Id: 01HGW0000000000000000007AA
    public enum Col { Red, Green }

    /// [REQ_0008] On delegate
    ///
    ///     Id: 01HGW0000000000000000008AA
    public delegate void Del();

    public class Holder {
        /// [REQ_0009] On method
        ///
        ///     Id: 01HGW0000000000000000009AA
        public void DoThing() {}

        /// [REQ_0010] On property
        ///
        ///     Id: 01HGW000000000000000000AAA
        public int Prop { get; set; }

        /// [REQ_0011] On constructor
        ///
        ///     Id: 01HGW000000000000000000BAA
        public Holder() {}

        /// [REQ_0012] On local function
        ///
        ///     Id: 01HGW000000000000000000CAA
        public void Wrapper() {
            /// [REQ_0013] On nested local function
            ///
            ///     Id: 01HGW000000000000000000DAA
            void Local() {}
            Local();
        }
    }
}

/// [REQ_0014] On file-scoped namespace
///
///     Id: 01HGW000000000000000000EAA
namespace Baz;

class TopLevel {}
`;
  const { entries } = parseSource(source, {
    file: "Coverage.cs",
    language,
    languageId: "csharp",
  });

  const fnByDisplayId = new Map<string, string | undefined>();
  for (const e of entries) {
    if (e.source.kind === "doc-comment") {
      fnByDisplayId.set(e.displayId, e.source.function);
    }
  }
  // Skip REQ_0001 (carrier-only — the next sibling after the comment
  // is the dummy class, not the namespace itself; namespace attribution
  // is checked separately in the traditional-namespace test below).
  assertEquals(fnByDisplayId.get("REQ_0002"), "Cls");
  assertEquals(fnByDisplayId.get("REQ_0003"), "Strct");
  assertEquals(fnByDisplayId.get("REQ_0004"), "IThing");
  assertEquals(fnByDisplayId.get("REQ_0005"), "Rec");
  assertEquals(fnByDisplayId.get("REQ_0006"), "RecStruct");
  assertEquals(fnByDisplayId.get("REQ_0007"), "Col");
  assertEquals(fnByDisplayId.get("REQ_0008"), "Del");
  assertEquals(fnByDisplayId.get("REQ_0009"), "DoThing");
  assertEquals(fnByDisplayId.get("REQ_0010"), "Prop");
  assertEquals(fnByDisplayId.get("REQ_0011"), "Holder");
  assertEquals(fnByDisplayId.get("REQ_0012"), "Wrapper");
  assertEquals(fnByDisplayId.get("REQ_0013"), "Local");
  assertEquals(fnByDisplayId.get("REQ_0014"), "Baz");
});

Deno.test("parseSource: C# /// → function captures traditional namespace name", async () => {
  const language = await getCsharpLanguage();
  const source = `/// [REQ_0100] Doc on a top-level namespace
///
///     Id: 01HGW0000000000000000100AA
namespace Foo.Bar {}
`;
  const { entries } = parseSource(source, {
    file: "NsAttr.cs",
    language,
    languageId: "csharp",
  });
  assertEquals(entries.length, 1);
  if (entries[0].source.kind === "doc-comment") {
    // qualified_name; nameField returns the full `Foo.Bar` text.
    assertEquals(entries[0].source.function, "Foo.Bar");
  }
});
