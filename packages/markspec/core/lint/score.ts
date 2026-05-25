/**
 * @module core/lint/score
 *
 * Score roll-up for the prose-quality lint pipeline (ADR-021 Decision 4).
 *
 * {@linkcode computeScoreRollup} is a pure function: same input → same
 * byte-identical output. Entries with zero diagnostics still appear in
 * `perEntry` so band-counts and the mean include all authored entries.
 *
 * Band scheme (fixed — do not change widths per ADR-021 Decision 4):
 *   0  |  1–3  |  4–7  |  8–15  |  16+
 */

import type { LintDiagnostic } from "./types.ts";
import type { Entry } from "../model/mod.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single rule's contribution to an entry's score. */
export interface RuleContribution {
  readonly code: string;
  readonly slug: string;
  /** Score per firing (constant for a given rule). */
  readonly weight: number;
  /** How many times this rule fired on this entry. */
  readonly occurrences: number;
}

/** Aggregated score for one entry. */
export interface EntryScore {
  /** ULID from entry.id (empty string when the entry has no Id stamp). */
  readonly entryId: string;
  readonly displayId: string;
  readonly score: number;
  /** Sorted by weight DESC, code ASC for deterministic output. */
  readonly contributions: readonly RuleContribution[];
}

/** Full score roll-up returned by {@linkcode computeScoreRollup}. */
export interface ScoreRollup {
  /** Per-entry scores, sorted by displayId for determinism. */
  readonly perEntry: readonly EntryScore[];
  readonly rollup: {
    /** Count of entries per band. All five keys are always present. */
    readonly bandCounts: Record<string, number>;
    /** Arithmetic mean of per-entry scores, rounded to 1 decimal. */
    readonly mean: number;
  };
  /** Anti-pattern note — exact ADR-021 Decision 5 string. */
  readonly antiPatternNote: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** ADR-021 Decision 5 — verbatim; do not change. */
export const ANTI_PATTERN_NOTE =
  "Optimize the requirements, not the score. The score is a smoke detector, not a KPI.";

/** Ordered band definitions: [label, predicate]. */
const BANDS: ReadonlyArray<readonly [string, (n: number) => boolean]> = [
  ["0", (n) => n === 0],
  ["1-3", (n) => n >= 1 && n <= 3],
  ["4-7", (n) => n >= 4 && n <= 7],
  ["8-15", (n) => n >= 8 && n <= 15],
  ["16+", (n) => n >= 16],
] as const;

// ---------------------------------------------------------------------------
// computeScoreRollup
// ---------------------------------------------------------------------------

/**
 * Compute per-entry scores and roll up band-counts + mean across all entries.
 *
 * Diagnostic → entry assignment strategy (option b — pure, no runner internals):
 * Build a per-file array of entries sorted by `location.line`. For each
 * diagnostic, find the entry in the same file whose start line is the largest
 * line ≤ the diagnostic's line (i.e. the entry that "owns" that position).
 * Diagnostics that don't match any entry are silently skipped (they would be
 * suppression-hygiene diagnostics from entries not in scope, or diagnostics
 * with no location).
 *
 * @param diagnostics - Flat array of lint diagnostics from {@linkcode runLint}.
 * @param entries - All entries (including those with 0 diagnostics) to ensure
 *   band-counts and the mean denominator cover the full population.
 */
export function computeScoreRollup(
  diagnostics: readonly LintDiagnostic[],
  entries: readonly Entry[],
): ScoreRollup {
  // Step 1: Build per-file sorted entry array for O(log M) lookup.
  // Key: file path. Value: entries sorted ascending by location.line.
  const fileEntries = new Map<string, Entry[]>();
  for (const entry of entries) {
    const file = entry.location.file;
    const arr = fileEntries.get(file) ?? [];
    arr.push(entry);
    fileEntries.set(file, arr);
  }
  // Sort each per-file list ascending by line so binary-search works.
  for (const arr of fileEntries.values()) {
    arr.sort((a, b) => a.location.line - b.location.line);
  }

  // Step 2: Map from Entry → accumulator { code → { slug, weight, count } }.
  const accumMap = new Map<
    Entry,
    Map<string, { slug: string; weight: number; count: number }>
  >();
  // Pre-seed every entry with an empty accumulator so 0-score entries appear.
  for (const entry of entries) {
    accumMap.set(entry, new Map());
  }

  // Step 3: Assign each diagnostic to an entry and accumulate.
  for (const diag of diagnostics) {
    if (!diag.location) continue;
    const file = diag.location.file;
    const fileArr = fileEntries.get(file);
    if (!fileArr || fileArr.length === 0) continue;
    const entry = findOwningEntry(fileArr, diag.location.line);
    if (!entry) continue;
    const accum = accumMap.get(entry);
    if (!accum) continue; // entry not in our set (e.g. hygiene on out-of-scope)
    const existing = accum.get(diag.code);
    if (existing) {
      existing.count++;
    } else {
      accum.set(diag.code, {
        slug: diag.slug,
        weight: diag.scoreContribution,
        count: 1,
      });
    }
  }

  // Step 4: Build EntryScore[] sorted by displayId.
  const perEntry: EntryScore[] = [];
  for (const entry of entries) {
    const accum = accumMap.get(entry)!;
    let score = 0;
    const contributions: RuleContribution[] = [];
    for (const [code, { slug, weight, count }] of accum) {
      score += weight * count;
      contributions.push({ code, slug, weight, occurrences: count });
    }
    // Sort contributions: weight DESC, then code ASC for ties.
    contributions.sort((a, b) =>
      b.weight !== a.weight ? b.weight - a.weight : a.code.localeCompare(b.code)
    );
    perEntry.push({
      entryId: entry.id ?? "",
      displayId: entry.displayId,
      score,
      contributions,
    });
  }
  // Sort perEntry by displayId for determinism.
  perEntry.sort((a, b) => a.displayId.localeCompare(b.displayId));

  // Step 5: Compute band-counts.
  const bandCounts: Record<string, number> = {};
  for (const [label] of BANDS) {
    bandCounts[label] = 0;
  }
  for (const { score } of perEntry) {
    for (const [label, predicate] of BANDS) {
      if (predicate(score)) {
        bandCounts[label]++;
        break;
      }
    }
  }

  // Step 6: Compute mean (round to 1 decimal).
  const totalScore = perEntry.reduce((s, e) => s + e.score, 0);
  const mean = perEntry.length === 0
    ? 0
    : Math.round((totalScore / perEntry.length) * 10) / 10;

  return {
    perEntry,
    rollup: { bandCounts, mean },
    antiPatternNote: ANTI_PATTERN_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Find the entry that owns a given line in a file.
 *
 * The owning entry is the one whose `location.line` is the largest value
 * ≤ `line` in the sorted `fileArr`. This matches how the runner assigns
 * diagnostics: each rule emits diagnostics with the entry's location or
 * a location within the entry's body, always at or after the entry start
 * line.
 */
function findOwningEntry(
  fileArr: readonly Entry[],
  line: number,
): Entry | undefined {
  // Binary search for the last entry whose location.line <= line.
  let lo = 0;
  let hi = fileArr.length - 1;
  let result: Entry | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (fileArr[mid].location.line <= line) {
      result = fileArr[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}
