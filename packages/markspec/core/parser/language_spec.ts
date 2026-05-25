/**
 * @module parser/language_spec
 *
 * Per-grammar doc-comment dispatch table. Each tree-sitter grammar names
 * its comment nodes differently (Rust splits `line_comment`/`block_comment`;
 * Kotlin uses `multiline_comment` for block; C/C++ collapses all comments
 * to a single `comment` node), so the walker reads node-type names plus
 * text predicates from this table rather than hard-coding them.
 *
 * Adding a new language is a single row here plus an extension entry in
 * {@linkcode languageIdForExtension}.
 */

import type { SyntaxNode } from "web-tree-sitter";
import type { SupportedLanguage } from "../model/mod.ts";
export type { SupportedLanguage }; // re-export for parser-internal consumers

export interface LanguageDocCommentSpec {
  /** Tree-sitter node type(s) for block (multi-line) comments. */
  readonly blockCommentTypes: readonly string[];
  /** Tree-sitter node type(s) for line (single-line) comments. */
  readonly lineCommentTypes: readonly string[];
  /** Predicate: this block-comment node text starts a doc block. */
  isDocBlock(text: string): boolean;
  /** Predicate: this line-comment node text is a doc-line comment. */
  isDocLine(text: string): boolean;
  /** Tree-sitter node types that an enclosing "item" (function, class,
   * struct, impl, mod, etc.) might be. Walker searches the doc comment's
   * next sibling for one of these. */
  readonly enclosingItemTypes: readonly string[];
  /** Tree-sitter node types to skip during the enclosing-item walk
   * (attributes, annotations, comments). */
  readonly attributeSkipTypes: readonly string[];
  /** Extract a name from an enclosing-item node. Each grammar uses a
   * different convention. Returns undefined for anonymous items or
   * extraction failures (operator overloads, destructors, etc.). */
  itemName(node: SyntaxNode): string | undefined;
}

const isJavadocBlock = (t: string): boolean =>
  t.startsWith("/**") && !t.startsWith("/***");

const isRustDocLine = (t: string): boolean =>
  t.startsWith("///") || t.startsWith("//!");

const noDocLine = (): boolean => false;

/** Read a node's `name` field as text, or undefined if absent. */
function nameField(node: SyntaxNode): string | undefined {
  return node.childForFieldName("name")?.text;
}

/** Rust: function/struct/enum/trait/mod/const/static/type use `name` field;
 * impl_item uses `type` field (the target type, not the trait being
 * implemented). Probe-verified: for `impl Display for MyType`, the `type`
 * field returns "MyType", not "Display". */
function rustItemName(node: SyntaxNode): string | undefined {
  if (node.type === "impl_item") {
    return node.childForFieldName("type")?.text;
  }
  return nameField(node);
}

/** Java: all declarations use `name` field. */
function javaItemName(node: SyntaxNode): string | undefined {
  return nameField(node);
}

/** Kotlin: probe-verified strategies.
 *   - class_declaration / object_declaration: first `type_identifier` child
 *     (these nodes have no `name` field).
 *   - function_declaration: last `simple_identifier` child appearing BEFORE
 *     the first `function_value_parameters` child. Handles regular funs,
 *     extension funs (receiver=user_type), generic funs, suspended funs. */
function kotlinItemName(node: SyntaxNode): string | undefined {
  if (
    node.type === "class_declaration" || node.type === "object_declaration"
  ) {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === "type_identifier") return child.text;
    }
    return undefined;
  }
  // function_declaration
  let lastIdent: string | undefined;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    if (child.type === "function_value_parameters") break;
    if (child.type === "simple_identifier") lastIdent = child.text;
  }
  return lastIdent;
}

/** C++: class/struct use `name` field; function_definition uses recursive
 * declarator walk (drops qualified prefixes like `Foo::`; returns undefined
 * for operator overloads and destructors). */
function cppItemName(node: SyntaxNode): string | undefined {
  if (node.type === "class_specifier" || node.type === "struct_specifier") {
    return nameField(node);
  }
  if (node.type === "function_definition") {
    const declarator = node.childForFieldName("declarator");
    if (!declarator) return undefined;
    return cppDeclaratorName(declarator);
  }
  return undefined;
}

/** Recursively walk a C++ declarator subtree for the innermost name.
 * For `qualified_identifier`, returns the trailing component name
 * ("Foo::method" → "method"). For `operator_name` / `destructor_name`,
 * returns undefined — those don't have a plain identifier to extract.
 * Probe-verified. */
