/**
 * @module parser/language_spec_test
 *
 * Unit tests for the per-grammar doc-comment dispatch table.
 */

import { assert, assertEquals } from "@std/assert";
import {
  JS_LIKE_ENCLOSING_TYPES,
  LANGUAGE_SPECS,
  languageIdForExtension,
  type SupportedLanguage,
} from "./language_spec.ts";

Deno.test("languageIdForExtension: maps every supported extension", () => {
  assertEquals(languageIdForExtension(".rs"), "rust");
  assertEquals(languageIdForExtension(".kt"), "kotlin");
  assertEquals(languageIdForExtension(".kts"), "kotlin");
  assertEquals(languageIdForExtension(".java"), "java");
  assertEquals(languageIdForExtension(".c"), "c");
  assertEquals(languageIdForExtension(".h"), "c");
  assertEquals(languageIdForExtension(".cpp"), "cpp");
  assertEquals(languageIdForExtension(".cc"), "cpp");
  assertEquals(languageIdForExtension(".cxx"), "cpp");
  assertEquals(languageIdForExtension(".hpp"), "cpp");
  assertEquals(languageIdForExtension(".hxx"), "cpp");
  assertEquals(languageIdForExtension(".ts"), "typescript");
  assertEquals(languageIdForExtension(".tsx"), "tsx");
  assertEquals(languageIdForExtension(".jsx"), "tsx");
  assertEquals(languageIdForExtension(".js"), "javascript");
  assertEquals(languageIdForExtension(".mjs"), "javascript");
  assertEquals(languageIdForExtension(".cjs"), "javascript");
  assertEquals(languageIdForExtension(".cs"), "csharp");
});

Deno.test("languageIdForExtension: returns undefined for unknown extension", () => {
  assertEquals(languageIdForExtension(".py"), undefined);
  assertEquals(languageIdForExtension(""), undefined);
});

Deno.test("LANGUAGE_SPECS: every SupportedLanguage has a row", () => {
  // Cross-check against the union so a hand-typed list cannot drift.
  // The `satisfies` clause forces every union member to appear in `expected`.
  const expected = [
    "rust",
    "kotlin",
    "java",
    "c",
    "cpp",
    "typescript",
    "tsx",
    "javascript",
    "csharp",
  ] as const satisfies readonly SupportedLanguage[];
  const actual = Object.keys(LANGUAGE_SPECS).sort();
  assertEquals(actual, [...expected].sort());
  for (const id of expected) {
    assert(LANGUAGE_SPECS[id], `missing spec row for ${id}`);
  }
});

Deno.test("LANGUAGE_SPECS.tsx: shares the same object reference as typescript", () => {
  // TSX is a strict superset of TS for the items we care about; both rows
  // deliberately point at the same spec object so any future change to
  // typescriptSpec automatically applies to TSX with zero drift risk.
  assert(LANGUAGE_SPECS.tsx === LANGUAGE_SPECS.typescript);
});

Deno.test("LANGUAGE_SPECS.rust: block/line type names and predicates", () => {
  const spec = LANGUAGE_SPECS.rust;
  assertEquals(spec.blockCommentTypes, ["block_comment"]);
  assertEquals(spec.lineCommentTypes, ["line_comment"]);
  assertEquals(spec.isDocBlock("/** doc */"), true);
  assertEquals(spec.isDocBlock("/* not doc */"), false);
  assertEquals(spec.isDocBlock("/*** divider */"), false);
  assertEquals(spec.isDocLine("/// doc"), true);
  assertEquals(spec.isDocLine("//! inner doc"), true);
  assertEquals(spec.isDocLine("// regular"), false);
});

Deno.test("LANGUAGE_SPECS.java: block type only, no doc-line", () => {
  const spec = LANGUAGE_SPECS.java;
  assertEquals(spec.blockCommentTypes, ["block_comment"]);
  assertEquals(spec.lineCommentTypes, ["line_comment"]);
  assertEquals(spec.isDocBlock("/** javadoc */"), true);
  assertEquals(spec.isDocBlock("/* not */"), false);
  assertEquals(spec.isDocLine("/// not a java thing"), false);
});

Deno.test("LANGUAGE_SPECS.kotlin: multiline_comment for block", () => {
  const spec = LANGUAGE_SPECS.kotlin;
  assertEquals(spec.blockCommentTypes, ["multiline_comment"]);
  assertEquals(spec.lineCommentTypes, ["line_comment"]);
  assertEquals(spec.isDocBlock("/** kdoc */"), true);
  assertEquals(spec.isDocLine("/// not kotlin"), false);
});

Deno.test("LANGUAGE_SPECS.cpp: shared 'comment' node type with text predicates", () => {
  const spec = LANGUAGE_SPECS.cpp;
  assertEquals(spec.blockCommentTypes, ["comment"]);
  assertEquals(spec.lineCommentTypes, ["comment"]);
  assertEquals(spec.isDocBlock("/** doxygen */"), true);
  assertEquals(spec.isDocBlock("// not block"), false);
  assertEquals(spec.isDocLine("/// doc"), true);
  assertEquals(spec.isDocLine("/* block */"), false);
});

