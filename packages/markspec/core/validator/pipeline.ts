/**
 * @module core/validator/pipeline
 *
 * Validator pipeline. Composes Stage 1 (core hygiene — existing `validate`),
 * Stage 2 (type classification — {@linkcode classifyEntriesStage}),
 * Stage 2.5 (list-value normalization — {@linkcode normalizeListValues}),
 * Stage 3 (typed attribute validation — {@linkcode validateAttributesForEntry}),
 * and Stage 4 (traceability rules — {@linkcode validateTraceabilityForEntry}).
 */

import type {
  CaptionConventions,
  Diagnostic,
  EffectiveProfile,
  Entry,
} from "../model/mod.ts";
import { CORE_DISCIPLINE_REGISTRY, makeDisplayId } from "../model/mod.ts";
import { validate } from "./mod.ts";
import {
  classifyEntriesStage,
  inferTypeFromDisplayIdShape,
  inferTypeFromLateStageChain,
  validateCoreTypeAttribute,
} from "./types.ts";
import { validateBodyBlocks } from "./body_blocks.ts";
import { validateCaptions } from "./captions.ts";
import { validateModalKeywords } from "./modal_keywords.ts";
import { validatePerTypeAttributes } from "./per_type_attrs.ts";
import { validateTraceTargetTypes } from "./trace_types.ts";
import { effectiveScope, validateAttributesForEntry } from "./attributes.ts";
import { normalizeListValues } from "./normalize.ts";
import { validateTraceabilityForEntry } from "./traceability.ts";
import { validateFeatureAc } from "./feature_ac.ts";
import { validateCaptionConvention } from "./caption_convention.ts";
import { validateDiscipline } from "./discipline.ts";
import { buildEffectiveDisciplineRegistry } from "../profile/discipline_registry.ts";

/** Result of running the full validator pipeline. */
export interface PipelineResult {
  /** Entries after classification — `type` set on those that classified. */
  readonly entries: readonly Entry[];
  readonly diagnostics: readonly Diagnostic[];
  /** `true` when no error-severity diagnostics were emitted. */
  readonly valid: boolean;
}