function cppDeclaratorName(node: SyntaxNode): string | undefined {
  switch (node.type) {
    case "identifier":
    case "field_identifier":
      return node.text;
    case "operator_name":
    case "destructor_name":
      return undefined;
    case "qualified_identifier": {
      const nameNode = node.childForFieldName("name");
      return nameNode ? cppDeclaratorName(nameNode) : undefined;
    }
    default: {
      const inner = node.childForFieldName("declarator");
      return inner ? cppDeclaratorName(inner) : undefined;
    }
  }
}

/** Set of every enclosing-item node type across TypeScript, TSX, and JS.
 * Used by {@linkcode jsLikeItemName} when unwrapping `export_statement`
 * and `expression_statement` to recognise the real item among the
 * wrapper's children. Probe-verified against tree-sitter-typescript@0.23.2
 * and tree-sitter-javascript@0.23.1.
 *
 * Exported for the drift-guard test in `language_spec_test.ts` — every
 * non-wrapper member of `typescriptSpec.enclosingItemTypes` and
 * `javascriptSpec.enclosingItemTypes` must appear here. */
export const JS_LIKE_ENCLOSING_TYPES = new Set([
  "function_declaration",
  "class_declaration",
  "abstract_class_declaration",
  "method_definition",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "module", // module Foo { … }
  "internal_module", // namespace Foo { … } (tree-sitter-typescript)
  "lexical_declaration",
  "variable_declaration",
]);

/** Item-name extractor shared by TypeScript / TSX / JavaScript. Handles
 * four node shapes that JS/TS authors document:
 *   1. `export_statement`: recurse into the first child whose type appears
 *      in {@linkcode JS_LIKE_ENCLOSING_TYPES}, excluding nested
 *      `export_statement`s. Captures `export class Foo` / `export const Foo`.
 *   2. `expression_statement`: recurse into the first qualifying child.
 *      Required because tree-sitter-typescript wraps `namespace Foo { … }`
 *      in an `expression_statement` whose child is `internal_module`.
 *   3. `lexical_declaration` / `variable_declaration`: walk to the first
 *      `variable_declarator` child and read its `name` field. Captures
 *      `const Foo = () => {}` and `const Foo = function () {}`.
 *   4. anything else: read the node's `name` field directly. Covers
 *      function/class/interface/type-alias/enum/module declarations
 *      and `method_definition`.
 *
 * Returns undefined for anonymous `export default class {}` /
 * `export default function () {}` (no name to extract), for destructuring
 * patterns whose `variable_declarator` has no `name` field, and for
 * non-namespace expression statements such as a doc-commented bare
 * `foo();` (the wrapped `call_expression` is not in
 * JS_LIKE_ENCLOSING_TYPES). Mirrors the C++ destructor/operator precedent. */
function jsLikeItemName(node: SyntaxNode): string | undefined {
  if (
    node.type === "export_statement" ||
    node.type === "expression_statement"
  ) {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (
        child.type === "export_statement" ||
        child.type === "expression_statement"
      ) continue;
      if (JS_LIKE_ENCLOSING_TYPES.has(child.type)) {
        return jsLikeItemName(child);
      }
    }
    return undefined;
  }
  if (
    node.type === "lexical_declaration" ||
    node.type === "variable_declaration"
  ) {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === "variable_declarator") {
        return child.childForFieldName("name")?.text;
      }
    }
    return undefined;
  }
  return nameField(node);
}

/** Shared spec for TypeScript and TSX. The TSX grammar is a strict
 * superset of TypeScript; node names for the items we care about are
 * identical, so both `LANGUAGE_SPECS.typescript` and `LANGUAGE_SPECS.tsx`
 * point to this same object by reference. */
const typescriptSpec: LanguageDocCommentSpec = {
  blockCommentTypes: ["comment"],
  lineCommentTypes: ["comment"],
  isDocBlock: isJavadocBlock,
  isDocLine: noDocLine,
  enclosingItemTypes: [
    "function_declaration",
    "class_declaration",
    "abstract_class_declaration",
    "method_definition",
    "interface_declaration",
    "type_alias_declaration",
    "enum_declaration",
    "module", // module Foo { … }
    "internal_module", // namespace Foo { … }
    "lexical_declaration",
    "variable_declaration",
    "export_statement",
    "expression_statement", // wraps namespace at top level
  ],
  attributeSkipTypes: ["comment", "decorator"],
  itemName: jsLikeItemName,
};

