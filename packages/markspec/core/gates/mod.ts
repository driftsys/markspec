/**
 * @module core/gates
 *
 * Composite-`check` gate stages (ADR-027). Each function is a pure,
 * independently-testable transformation from already-gathered inputs to a
 * `Diagnostic[]`; the CLI `check` command orchestrates them (gather inputs →
 * call stages → merge diagnostics → render) and owns the scope policy that
 * decides whether they run at all (project-wide only).
 *
 * Extracted from `cli/commands/check.ts` (#659) so the diagnostic-producing
 * logic lives in `core` — composable, unit-testable in isolation, and reusable
 * by future surfaces — rather than inline in the command body. The command
 * keeps the I/O it must do (loading the Markdown prose formatter, reading
 * `markspec.lock`) and feeds the results in.
 *
 * `gates` is a top-level composition layer: it depends on `formatter`,
 * `parser`, `refs`, `lock`, and `lint`, and nothing in those depends back on
 * it — no cycle.
 */

import type { Diagnostic, EffectiveProfile, Entry } from "../model/mod.ts";
import { format } from "../formatter/mod.ts";
import type { ProseFormatter } from "../formatter/dprint.ts";
import { parseFile } from "../parser/mod.ts";
import { buildRefIndex, canonicalizeRefs } from "../refs/mod.ts";
import {
  detectOfflineEdgeDrift,
  type LockEdge,
  type ParseLockfileResult,
} from "../lock/mod.ts";
import { runLint } from "../lint/mod.ts";

/**
 * Format-drift gate — the `MSL-F010` (formatter drift) and `MSL-F011`
 * (reference-canonicalization drift) findings.
 *
 * Runs the SAME `format() → parse → canonicalizeRefs` sequence `markspec fmt`
 * performs, from the same exclude-aware corpus, so bare `check` and
 * `fmt --check` never disagree on what "formatted" means. `MSL-F010` is pure
 * formatter drift; `MSL-F011` is reference-canonicalization drift (a ULID or
 * stale display ID `fmt` would rewrite) — kept distinct so the author knows
 * which fmt concern fired. Markdown only — `markspec fmt` never rewrites source
 * files, so the caller passes only Markdown file contents.
 *
 * @param mdContents Markdown file path → current on-disk content.
 * @param entries The full parsed entry set (project + corpus), used to build
 *   the reference index `canonicalizeRefs` heals against.
 * @param ledger The lockfile's `[[edge]]` ULID ledger (`lockfile.edges`, or
 *   `[]` when there is no lockfile), threaded into `canonicalizeRefs`.
 * @param formatMarkdownProse The loaded ADR-029 whole-document Markdown
 *   formatter, or `undefined` to degrade to entry-only formatting.
 */
export async function fmtDriftGate(
  mdContents: ReadonlyMap<string, string>,
  entries: readonly Entry[],
  ledger: readonly LockEdge[],
  formatMarkdownProse: ProseFormatter | undefined,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const refIndex = buildRefIndex(entries);
  for (const [filePath, content] of mdContents) {
    const formatted = format(content, {
      file: filePath,
      formatMarkdownProse,
    });
    if (formatted.changed) {
      diagnostics.push({
        code: "MSL-F010",
        severity: "error",
        message: "file is not formatted (run `markspec fmt`)",
        location: { file: filePath, line: 1, column: 1 },
      });
    }
    const parsed = await parseFile(formatted.output, { file: filePath });
    const refResult = canonicalizeRefs(
      formatted.output,
      parsed.entries,
      refIndex,
      ledger,
    );
    if (refResult.changed) {
      diagnostics.push({
        code: "MSL-F011",
        severity: "error",
        message: "references are not canonical (run `markspec fmt`)",
        location: { file: filePath, line: 1, column: 1 },
      });
    }
  }
  return diagnostics;
}

/**
 * Lockfile-drift gate — the `MSL-L212` offline traceability-edge drift finding.
 *
 * A malformed lockfile surfaces the parser's own diagnostics unchanged. An
 * intact lockfile is compared against the current graph's canonical edge hash.
 * Offline by design — upstream resolution (network) stays in
 * `markspec lock --check`.
 *
 * Corpus-blind by design: the lockfile is not corpus-aware yet (ADR-030 defers
 * lockfile integration), so `markspec lock` never counts corpus edges. Counting
 * them here would raise an `MSL-L212` drift error that `markspec lock` can never
 * fix — a consumer gate must not fail on upstream content the consumer cannot
 * re-lock. The gate therefore filters to project-owned entries (`!e.origin`),
 * mirroring `markspec lock`.
 *
 * @param lockParse The parsed `markspec.lock` (already read from disk).
 * @param lockPath Absolute path to `markspec.lock`, used as the diagnostic
 *   location so JSON consumers that group by `location.file` keep the finding.
 * @param entries The full parsed entry set; corpus entries are filtered out.
 */
export async function lockfileDriftGate(
  lockParse: ParseLockfileResult,
  lockPath: string,
  entries: readonly Entry[],
): Promise<Diagnostic[]> {
  if (!lockParse.lockfile) {
    return [...lockParse.diagnostics];
  }
  const projectEntries = entries.filter((e) => !e.origin);
  const drift = await detectOfflineEdgeDrift(
    projectEntries,
    lockParse.lockfile.generatedCache,
  );
  if (!drift.drifted) return [];
  return [{
    code: "MSL-L212",
    severity: "error",
    message:
      `traceability edges drifted from markspec.lock: locked ${drift.lockedCount} edge(s), current ${drift.currentCount} — run \`markspec lock\` to refresh. (After upgrading MarkSpec this can also fire once because traceability inputs now include source-file doc comments; re-running \`markspec lock\` clears it.)`,
    location: { file: lockPath, line: 1, column: 1 },
  }];
}

/**
 * Prose-lint gate — the advisory `MSL-Q` prose-analysis findings, projected to
 * plain {@linkcode Diagnostic}s.
 *
 * Pass the FULL entry set (project + corpus) and the active profile.
 * {@linkcode runLint} excludes corpus entries from its output but keeps them in
 * the glossary / `$Identifier` indexes, so a corpus-defined term still silences
 * Q500 in project prose (ADR-030 §D4). The profile threads into `isProseScope`
 * so profile-typed entries are scoped (#675).
 *
 * `runLint`'s {@linkcode LintDiagnostic} carries `slug`/`group`/`score` fields
 * that must not leak into `check`'s stable JSON schema — the result is projected
 * to plain {@linkcode Diagnostic}. `runLint`'s `readFile` option (for glossary
 * file indexing) is not needed here: `check` passes no `glossaryFilePaths`.
 */
export async function proseLintGate(
  entries: readonly Entry[],
  profile: EffectiveProfile | undefined,
): Promise<Diagnostic[]> {
  const lintResult = await runLint({ entries, profile });
  return lintResult.diagnostics.map((d) => ({
    code: d.code,
    severity: d.severity,
    message: d.message,
    location: d.location,
  }));
}