Deno.test("LANGUAGE_SPECS.c: same shape as cpp", () => {
  const spec = LANGUAGE_SPECS.c;
  assertEquals(spec.blockCommentTypes, ["comment"]);
  assertEquals(spec.lineCommentTypes, ["comment"]);
  assertEquals(spec.isDocBlock("/** doxygen */"), true);
  assertEquals(spec.isDocBlock("// not block"), false);
  assertEquals(spec.isDocLine("/// doc"), true);
  assertEquals(spec.isDocLine("//! inner"), true);
  assertEquals(spec.isDocLine("/* block */"), false);
});

Deno.test("LANGUAGE_SPECS.csharp: shared 'comment' node type with XML doc-line", () => {
  const spec = LANGUAGE_SPECS.csharp;
  assertEquals(spec.blockCommentTypes, ["comment"]);
  assertEquals(spec.lineCommentTypes, ["comment"]);
  assertEquals(spec.isDocBlock("/** javadoc-ish */"), true);
  assertEquals(spec.isDocBlock("// not block"), false);
  assertEquals(spec.isDocLine("/// xml doc"), true);
  // C# has no //! inner-doc form (Rust-only).
  assertEquals(spec.isDocLine("//! inner"), false);
  assertEquals(spec.isDocLine("/* block */"), false);
});

Deno.test(
  "LANGUAGE_SPECS: each row has enclosingItemTypes + attributeSkipTypes + itemName",
  () => {
    const ids = Object.keys(LANGUAGE_SPECS) as SupportedLanguage[];
    for (const id of ids) {
      const spec = LANGUAGE_SPECS[id];
      assert(
        spec.enclosingItemTypes.length > 0,
        `${id}: empty enclosingItemTypes`,
      );
      assert(
        spec.attributeSkipTypes.length > 0,
        `${id}: empty attributeSkipTypes`,
      );
      assert(typeof spec.itemName === "function", `${id}: missing itemName`);
    }
  },
);

Deno.test(
  "LANGUAGE_SPECS.rust: enclosingItemTypes covers struct/impl/trait/fn",
  () => {
    const t = LANGUAGE_SPECS.rust.enclosingItemTypes;
    assert(t.includes("function_item"));
    assert(t.includes("struct_item"));
    assert(t.includes("impl_item"));
    assert(t.includes("trait_item"));
  },
);

Deno.test(
  "LANGUAGE_SPECS.kotlin: enclosingItemTypes covers function/class/object",
  () => {
    const t = LANGUAGE_SPECS.kotlin.enclosingItemTypes;
    assert(t.includes("function_declaration"));
    assert(t.includes("class_declaration"));
    assert(t.includes("object_declaration"));
  },
);

Deno.test(
  "LANGUAGE_SPECS.cpp: enclosingItemTypes covers function_definition + class_specifier",
  () => {
    const spec = LANGUAGE_SPECS.cpp;
    assert(spec.enclosingItemTypes.includes("function_definition"));
    assert(spec.enclosingItemTypes.includes("class_specifier"));
    assert(spec.enclosingItemTypes.includes("struct_specifier"));
  },
);

Deno.test(
  "LANGUAGE_SPECS.csharp: enclosingItemTypes covers class/struct/interface/record/method",
  () => {
    const t = LANGUAGE_SPECS.csharp.enclosingItemTypes;
    assert(t.includes("class_declaration"));
    assert(t.includes("struct_declaration"));
    assert(t.includes("interface_declaration"));
    assert(t.includes("record_declaration"));
    assert(t.includes("method_declaration"));
    assert(t.includes("namespace_declaration"));
    assert(t.includes("file_scoped_namespace_declaration"));
  },
);

Deno.test(
  "LANGUAGE_SPECS: rust attribute_item is in rust attributeSkipTypes",
  () => {
    assert(LANGUAGE_SPECS.rust.attributeSkipTypes.includes("attribute_item"));
  },
);

Deno.test(
  "LANGUAGE_SPECS.typescript / javascript: every non-wrapper enclosing type is recognised by jsLikeItemName",
  () => {
    // Drift guard. `jsLikeItemName` recursively unwraps `export_statement`
    // and `expression_statement` wrappers, then looks up child nodes in
    // JS_LIKE_ENCLOSING_TYPES. If a non-wrapper type appears in a spec's
    // `enclosingItemTypes` array but not in JS_LIKE_ENCLOSING_TYPES, the
    // walker would stop on it and the extractor would silently return
    // undefined when reached via an export/expression wrapper. This test
    // pins the invariant so the next person adding a node type can't
    // forget to update both sides.
    const WRAPPER_TYPES = new Set(["export_statement", "expression_statement"]);
    for (
      const [id, types] of [
        ["typescript", LANGUAGE_SPECS.typescript.enclosingItemTypes],
        ["javascript", LANGUAGE_SPECS.javascript.enclosingItemTypes],
      ] as const
    ) {
      for (const t of types) {
        if (WRAPPER_TYPES.has(t)) continue;
        assert(
          JS_LIKE_ENCLOSING_TYPES.has(t),
          `${id}: spec lists "${t}" but jsLikeItemName won't recurse into it from a wrapper — add it to JS_LIKE_ENCLOSING_TYPES`,
        );
      }
    }
  },
);
