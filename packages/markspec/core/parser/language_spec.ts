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

export type SupportedLanguage = "rust" | "kotlin" | "java" | "c" | "cpp";

export interface LanguageDocCommentSpec {
  /** Tree-sitter node type(s) for block (multi-line) comments. */
  readonly blockCommentTypes: readonly string[];
  /** Tree-sitter node type(s) for line (single-line) comments. */
  readonly lineCommentTypes: readonly string[];
  /** Predicate: this block-comment node text starts a doc block. */
  isDocBlock(text: string): boolean;
  /** Predicate: this line-comment node text is a doc-line comment. */
  isDocLine(text: string): boolean;
}

const isJavadocBlock = (t: string): boolean =>
  t.startsWith("/**") && !t.startsWith("/***");

const isRustDocLine = (t: string): boolean =>
  t.startsWith("///") || t.startsWith("//!");

const noDocLine = (): boolean => false;

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
    },
    java: {
      blockCommentTypes: ["block_comment"],
      lineCommentTypes: ["line_comment"],
      isDocBlock: isJavadocBlock,
      isDocLine: noDocLine,
    },
    kotlin: {
      blockCommentTypes: ["multiline_comment"],
      lineCommentTypes: ["line_comment"],
      isDocBlock: isJavadocBlock,
      isDocLine: noDocLine,
    },
    cpp: {
      blockCommentTypes: ["comment"],
      lineCommentTypes: ["comment"],
      isDocBlock: isJavadocBlock,
      isDocLine: isRustDocLine,
    },
    c: {
      blockCommentTypes: ["comment"],
      lineCommentTypes: ["comment"],
      isDocBlock: isJavadocBlock,
      isDocLine: isRustDocLine,
    },
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
    default:
      return undefined;
  }
}
