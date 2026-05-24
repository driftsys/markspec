/**
 * @module parser/language_spec_test
 *
 * Unit tests for the per-grammar doc-comment dispatch table.
 */

import { assert, assertEquals } from "@std/assert";
import {
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
});

Deno.test("languageIdForExtension: returns undefined for unknown extension", () => {
  assertEquals(languageIdForExtension(".py"), undefined);
  assertEquals(languageIdForExtension(""), undefined);
});

Deno.test("LANGUAGE_SPECS: every SupportedLanguage has a row", () => {
  const ids: SupportedLanguage[] = ["rust", "kotlin", "java", "c", "cpp"];
  for (const id of ids) {
    assert(LANGUAGE_SPECS[id], `missing spec row for ${id}`);
  }
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

Deno.test(
  "LANGUAGE_SPECS: each row has enclosingItemTypes + attributeSkipTypes + itemName",
  () => {
    const ids: SupportedLanguage[] = ["rust", "kotlin", "java", "c", "cpp"];
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
  "LANGUAGE_SPECS: rust attribute_item is in rust attributeSkipTypes",
  () => {
    assert(LANGUAGE_SPECS.rust.attributeSkipTypes.includes("attribute_item"));
  },
);
