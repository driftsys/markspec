/**
 * @module reporter
 *
 * Output reporters. Transforms compiled traceability graph into
 * traceability matrices and coverage reports in md, json, or csv format.
 */

import type { CompileResult } from "../compiler/mod.ts";
import type { DisplayId, Entry } from "../model/mod.ts";

/** Supported report kinds. */
export type ReportKind = "traceability" | "coverage";

/** Supported output formats. */
export type ReportFormat = "md" | "json" | "csv";

/** Options for {@linkcode report}. */
export interface ReportOptions {
  /** Report kind. */
  readonly kind: ReportKind;
  /** Output format. */
  readonly format: ReportFormat;
  /** Filter entries by domain abbreviation in display ID. */
  readonly scope?: string;
  /** Filter entries by label value. */
  readonly label?: string;
}

/**
 * Generate a report from compiled traceability graph.
 *
 * @param result - Compiled project
 * @param options - Report options
 * @returns Formatted report string
 */
export function report(result: CompileResult, options: ReportOptions): string {
  const entries = filterEntries(result, options.scope, options.label);

  if (options.kind === "traceability") {
    return formatTraceability(result, entries, options.format);
  }
  return formatCoverage(result, entries, options.format);
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/** Filter entries by scope (domain) and/or label. */
function filterEntries(
  result: CompileResult,
  scope?: string,
  label?: string,
): Entry[] {
  let entries = [...result.entries.values()];

  if (scope) {
    const scopeUpper = scope.toUpperCase();
    entries = entries.filter((e) => {
      const parts = e.displayId.split("_");
      return parts.length >= 2 && parts[1] === scopeUpper;
    });
  }

  if (label) {
    entries = entries.filter((e) => {
      const labelsAttr = e.attributes.find((a) => a.key === "Labels");
      if (!labelsAttr) return false;
      const labels = labelsAttr.value.split(",").map((s) => s.trim());
      return labels.includes(label);
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Traceability matrix
// ---------------------------------------------------------------------------

interface TraceRow {
  id: DisplayId;
  title: string;
  entryType: string;
  satisfies: string;
  satisfiedBy: string;
  verifiedBy: string;
}

function buildTraceRows(
  result: CompileResult,
  entries: Entry[],
): TraceRow[] {
  return entries.map((entry) => {
    const fwd = result.forward.get(entry.displayId) ?? [];
    const rev = result.reverse.get(entry.displayId) ?? [];

    return {
      id: entry.displayId,
      title: entry.title,
      entryType: entry.entryType ?? "",
      satisfies: fwd
        .filter((l) => l.kind === "satisfies")
        .map((l) => l.to)
        .join(", "),
      satisfiedBy: rev
        .filter((l) => l.kind === "satisfies")
        .map((l) => l.from)
        .join(", "),
      verifiedBy: rev
        .filter((l) => l.kind === "verifies")
        .map((l) => l.from)
        .join(", "),
    };
  });
}

function formatTraceability(
  result: CompileResult,
  entries: Entry[],
  format: ReportFormat,
): string {
  const rows = buildTraceRows(result, entries);

  if (format === "json") {
    return JSON.stringify(rows, null, 2);
  }

  if (format === "csv") {
    const header = "ID,Title,Type,Satisfies,Satisfied-by,Verified-by";
    const lines = rows.map((r) =>
      [
        r.id,
        csvEscape(r.title),
        r.entryType,
        r.satisfies,
        r.satisfiedBy,
        r.verifiedBy,
      ].join(",")
    );
    return [header, ...lines].join("\n");
  }

  // Markdown table
  const header =
    "| ID | Title | Type | Satisfies | Satisfied-by | Verified-by |";
  const sep =
    "| -- | ----- | ---- | --------- | ------------ | ----------- |";
  const lines = rows.map(
    (r) =>
      `| ${r.id} | ${r.title} | ${r.entryType} | ${r.satisfies || "\u2014"} | ${r.satisfiedBy || "\u2014"} | ${r.verifiedBy || "\u2014"} |`,
  );
  return [header, sep, ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Coverage report
// ---------------------------------------------------------------------------

interface CoverageStats {
  total: number;
  byType: Record<string, number>;
  withSatisfies: number;
  withoutSatisfies: number;
  gaps: {
    orphans: DisplayId[];
    unsatisfied: DisplayId[];
    unverified: DisplayId[];
  };
}

function computeCoverage(
  result: CompileResult,
  entries: Entry[],
): CoverageStats {
  const byType: Record<string, number> = {};
  const orphans: DisplayId[] = [];
  const unsatisfied: DisplayId[] = [];
  const unverified: DisplayId[] = [];
  let withSatisfies = 0;
  let withoutSatisfies = 0;

  for (const entry of entries) {
    const t = entry.entryType ?? "ref";
    byType[t] = (byType[t] ?? 0) + 1;

    const fwd = result.forward.get(entry.displayId) ?? [];
    const rev = result.reverse.get(entry.displayId) ?? [];
    const hasSatisfies = fwd.some((l) => l.kind === "satisfies");

    if (hasSatisfies) {
      withSatisfies++;
    } else if (entry.entryType) {
      withoutSatisfies++;
      orphans.push(entry.displayId);
    }

    // STK/SYS without children = unsatisfied parent
    const hasSatisfiedBy = rev.some((l) => l.kind === "satisfies");
    if (
      entry.entryType &&
      ["STK", "SYS"].includes(entry.entryType) &&
      !hasSatisfiedBy
    ) {
      unsatisfied.push(entry.displayId);
    }

    // Typed entries without verification
    const hasVerification = rev.some((l) => l.kind === "verifies");
    if (entry.entryType && !hasVerification) {
      unverified.push(entry.displayId);
    }
  }

  return {
    total: entries.length,
    byType,
    withSatisfies,
    withoutSatisfies,
    gaps: { orphans, unsatisfied, unverified },
  };
}

function formatCoverage(
  result: CompileResult,
  entries: Entry[],
  format: ReportFormat,
): string {
  const stats = computeCoverage(result, entries);

  if (format === "json") {
    return JSON.stringify(stats, null, 2);
  }

  if (format === "csv") {
    const lines = [
      "Metric,Value",
      `Total entries,${stats.total}`,
      ...Object.entries(stats.byType).map(([t, n]) => `Type ${t},${n}`),
      `With Satisfies,${stats.withSatisfies}`,
      `Without Satisfies,${stats.withoutSatisfies}`,
      `Orphans,${stats.gaps.orphans.length}`,
      `Unsatisfied parents,${stats.gaps.unsatisfied.length}`,
      `Unverified,${stats.gaps.unverified.length}`,
    ];
    return lines.join("\n");
  }

  // Markdown
  const lines = [
    "# Coverage Report",
    "",
    `**Total entries:** ${stats.total}`,
    "",
    "## By Type",
    "",
    ...Object.entries(stats.byType).map(([t, n]) => `- **${t}:** ${n}`),
    "",
    "## Coverage",
    "",
    `- With Satisfies: ${stats.withSatisfies}`,
    `- Without Satisfies (orphans): ${stats.withoutSatisfies}`,
    "",
  ];

  if (stats.gaps.orphans.length > 0) {
    lines.push(
      "## Orphan entries (no Satisfies)",
      "",
      ...stats.gaps.orphans.map((id) => `- ${id}`),
      "",
    );
  }

  if (stats.gaps.unsatisfied.length > 0) {
    lines.push(
      "## Unsatisfied parents (STK/SYS with no children)",
      "",
      ...stats.gaps.unsatisfied.map((id) => `- ${id}`),
      "",
    );
  }

  if (stats.gaps.unverified.length > 0) {
    lines.push(
      "## Unverified requirements",
      "",
      ...stats.gaps.unverified.map((id) => `- ${id}`),
      "",
    );
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape a value for CSV. */
function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
