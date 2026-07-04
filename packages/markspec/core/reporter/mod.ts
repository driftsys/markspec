/**
 * @module reporter
 *
 * Output reporters. Transforms compiled traceability graph into
 * traceability matrices and coverage reports in md, json, or csv format.
 */

import type { CompileResult } from "../compiler/mod.ts";
import type { DisplayId, Entry } from "../model/mod.ts";
import { formatEntryOrigin } from "../model/mod.ts";

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
  /**
   * Declared upstream ids from `project.yaml`'s `dependencies:` (federated
   * upstream, slice 4), derived via `deriveUpstreamId`. Used by the
   * `coverage` report to classify an upstream-origin entry: an id in this
   * set participates in coverage like a project entry (a `dependencies:`
   * upstream); an upstream-origin entry whose id is NOT in this set is a
   * `references:` leaf, excluded from the orphan/unsatisfied gap lists.
   * Defaults to empty — every upstream-origin entry is treated as a
   * reference leaf.
   */
  readonly dependencyUpstreamIds?: ReadonlySet<string>;
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
  return formatCoverage(
    result,
    entries,
    options.format,
    options.dependencyUpstreamIds,
  );
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
      const parts = e.displayId.split(/[_-]/);
      return parts.some((p) => p === scopeUpper);
    });
  }

  if (label) {
    entries = entries.filter((e) => {
      const labelsAttr = e.rawAttributes.find((a) => a.key === "Labels");
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
  origin: string;
  satisfies: string;
  satisfiedBy: string;
}

/**
 * Render an entry's provenance cell (ADR-030): `<profileId>@<profileVersion>`
 * for an entry injected from a profile-delivered corpus, `"project"` for a
 * project-authored entry. Shared by the traceability matrix builder so CSV,
 * Markdown, and JSON rows all agree on the same value.
 */
function originCell(entry: Entry): string {
  return entry.origin ? formatEntryOrigin(entry.origin) : "project";
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
      entryType: entry.type ?? "",
      origin: originCell(entry),
      satisfies: fwd
        .filter((l) => l.kind === "satisfies")
        .map((l) => l.to)
        .join(", "),
      satisfiedBy: rev
        .filter((l) => l.kind === "satisfies")
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
    const header = "ID,Title,Type,Origin,Satisfies,Satisfied-by";
    const lines = rows.map((r) =>
      [
        r.id,
        csvEscape(r.title),
        r.entryType,
        csvEscape(r.origin),
        csvEscape(r.satisfies),
        csvEscape(r.satisfiedBy),
      ].join(",")
    );
    return [header, ...lines].join("\n");
  }

  // Markdown table
  const header = "| ID | Title | Type | Origin | Satisfies | Satisfied-by |";
  const sep = "| -- | ----- | ---- | ------ | --------- | ------------ |";
  const lines = rows.map(
    (r) =>
      `| ${r.id} | ${r.title} | ${r.entryType} | ${r.origin} | ${
        r.satisfies || "\u2014"
      } | ${r.satisfiedBy || "\u2014"} |`,
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
  };
}

/** Options for {@linkcode computeCoverage}. */
interface ComputeCoverageOptions {
  /** See {@linkcode ReportOptions.dependencyUpstreamIds}. */
  readonly dependencyUpstreamIds?: ReadonlySet<string>;
}

function computeCoverage(
  result: CompileResult,
  entries: Entry[],
  opts: ComputeCoverageOptions = {},
): CoverageStats {
  const { dependencyUpstreamIds } = opts;
  const byType: Record<string, number> = {};
  const orphans: DisplayId[] = [];
  const unsatisfied: DisplayId[] = [];
  let withSatisfies = 0;
  let withoutSatisfies = 0;

  for (const entry of entries) {
    // Bucket by profile-declared type when available, fall back to shape.
    const t = entry.type ?? (entry.shape === "Reference" ? "ref" : "untyped");
    byType[t] = (byType[t] ?? 0) + 1;

    // Federated upstream (slice 4): a `references:` upstream entry is a
    // traceability leaf — no coverage expectation points at or from it, so
    // it is excluded from both gap lists below. A `dependencies:` upstream
    // entry (its upstreamId present in `dependencyUpstreamIds`) participates
    // like a project entry — this branch is inert until slice 3 loads
    // dependency entries, but the classification is exercised here so it's
    // ready when they do.
    const origin = entry.origin;
    const isReferenceLeaf = origin?.kind === "upstream" &&
      !(dependencyUpstreamIds?.has(origin.upstreamId) ?? false);

    const fwd = result.forward.get(entry.displayId) ?? [];
    const rev = result.reverse.get(entry.displayId) ?? [];
    const hasSatisfies = fwd.some((l) => l.kind === "satisfies");

    if (hasSatisfies) {
      withSatisfies++;
    } else if (entry.shape === "Authored" && !isReferenceLeaf) {
      withoutSatisfies++;
      orphans.push(entry.displayId);
    }

    // Identified entries without downstream satisfiers are tentatively
    // orphaned. Which types count as "top-level unsatisfied" is
    // profile-specific; a profile-aware reporter layer refines this.
    const hasSatisfiedBy = rev.some((l) => l.kind === "satisfies");
    if (
      entry.type &&
      !hasSatisfiedBy &&
      !isReferenceLeaf
    ) {
      unsatisfied.push(entry.displayId);
    }
  }

  return {
    total: entries.length,
    byType,
    withSatisfies,
    withoutSatisfies,
    gaps: { orphans, unsatisfied },
  };
}

function formatCoverage(
  result: CompileResult,
  entries: Entry[],
  format: ReportFormat,
  dependencyUpstreamIds?: ReadonlySet<string>,
): string {
  const stats = computeCoverage(result, entries, { dependencyUpstreamIds });

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