/** JavaScript spec — TypeScript-only types removed
 * (`interface_declaration`, `type_alias_declaration`, `enum_declaration`,
 * `module`). */
const javascriptSpec: LanguageDocCommentSpec = {
  blockCommentTypes: ["comment"],
  lineCommentTypes: ["comment"],
  isDocBlock: isJavadocBlock,
  isDocLine: noDocLine,
  enclosingItemTypes: [
    "function_declaration",
    "class_declaration",
    "method_definition",
    "lexical_declaration",
    "variable_declaration",
    "export_statement",
  ],
  attributeSkipTypes: ["comment", "decorator"],
  itemName: jsLikeItemName,
};

/**
 * Closed-form table indexed by {@linkcode SupportedLanguage}. The walker in
 * `parser/source.ts` consults this map to know which AST node types to
 * inspect and how to discriminate doc comments from regular ones.
 */
export const LANGUAGE_SPECS: Record<SupportedLanguage, LanguageDocCommentSpec> =
  {
    rust: {
      blockCommentTypes: ["block_comment"],
      lineCommentTypes: ["line_comment"],
      isDocBlock: isJavadocBlock,
      isDocLine: isRustDocLine,
      enclosingItemTypes: [
        "function_item",
        "struct_item",
        "enum_item",
        "impl_item",
        "trait_item",
        "mod_item",
        "const_item",
        "static_item",
        "type_item",
      ],
      attributeSkipTypes: [
        "attribute_item",
        "inner_attribute_item",
        "line_comment",
        "block_comment",
      ],
      itemName: rustItemName,
    },
    java: {
      blockCommentTypes: ["block_comment"],
      lineCommentTypes: ["line_comment"],
      isDocBlock: isJavadocBlock,
      isDocLine: noDocLine,
      enclosingItemTypes: [
        "method_declaration",
        "constructor_declaration",
        "class_declaration",
        "interface_declaration",
        "enum_declaration",
      ],
      attributeSkipTypes: [
        "annotation",
        "marker_annotation",
        "line_comment",
        "block_comment",
      ],
      itemName: javaItemName,
    },
    kotlin: {
      blockCommentTypes: ["multiline_comment"],
      lineCommentTypes: ["line_comment"],
      isDocBlock: isJavadocBlock,
      isDocLine: noDocLine,
      enclosingItemTypes: [
        "function_declaration",
        "class_declaration",
        "object_declaration",
      ],
      attributeSkipTypes: [
        "annotation",
        "modifiers",
        "line_comment",
        "multiline_comment",
      ],
      itemName: kotlinItemName,
    },
    cpp: {
      blockCommentTypes: ["comment"],
      lineCommentTypes: ["comment"],
      isDocBlock: isJavadocBlock,
      isDocLine: isRustDocLine,
      enclosingItemTypes: [
        "function_definition",
        "class_specifier",
        "struct_specifier",
      ],
      attributeSkipTypes: [
        "attribute_declaration",
        "attribute_specifier",
        "comment",
      ],
      itemName: cppItemName,
    },
    c: {
      blockCommentTypes: ["comment"],
      lineCommentTypes: ["comment"],
      isDocBlock: isJavadocBlock,
      isDocLine: isRustDocLine,
      enclosingItemTypes: [
        "function_definition",
        "class_specifier",
        "struct_specifier",
      ],
      attributeSkipTypes: [
        "attribute_declaration",
        "attribute_specifier",
        "comment",
      ],
      itemName: cppItemName,
    },
    typescript: typescriptSpec,
    tsx: typescriptSpec,
    javascript: javascriptSpec,
  };

/** Map a file extension (including the dot) to its language id. */
export function languageIdForExtension(
  ext: string,
): SupportedLanguage | undefined {
  switch (ext) {
    case ".rs":
      return "rust";
    case ".kt":
    case ".kts":
      return "kotlin";
    case ".java":
      return "java";
    case ".c":
    case ".h":
      return "c";
    case ".cpp":
    case ".cc":
    case ".cxx":
    case ".hpp":
    case ".hxx":
      return "cpp";
    case ".ts":
      return "typescript";
    case ".tsx":
    case ".jsx":
      return "tsx";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    default:
      return undefined;
  }
}
