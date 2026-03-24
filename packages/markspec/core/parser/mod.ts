/**
 * @module parser
 *
 * MarkSpec parser — file → Entry[].
 *
 * Two sub-modules:
 * - markdown: CommonMark AST walk, entry block detection, attribute extraction
 * - source: doc comment extraction from Rust, Kotlin, C, C++, Java
 */

import type { Entry } from "../model/mod.ts";

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
  _markdown: string,
  _options?: ParseOptions,
): Entry[] {
  return [];
}
