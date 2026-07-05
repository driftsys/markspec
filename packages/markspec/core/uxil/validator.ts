/**
 * @module uxil/validator
 *
 * Enforced uxil semantics (S8 #726): closed-vocabulary checks, corpus
 * structural rules (declared-once, dangling namespace parent, navigate
 * resolution), and citation resolution (Pass 3, added alongside Task 9).
 * Mirrors typl/validator.ts's shape. Positions are the assembled records'
 * own `location` — source-local-safe; S9 owns file-anchoring.
 */
import type { Entry } from "../model/mod.ts";
import type { Position } from "./ast.ts";
import { assembleUxSurface } from "./assemble.ts";
import { extractUxCitations } from "./citations.ts";
import { findDuplicateDeclarations } from "../decl/mod.ts";
import { type UxilDiagnostic, uxilDiagnostic } from "./diagnostics.ts";
import { buildUxRegistry, type UxRegistry } from "./registry.ts";
import { isKnownKind, isKnownVerb, UX_KINDS } from "./vocab.ts";

/** Result of {@linkcode validateUxil}: the corpus registry plus diagnostics. */
export interface UxilValidation {
  readonly registry: UxRegistry;
  readonly diagnostics: readonly UxilDiagnostic[];
}

function positionOf(loc: { line: number; column: number }): Position {
  return { line: loc.line, column: loc.column };
}

/**
 * Validate the uxil declarations across all entries: per-entry structural
 * and vocabulary checks (Pass 1), corpus structural checks over the
 * registry (Pass 2), and citation resolution (Pass 3). Returns the built
 * registry even when diagnostics are present, so callers can still use it
 * for navigation/projection.
 */
export function validateUxil(entries: readonly Entry[]): UxilValidation {
  const diagnostics: UxilDiagnostic[] = [];

  // ── Pass 1: per-entry structural + vocabulary ────────────────────────────
  for (const entry of entries) {
    const tree = assembleUxSurface(entry);
    diagnostics.push(...tree.diagnostics);

    for (const surface of tree.surfaces) {
      const pos = positionOf(surface.location);
      if (!isKnownKind(surface.kind)) {
        diagnostics.push(
          uxilDiagnostic("UXIL-009", { kind: surface.kind }, pos),
        );
      } else {
        const kindInfo = UX_KINDS.get(surface.kind)!;
        if (!kindInfo.stateful && surface.states.length > 0) {
          diagnostics.push(
            uxilDiagnostic("UXIL-013", { kind: surface.kind }, pos),
          );
        }
      }

      for (const element of surface.elements) {
        const elPos = positionOf(element.location);
        for (const verb of element.verbs) {
          if (!isKnownVerb(verb)) {
            diagnostics.push(uxilDiagnostic("UXIL-010", { verb }, elPos));
          }
        }
        if (element.verbs.includes("observe") && element.verbs.length > 1) {
          diagnostics.push(
            uxilDiagnostic("UXIL-014", { element: element.name }, elPos),
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
        uxilDiagnostic("UXIL-015", {
          surface: dup.path,
          otherFile: first.owningEntryFile,
          otherLine: first.location.line,
        }, positionOf(dup.location)),
      );
    }
  }

  for (const [path, records] of registry.surfaces) {
    const dot = path.lastIndexOf(".");
    if (dot < 0) continue;
    const parent = path.slice(0, dot);
    if (registry.surfaces.has(parent)) continue;
    for (const record of records) {
      diagnostics.push(
        uxilDiagnostic(
          "UXIL-016",
          { surface: path, parent },
          positionOf(record.location),
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
            uxilDiagnostic(
              "UXIL-017",
              { target: element.navTarget },
              positionOf(element.location),
            ),
          );
        }
      }
    }
  }

  // ── Pass 3: citation resolution ──────────────────────────────────────────
  for (const entry of entries) {
    for (const citation of extractUxCitations(entry.bodyTokens)) {
      const { ref, location } = citation;
      const pos = positionOf(location);
      const surfacePath = ref.surface.join(".");
      const records = registry.surfaces.get(surfacePath);
      if (!records || records.length === 0) {
        diagnostics.push(
          uxilDiagnostic("UXIL-018", { surface: surfacePath }, pos),
        );
        continue;
      }
      // First-declaration-wins, matching the navigate-resolution check above.
      const surface = records[0];

      if (ref.state !== undefined && !surface.states.includes(ref.state)) {
        diagnostics.push(
          uxilDiagnostic(
            "UXIL-021",
            { state: ref.state, surface: surfacePath },
            pos,
          ),
        );
      }

      if (ref.element !== undefined) {
        const element = surface.elements.find((e) => e.name === ref.element);
        if (!element) {
          diagnostics.push(
            uxilDiagnostic(
              "UXIL-019",
              { element: ref.element, surface: surfacePath },
              pos,
            ),
          );
        } else {
          if (ref.verb !== undefined && !element.verbs.includes(ref.verb)) {
            diagnostics.push(
              uxilDiagnostic(
                "UXIL-020",
                { verb: ref.verb, element: element.name },
                pos,
              ),
            );
          }
          if (
            ref.key?.kind === "concrete" && element.keyTemplate !== undefined
          ) {
            diagnostics.push(
              uxilDiagnostic("UXIL-022", { element: element.name }, pos),
            );
          }
        }
      }
    }
  }

  return { registry, diagnostics };
}
