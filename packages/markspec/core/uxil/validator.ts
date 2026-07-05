/**
 * @module uxil/validator
 *
 * Enforced uxil semantics (S8 #726): closed-vocabulary checks, corpus
 * structural rules (declared-once, dangling namespace parent, navigate
 * resolution), and citation resolution (Pass 3, added alongside Task 9).
 * Mirrors typl/validator.ts's shape. Diagnostics are file-anchored as of
 * S9 (#727).
 */
import type { Diagnostic, Entry } from "../model/mod.ts";
import { assembleUxSurface } from "./assemble.ts";
import { extractUxCitations } from "./citations.ts";
import { findDuplicateDeclarations } from "../decl/mod.ts";
import { uxilDiagnosticAt } from "./diagnostics.ts";
import { buildUxRegistry, type UxRegistry } from "./registry.ts";
import { isKnownKind, isKnownVerb, UX_KINDS } from "./vocab.ts";

/** Result of {@linkcode validateUxil}: the corpus registry plus diagnostics. */
export interface UxilValidation {
  readonly registry: UxRegistry;
  readonly diagnostics: readonly Diagnostic[];
}

/** Options for {@linkcode validateUxil}. */
export interface UxilValidateOptions {
  /**
   * Entries whose `ux:` citations resolve against the registry (Pass 3).
   * Defaults to `entries`. The family orchestrator (S9 #727) passes every
   * non-upstream project entry here while `entries` carries only the
   * declaring-type entries — citations are legal from any entry type;
   * declarations are not.
   */
  readonly citationEntries?: readonly Entry[];
}

/**
 * Validate the uxil declarations across all entries: per-entry structural
 * and vocabulary checks (Pass 1), corpus structural checks over the
 * registry (Pass 2), and citation resolution (Pass 3). Returns the built
 * registry even when diagnostics are present, so callers can still use it
 * for navigation/projection.
 */
