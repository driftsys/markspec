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

import type { Caption, Entry } from "../model/mod.ts";
import { parseMarkdown } from "./markdown.ts";
import {
  detectCaptions as detectCaptionsImpl,
  type DetectCaptionsOptions,
} from "./captions.ts";

export type { DetectCaptionsOptions } from "./captions.ts";

export { detectDirectives } from "./directives.ts";
export type { DetectDirectivesOptions } from "./directives.ts";

export { detectInlineRefs } from "./references.ts";
export type { DetectInlineRefsOptions } from "./references.ts";

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