/** Options for {@linkcode runPipeline}. */
export interface PipelineOptions {
  /**
   * When `false`, suppress MSL-L006 ("link target does not resolve") from
   * Stage 4 output. Use this when the validator is running against a subset
   * of the project's files (e.g. `markspec check <file>`): file-local scope
   * cannot distinguish a typo from a valid cross-file target. MSL-L006 is
   * only meaningful when the full entry set is available (LSP, `compile`).
   * Defaults to `true` (full-project scope — emit MSL-L006 normally).
   */
  readonly projectWide?: boolean;
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
 *
 * @param captionConventions - Optional project-configured caption-position
 *   conventions (from `ProjectConfig.captionConventions`). When supplied
 *   and non-empty, MSL-C072 is checked for each entry. Defaults to no
 *   conventions (rule inactive).
 * @param opts - Pipeline options. Pass `{ projectWide: false }` when
 *   validating a file-local subset so MSL-L006 is suppressed.
 */
export function runPipeline(
  entries: readonly Entry[],
  profile: EffectiveProfile | null,
  captionConventions: CaptionConventions = {},
  opts: PipelineOptions = {},
): PipelineResult {
  const diagnostics: Diagnostic[] = [];

  // Stage 1 — core hygiene. When a profile is loaded, suppress MSL-R010
  // warnings for attributes the profile actually declares (Stage 3's scope
  // validates them directly — the core-only R010 check would be noise).
  const stage1 = validate(entries);
  diagnostics.push(
    ...suppressDeclaredAttrR010(stage1.diagnostics, entries, profile),
  );

  // Stage 1.5 — core type-attribute check. Runs always (core-only mode
  // included) so unknown `Type:` values fail fast regardless of profile.
  // Also covers late-stage display-ID-shape inference (step 8 → MSL-T021)
  // and caption-adjacency rules (§2.6 → MSL-C070).
  for (const entry of entries) {
    diagnostics.push(...validateCoreTypeAttribute(entry, profile));
    diagnostics.push(...inferTypeFromDisplayIdShape(entry));
    diagnostics.push(...validateCaptions(entry));
    diagnostics.push(...validateCaptionConvention(entry, captionConventions));
    diagnostics.push(...validateBodyBlocks(entry));
    diagnostics.push(...validateFeatureAc(entry));
    diagnostics.push(...validatePerTypeAttributes(entry, profile ?? undefined));
    diagnostics.push(...validateModalKeywords(entry));
  }

  // Stage 1.6 — cross-file trace target-type compatibility (MSL-R083).
  // Runs project-wide because targets may live in any entry; needs the
  // whole batch indexed.
  diagnostics.push(...validateTraceTargetTypes(entries));

  // Stage 1.7 — discipline attribute validation (ADR-017 Slice 3).
  // Runs in both core-only and profile modes. In core-only mode the
  // registry is CORE_DISCIPLINE_REGISTRY (kinds: system/software/hardware
  // only) so T025/T027 only accept core kinds.
  const disciplineRegistry = profile !== null
    ? buildEffectiveDisciplineRegistry(profile)
    : CORE_DISCIPLINE_REGISTRY;
  const entriesByDisplayId = new Map(
    entries.map((e) => [makeDisplayId(e.displayId), e] as const),
  );
  diagnostics.push(
    ...validateDiscipline(entries, entriesByDisplayId, disciplineRegistry),
  );

  // Stage 2 — classification (only when a profile is loaded).
  let finalEntries: readonly Entry[] = entries;
  if (profile !== null) {
    const stage2 = classifyEntriesStage(entries, profile);
    finalEntries = stage2.entries;
    diagnostics.push(...stage2.diagnostics);
  }

  // Stage 2.4 — late-stage inference warnings (MSL-T021 for steps 5/6).
  // Runs after Stage 2 so that profile-classified `entry.type` suppresses
  // the warning correctly. In core-only mode `finalEntries === entries`
  // and `entry.type` is always undefined, so this stage produces the same
  // diagnostics regardless of mode.
  for (const entry of finalEntries) {
    diagnostics.push(...inferTypeFromLateStageChain(entry));
  }

  // Stage 2.5 — normalize profile-declared list-value attributes. Splits
  // comma-separated values for `id-list`/`tag-list` attributes the core parser
  // didn't see so that Stage 3 sees already-split values.
  if (profile !== null) {
    finalEntries = finalEntries.map((e) => normalizeListValues(e, profile));
  }

  // Stage 3 — typed attributes (only when a profile is loaded).
  if (profile !== null) {
    for (const entry of finalEntries) {
      const stage3 = validateAttributesForEntry(entry, profile);
      diagnostics.push(...stage3);
    }
  }

  // Stage 4 — traceability rules (only when a profile is loaded). Builds two
  // indexes: by `entry.id` (ULID) and by `entry.displayId`, so trace values
  // resolve in either form (issue #593).
  if (profile !== null) {
    const graph = new Map<string, Entry>();
    const byDisplayId = new Map<string, Entry>();
    for (const e of finalEntries) {
      if (e.id && !graph.has(e.id)) graph.set(e.id, e);
      if (!byDisplayId.has(e.displayId)) byDisplayId.set(e.displayId, e);
    }
    const projectWide = opts.projectWide !== false;
    for (const entry of finalEntries) {
      const stage4 = validateTraceabilityForEntry(
        entry,
        profile,
        graph,
        byDisplayId,
      );
      // Suppress MSL-L006 ("link target does not resolve") when running
      // file-locally: the checked subset cannot distinguish a typo from a
      // valid cross-file target. Only emit when the full entry set is present.
      diagnostics.push(
        ...projectWide ? stage4 : stage4.filter((d) => d.code !== "MSL-L006"),
      );
    }
  }

  const valid = !diagnostics.some((d) => d.severity === "error");
  return { entries: finalEntries, diagnostics, valid };
}

/**
 * Drop core Stage 1 `MSL-R010` ("unknown attribute") warnings for attributes
 * the loaded profile declares — Stage 3 validates those directly, so the
 * core-only check would be noise. Returns `diagnostics` unchanged when no
 * profile is loaded.
 *
 * Exported so callers that run only Stage 1 (e.g. the compiler's diagnostic
 * pass) suppress the same false positives the full {@linkcode runPipeline}
 * does, keeping LSP/MCP diagnostics consistent with the `validate` command.
 */
export function suppressDeclaredAttrR010(
  diagnostics: readonly Diagnostic[],
  entries: readonly Entry[],
  profile: EffectiveProfile | null,
): readonly Diagnostic[] {
  if (profile === null) return diagnostics;
  const declared = collectAllProfileAttributes(entries, profile);
  return diagnostics.filter((d) => {
    if (d.code !== "MSL-R010") return true;
    const match = /attribute '([^']+)'/.exec(d.message);
    if (!match) return true;
    return !declared.has(match[1]);
  });
}

/**
 * Union of all attribute names declared by the profile's effective scope
 * across all entries. Used to suppress core Stage 1 MSL-R010 warnings for
 * attributes that Stage 3 already validates.
 *
 * Computed per-entry because the effective scope for an entry depends on
 * its shape and (when classified) type. Stage 1 runs before classification,
 * so we pre-classify by iterating; entries without `type` still contribute
 * their universal+shape scope.
 */
function collectAllProfileAttributes(
  entries: readonly Entry[],
  profile: EffectiveProfile,
): Set<string> {
  const out = new Set<string>();
  for (const entry of entries) {
    const scope = effectiveScope(entry, profile);
    for (const name of scope.attributes.keys()) out.add(name);
  }
  // Also include every type-scoped attribute in the profile, since an entry
  // may have declared attributes before Stage 2 classification runs.
  for (const [, typeEntry] of profile.types) {
    for (const name of typeEntry.value.attributes.keys()) out.add(name);
    // Trace rule link names are implicitly id-list attributes — include them
    // so Stage 1's MSL-R010 doesn't flag them before Stage 2 classifies.
    for (const name of typeEntry.value.traceability.keys()) out.add(name);
  }
  return out;
}
