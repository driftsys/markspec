/**
 * @module report
 *
 * Render the latest `results/*.ndjson` as a Markdown report — the section
 * shapes match the ADR-020 measurement tables so a single copy-paste round-
 * trips into the ADR.
 *
 * Default output: stdout. Pipe to `pbcopy` / `xclip` / a file as needed.
 */

export async function generateReport(): Promise<void> {
  // TODO(phase-1):
  //   1. Read every NDJSON line under results/.
  //   2. Group by (bench, scale).
  //   3. Pick the latest sample per group (or the median across re-runs).
  //   4. Emit one Markdown table per bench matching ADR-020's shape.
  throw new Error("report.ts: not yet implemented");
}

if (import.meta.main) await generateReport();
