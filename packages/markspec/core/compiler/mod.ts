/**
 * @module compiler
 *
 * Compiler pipeline. Takes a glob of file paths, parses all entries,
 * resolves the traceability graph, and outputs compiled JSON.
 */

import type { Diagnostic, Entry } from "../model/mod.ts";

/** Compiled project output — all entries with resolved traceability. */
export interface CompileResult {
  /** All parsed entries across all input files. */
  readonly entries: readonly Entry[];
  /** Diagnostics from parsing and validation. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Compile MarkSpec files from the given paths into a resolved
 * entry graph.
 *
 * @param paths - File paths or glob patterns to compile
 * @returns Compiled entries and diagnostics
 */
export function compile(
  _paths: readonly string[],
): Promise<CompileResult> {
  return Promise.resolve({ entries: [], diagnostics: [] });
}
