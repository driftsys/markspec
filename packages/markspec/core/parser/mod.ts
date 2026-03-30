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
import type { Caption, Entry, Link } from "../model/mod.ts";
import { parseMarkdown } from "./markdown.ts";
import { isSupportedExtension, loadGrammar } from "./grammars.ts";
import { parseSource } from "./source.ts";
import {
  detectCaptions as detectCaptionsImpl,
  type DetectCaptionsOptions,
} from "./captions.ts";

export type { DetectCaptionsOptions } from "./captions.ts";

export { detectDirectives } from "./directives.ts";
export type { DetectDirectivesOptions } from "./directives.ts";

export { detectInlineRefs } from "./references.ts";
export type { DetectInlineRefsOptions } from "./references.ts";

export { parseSource } from "./source.ts";
export type { ParseSourceOptions, ParseSourceResult } from "./source.ts";

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
  return parseMarkdown(markdown, options);
}

/** Result of parsing a file (entries + annotation links). */
export interface ParseFileResult {
  /** Parsed entries. */
  readonly entries: Entry[];
  /** Standalone annotation links (from source file doc comments). */
  readonly links: Link[];
}

/**
 * Parse a file and return entries and annotation links, dispatching by type.
 *
 * Source files (`.rs`, `.java`, `.c`, `.cpp`, etc.) are parsed with
 * tree-sitter to extract doc comment entries and standalone annotations.
 * All other files are parsed as Markdown (no annotation links).
 *
 * @param content - File content
 * @param options - Must include `file` path for extension detection
 * @returns Parsed entries and annotation links
 */
export async function parseFile(
  content: string,
  options: { readonly file: string },
): Promise<ParseFileResult> {
  const ext = extname(options.file);

  if (isSupportedExtension(ext)) {
    const language = await loadGrammar(ext);
    return parseSource(content, { file: options.file, language });
  }

  return { entries: parseMarkdown(content, options), links: [] };
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
