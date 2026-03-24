/**
 * @module reporter
 *
 * Output reporters. Transforms compiled JSON into output formats:
 * json, csv, reqif, yaml, coverage summary, traceability matrix.
 */

import type { Entry } from "../model/mod.ts";

/** Supported export formats. */
export type ExportFormat = "json" | "csv" | "reqif" | "yaml";

/** Options for {@linkcode report}. */
export interface ReportOptions {
  /** Output format. */
  readonly format: ExportFormat;
}

/**
 * Generate a report from compiled entries in the requested format.
 *
 * @param entries - Compiled entries
 * @param options - Report options
 * @returns Formatted report string
 */
export function report(
  _entries: readonly Entry[],
  _options: ReportOptions,
): string {
  return "";
}
