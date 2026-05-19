/**
 * @module parser
 *
 * MarkSpec parser — file → Entry[].
 *
 * Three sub-modules:
 * - markdown: CommonMark AST walk, entry block detection, attribute extraction
 * - captions: table and figure caption detection
 * - directives: HTML comment directive extraction
 * - source: doc comment extraction from Rust, Kotlin, C, C++, Java
 */

import { extname } from "@std/path";
import type { Caption, Diagnostic, Document, Entry } from "../model/mod.ts";
import { parseMarkdown } from "./markdown.ts";
import { isSupportedExtension, loadGrammar } from "./grammars.ts";
import { parseSource } from "./source.ts";
import { extractFrontMatter } from "./frontmatter.ts";
import {
  detectCaptions as detectCaptionsImpl,
  type DetectCaptionsOptions,
} from "./captions.ts";

export type { DetectCaptionsOptions } from "./captions.ts";

export { detectDirectives } from "./directives.ts";
export type { DetectDirectivesOptions } from "./directives.ts";

export { extractFrontMatter } from "./frontmatter.ts";
export type {
  ExtractFrontMatterOptions,
  FrontMatterResult,
} from "./frontmatter.ts";

export { detectInlineRefs } from "./references.ts";
export type { DetectInlineRefsOptions } from "./references.ts";

export { parseSource } from "./source.ts";
export type { ParseSourceOptions, ParseSourceResult } from "./source.ts";
export {
  stripBlockCommentPrefix,
  stripLineCommentPrefix,
  wrapAsListItem,
} from "./source.ts";

export { isSupportedExtension, loadGrammar } from "./grammars.ts";

/** Options for {@linkcode parse}. */
export interface ParseOptions {
  /** File path used in source locations. */
  readonly file?: string;
}

/**
 * Parse a Markdown string and return all MarkSpec entries found.
 *
 * @param markdown - Markdown source text
 * @param options - Parse options
 * @returns Array of parsed entries
 */
export function parse(
  markdown: string,
  options?: ParseOptions,
): Entry[] {
  const file = options?.file;
  return parseMarkdown(markdown, {
    ...options,
    isReferencesDoc: file !== undefined ? isReferencesDocument(file) : false,
  }).entries;
}

/** Result of parsing a file (entries + optional document + diagnostics). */
export interface ParseFileResult {
  /** Parsed entries. */
  readonly entries: Entry[];
  /**
   * Document-level metadata parsed from YAML front matter. `undefined` for
   * source files (Rust/Kotlin/C/...) and for Markdown files without front
   * matter; present otherwise so downstream consumers can resolve
   * `{{document.*}}` inline references.
   */
  readonly document?: Document;
  /**
   * Parse-level diagnostics (forbidden front-matter keys, malformed YAML).
   * Merged into the compile result's diagnostics.
   */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Detect if a file is a references document.
 * References context enables recognition of reference entries (slugs).
 * @param file - File path
 */
function isReferencesDocument(file: string): boolean {
  const basename = file.split("/").pop() ?? "";
  return basename === "references.md" || file.includes("/references/");
}

/**
 * Parse a file and return entries, annotation links, and (for Markdown
 * files) a Document with front-matter attributes.
 *
 * Source files (`.rs`, `.java`, `.c`, `.cpp`, etc.) are parsed with
 * tree-sitter to extract doc comment entries; no front matter is
 * recognized on source files.
 */
export async function parseFile(
  content: string,
  options: { readonly file: string },
): Promise<ParseFileResult> {
  const ext = extname(options.file);

  if (isSupportedExtension(ext)) {
    const language = await loadGrammar(ext);
    const result = parseSource(content, {
      file: options.file,
      language,
    });
    return { entries: result.entries, diagnostics: [] };
  }

  const fm = extractFrontMatter(content, { file: options.file });
  const body = fm.hadFrontMatter ? fm.markdown : content;
  const isReferencesDoc = isReferencesDocument(options.file);
  const { entries, diagnostics: parseDiagnostics } = parseMarkdown(body, {
    file: options.file,
    isReferencesDoc,
  });

  const document: Document | undefined = fm.hadFrontMatter
    ? {
      file: options.file,
      attributes: fm.attributes,
      properties: {},
    }
    : undefined;

  return {
    entries,
    document,
    diagnostics: [...fm.diagnostics, ...parseDiagnostics],
  };
}

/**
 * Detect table and figure captions in a Markdown string.
 *
 * @param markdown - Markdown source text
 * @param options - Detection options (file path for source locations)
 * @returns Array of detected captions
 */
export function detectCaptions(
  markdown: string,
  options?: DetectCaptionsOptions,
): Caption[] {
  return detectCaptionsImpl(markdown, options);
}
