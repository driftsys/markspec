/**
 * @module validator/uxil_family
 *
 * The UXIL-0xx diagnostics family orchestrator (S9 #727). Bridges S8's
 * uxil compiler into the profile-aware validation surfaces (`runPipeline`
 * → `markspec check`; LSP `WorkspaceIndex.validateAll`).
 *
 * Gate: a profile type carrying `declares: ux-surface` (ADR-009: the
 * mechanism is core, the designation is profile policy). With no
 * designation anywhere in the chain the family is fully inert — uxil-
 * looking code spans stay opaque (epic S1's Tier-1 guarantee), so a
 * `.gitignore`-style prose bullet can never draw a diagnostic.
 *
 * With a designation:
 *   - entries of a declaring type run the full S8 validation (structure,
 *     vocabulary, corpus registry);
 *   - `ux:` citations are validated from EVERY non-upstream entry —
 *     journeys, tests, and specs cite surfaces from any type;
 *   - an unambiguous root declaration (`ux:… : kind` span) in a
 *     non-declaring entry is UXIL-023. Element/child bullets (`/`-led,
 *     `.`-led) in non-declaring entries stay opaque — they are ambiguous
 *     with ordinary prose code spans, deliberately.
 *
 * Upstream entries are uxil-inert (the #771 `emittableEntries` partition,
 * mirroring validateTypl). Entries are gated by `entry.type` when the
 * pipeline's Stage 2 already classified them, else by `classifyEntry` —
 * so the LSP path (which never runs Stage 2) gates identically; the
 * classification diagnostics are deliberately dropped here (the pipeline
 * owns emitting those).
 */
import type { Diagnostic, EffectiveProfile, Entry } from "../model/mod.ts";
import { emittableEntries } from "../model/mod.ts";
import {
  extractUxRootSpans,
  uxilDiagnosticAt,
  validateUxil,
} from "../uxil/mod.ts";
import { classifyEntry } from "./types.ts";

/**
 * Names of the profile types designated as uxil declaring entry types
 * (`declares: ux-surface`). Empty when `profile` is `null` or no tier
 * designates one — the family's inertness gate.
 */
export function uxilDeclaringTypes(
  profile: EffectiveProfile | null,
): ReadonlySet<string> {
  const out = new Set<string>();
  if (profile === null) return out;
  for (const [name, td] of profile.types) {
    if (td.value.declares?.value === "ux-surface") out.add(name);
  }
  return out;
}

/**
 * Run the UXIL-0xx family over `entries`. Returns file-anchored core
 * diagnostics; `[]` when the gate is closed (see module doc).
 */
export function validateUxilFamily(
  entries: readonly Entry[],
  profile: EffectiveProfile | null,
): readonly Diagnostic[] {
  const declaring = uxilDeclaringTypes(profile);
  if (declaring.size === 0) return [];

  const local = emittableEntries(entries);
  const declaringEntries: Entry[] = [];
  const otherEntries: Entry[] = [];
  const typeOf = new Map<Entry, string | undefined>();
  for (const e of local) {
    const type = e.type ?? classifyEntry(e, profile!).type;
    typeOf.set(e, type);
    if (type !== undefined && declaring.has(type)) declaringEntries.push(e);
    else otherEntries.push(e);
  }

  const diagnostics: Diagnostic[] = [];

  // UXIL-023 — an unambiguous root declaration outside a declaring type.
  for (const e of otherEntries) {
    for (const span of extractUxRootSpans(e.bodyTokens)) {
      diagnostics.push(uxilDiagnosticAt("UXIL-023", {
        entry: e.displayId,
        type: typeOf.get(e) ?? "unclassified",
      }, span.location));
    }
  }

  const result = validateUxil(declaringEntries, { citationEntries: local });
  diagnostics.push(...result.diagnostics);
  return diagnostics;
}
