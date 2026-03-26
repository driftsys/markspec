/**
 * @module formatter
 *
 * Markdown formatter and ULID assigner. Handles write-back operations:
 * ULID stamping, indentation normalization, trailing backslash enforcement,
 * and requirement block insertion.
 */

import type { Diagnostic } from "../model/mod.ts";

/** Result of a format operation. */
export interface FormatResult {
  /** The formatted Markdown text. */
  readonly output: string;
  /** Diagnostics emitted during formatting (e.g., ULID assignments). */
  readonly diagnostics: readonly Diagnostic[];
  /** Whether any changes were made. */
  readonly changed: boolean;
}

/**
 * Format a Markdown string — stamp ULIDs, normalize attributes,
 * fix indentation.
 *
 * @param markdown - Markdown source text
 * @returns Format result with output text and diagnostics
 */
export function format(markdown: string): FormatResult {
  return { output: markdown, diagnostics: [], changed: false };
}
