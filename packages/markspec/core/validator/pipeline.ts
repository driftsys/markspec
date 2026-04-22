/**
 * @module core/validator/pipeline
 *
 * Validator pipeline. Composes Stage 1 (core hygiene — existing `validate`),
 * Stage 2 (type classification — {@linkcode classifyEntriesStage}), and
 * Stage 3 (typed attribute validation — {@linkcode validateAttributesForEntry}).
 *
 * Subsequent phases will append Stage 4 (traceability rules) to the same
 * runner.
 */

import type { Diagnostic, EffectiveProfile, Entry } from "../model/mod.ts";
import { validate } from "./mod.ts";
import { classifyEntriesStage } from "./types.ts";
import { validateAttributesForEntry } from "./attributes.ts";

/** Result of running the full validator pipeline. */
export interface PipelineResult {
  /** Entries after classification — `type` set on those that classified. */
  readonly entries: readonly Entry[];
  readonly diagnostics: readonly Diagnostic[];
  /** `true` when no error-severity diagnostics were emitted. */
  readonly valid: boolean;
}

/**
 * Run the validator pipeline.
 *
 * - Stage 1 (always): core hygiene via {@linkcode validate}.
 * - Stage 2 (when `profile` is non-null): entry classification via
 *   {@linkcode classifyEntriesStage}.
 *
 * When `profile` is `null`, entries pass through unchanged (no `type`
 * assignments).
 */
export function runPipeline(
  entries: readonly Entry[],
  profile: EffectiveProfile | null,
): PipelineResult {
  const diagnostics: Diagnostic[] = [];

  // Stage 1 — core hygiene.
  const stage1 = validate(entries);
  diagnostics.push(...stage1.diagnostics);

  // Stage 2 — classification (only when a profile is loaded).
  let finalEntries: readonly Entry[] = entries;
  if (profile !== null) {
    const stage2 = classifyEntriesStage(entries, profile);
    finalEntries = stage2.entries;
    diagnostics.push(...stage2.diagnostics);
  }

  // Stage 3 — typed attributes (only when a profile is loaded).
  if (profile !== null) {
    for (const entry of finalEntries) {
      const stage3 = validateAttributesForEntry(entry, profile);
      diagnostics.push(...stage3);
    }
  }

  const valid = !diagnostics.some((d) => d.severity === "error");
  return { entries: finalEntries, diagnostics, valid };
}