export function validateUxil(
  entries: readonly Entry[],
  opts: UxilValidateOptions = {},
): UxilValidation {
  const diagnostics: Diagnostic[] = [];

  // ── Pass 1: per-entry structural + vocabulary ────────────────────────────
  for (const entry of entries) {
    const tree = assembleUxSurface(entry);
    diagnostics.push(...tree.diagnostics);

    for (const surface of tree.surfaces) {
      const kindInfo = isKnownKind(surface.kind)
        ? UX_KINDS.get(surface.kind)!
        : undefined;
      if (kindInfo === undefined) {
        diagnostics.push(
          uxilDiagnosticAt(
            "UXIL-009",
            { kind: surface.kind },
            surface.location,
          ),
        );
      } else if (!kindInfo.stateful && surface.states.length > 0) {
        diagnostics.push(
          uxilDiagnosticAt(
            "UXIL-013",
            { kind: surface.kind },
            surface.location,
          ),
        );
      }

      for (const element of surface.elements) {
        for (const verb of element.verbs) {
          if (!isKnownVerb(verb)) {
            diagnostics.push(
              uxilDiagnosticAt("UXIL-010", { verb }, element.location),
            );
          }
        }
        if (element.verbs.includes("observe") && element.verbs.length > 1) {
          diagnostics.push(
            uxilDiagnosticAt(
              "UXIL-014",
              { element: element.name },
              element.location,
            ),
          );
        }

        // UXIL-025 (#727): 'observe' anchors a visibility assertion — the
        // issue's "visibility of a non-screen". Only when the kind is known
        // (an unknown kind is already UXIL-009; don't cascade).
        if (
          kindInfo !== undefined && !kindInfo.visual &&
          element.verbs.includes("observe")
        ) {
          diagnostics.push(
            uxilDiagnosticAt("UXIL-025", {
              element: element.name,
              surface: surface.path,
              kind: surface.kind,
            }, element.location),
          );
        }
        // UXIL-026 (#727): vocab's requiresNavTarget, previously unenforced.
        if (
          element.verbs.includes("navigate") && element.navTarget === undefined
        ) {
          diagnostics.push(
            uxilDiagnosticAt(
              "UXIL-026",
              { element: element.name },
              element.location,
            ),
          );
        }
      }
    }
  }

  // ── Pass 2: corpus structural, over the registry ─────────────────────────
  const registry = buildUxRegistry(entries);

  for (
    const { first, duplicates } of findDuplicateDeclarations(
      registry.surfaces,
    )
  ) {
    for (const dup of duplicates) {
      diagnostics.push(
        uxilDiagnosticAt("UXIL-015", {
          surface: dup.path,
          otherFile: first.owningEntryFile,
          otherLine: first.location.line,
        }, dup.location),
      );
    }
  }

  for (const [path, records] of registry.surfaces) {
    const dot = path.lastIndexOf(".");
    if (dot < 0) continue;
    const parent = path.slice(0, dot);
    // A single-segment parent (e.g. "media" in "media.home") is an
    // ordinary namespace prefix a root can use freely — it is never
    // itself required to be a separately declared surface (the design's
    // own worked examples name roots this way: "media.home",
    // "controls.hvac"). Only a surface nested 2+ levels deep, whose
    // parent is itself dotted, plausibly represents a promoted child
    // surface (design §6) whose intermediate ancestor is expected to
    // exist somewhere in the corpus. A genuinely-nested same-entry child
    // never reaches this branch — assembleUxSurface always registers its
    // resolved ancestor alongside it — so this only ever fires across
    // entries, exactly the promoted-surface scenario it targets.
    if (!parent.includes(".")) continue;
    if (registry.surfaces.has(parent)) continue;
    for (const record of records) {
      diagnostics.push(
        uxilDiagnosticAt(
          "UXIL-016",
          { surface: path, parent },
          record.location,
        ),
      );
    }
  }

  for (const records of registry.surfaces.values()) {
    for (const record of records) {
      for (const element of record.elements) {
        if (element.navTarget === undefined) continue;
        const targets = registry.surfaces.get(element.navTarget);
        const targetKind = targets?.[0]?.kind;
        const navigable = targetKind !== undefined &&
          UX_KINDS.get(targetKind)?.navigable === true;
        if (!navigable) {
          diagnostics.push(
            uxilDiagnosticAt(
              "UXIL-017",
              { target: element.navTarget },
              element.location,
            ),
          );
        }
      }
    }
  }

  // ── Pass 3: citation resolution ──────────────────────────────────────────
  for (const entry of opts.citationEntries ?? entries) {
    for (const citation of extractUxCitations(entry.bodyTokens)) {
      const { ref, location } = citation;
      const surfacePath = ref.surface.join(".");
      const records = registry.surfaces.get(surfacePath);
      if (!records || records.length === 0) {
        diagnostics.push(
          uxilDiagnosticAt("UXIL-018", { surface: surfacePath }, location),
        );
        continue;
      }
      // First-declaration-wins, matching the navigate-resolution check above.
      const surface = records[0];

      if (ref.state !== undefined && !surface.states.includes(ref.state)) {
        diagnostics.push(
          uxilDiagnosticAt(
            "UXIL-021",
            { state: ref.state, surface: surfacePath },
            location,
          ),
        );
      }

      if (ref.element !== undefined) {
        const element = surface.elements.find((e) => e.name === ref.element);
        if (!element) {
          diagnostics.push(
            uxilDiagnosticAt(
              "UXIL-019",
              { element: ref.element, surface: surfacePath },
              location,
            ),
          );
        } else {
          if (ref.verb !== undefined && !element.verbs.includes(ref.verb)) {
            diagnostics.push(
              uxilDiagnosticAt(
                "UXIL-020",
                { verb: ref.verb, element: element.name },
                location,
              ),
            );
          }
          if (
            ref.key?.kind === "concrete" && element.keyTemplate !== undefined
          ) {
            diagnostics.push(
              uxilDiagnosticAt("UXIL-022", { element: element.name }, location),
            );
          }
        }
      }
    }
  }

  return { registry, diagnostics };
}
