/**
 * @module cli/init/summary
 *
 * Text + JSON renderers for the orchestrator's final summary. clig.dev
 * dual-output: text goes to stderr (human progress), JSON goes to stdout
 * (machine-readable).
 */

import type { InitResult } from "./types.ts";

/**
 * Render an InitResult as human-readable text for stderr.
 * Format: tab-separated action list with optional reasons, clients,
 * skills status, warnings, and error details.
 */
export function renderTextSummary(r: InitResult): string {
  const lines: string[] = [];
  lines.push(`Scaffold target: ${r.target}`);
  lines.push(`Profile: ${r.profile.kind}`);
  for (const a of r.actions) {
    const tag = a.kind;
    const reason = "reason" in a && a.reason ? ` (${a.reason})` : "";
    lines.push(`  ${tag.padEnd(9)} ${a.file}${reason}`);
  }
  if (r.clientsWritten.length > 0) {
    lines.push(`Clients wired: ${r.clientsWritten.join(", ")}`);
  }
  if (r.skills.attempted) {
    lines.push(
      `Skills bundle: ${r.skills.installed ? "installed" : "skipped"}`,
    );
  }
  for (const w of r.warnings) {
    lines.push(`warning: [${w.code}] ${w.message}`);
  }
  if (r.error) {
    lines.push(`error: [${r.error.code}] ${r.error.message}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Render an InitResult as JSON for stdout.
 * Preserves the full structure: ok flag, exit code, target, profile,
 * clients written, action list, warnings, skills status, and error
 * details (if present).
 */
export function renderJsonSummary(r: InitResult): string {
  return JSON.stringify(r, null, 2) + "\n";
}
