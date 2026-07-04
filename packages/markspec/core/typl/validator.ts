/**
 * @module typl/validator
 *
 * Published tier (#723): corpus-wide declared-once enforcement for dotted
 * ($published) names (TYPL-009) and citation resolution for bare
 * published-shaped code spans (TYPL-010 relative-with-no-root, TYPL-011
 * undeclared symbol) — plus intra-entry undefined-typedef-reference checks
 * (TYPL-005).
 *
 * TYPL-002 (kind mismatch) and TYPL-003 (shape mismatch) are retired: the
 * v1 cross-entry collision rule they implemented applied to plain (entry-
 * local) names, which the published tier deliberately leaves unchecked
 * across entries — only dotted, corpus-wide names are declared exactly
 * once. The codes remain in the catalogue (deprecated) but this validator
 * never emits them.
 *
 * Per the v1 entry-local scope rule, typedef references are resolved
 * within the binding's own entry — references to typedefs declared in
 * other entries are TYPL-005 errors.
 *
 * See ADR-019.
 */
import type { Diagnostic, Entry } from "../model/mod.ts";
import type { Binding, Shape } from "./ast.ts";
import { extractTyplCitations } from "./citations.ts";
import { resolveRef } from "../decl/mod.ts";
import { typlDiagnostic } from "./diagnostics.ts";
import { buildTypeRegistry, type TypeRegistry } from "./registry.ts";
import { TYPL_REF_OPS } from "./resolve.ts";

/**
 * Validate the typl declarations across all entries.
 *
 * Returns the built corpus registry plus any diagnostics. The registry
 * is returned even when diagnostics are present so callers (compiler,
 * LSP) can use it for navigation and emission.
 */
export function validateTypl(
  entries: readonly Entry[],
): { registry: TypeRegistry; diagnostics: readonly Diagnostic[] } {
  const registry = buildTypeRegistry(entries);
  const diagnostics: Diagnostic[] = [];

  // Published tier (#723): dotted names are declared exactly once
  // corpus-wide — every declaration after the first is TYPL-009. Plain
  // (entry-local) names have no cross-entry rule: TYPL-002/003 are
  // retired (deprecated, never emitted — see diagnostics.ts).
  for (const [name, decls] of registry.bindings) {
    if (decls.length < 2) continue;
    if (!name.includes(".")) continue;
    const first = decls[0];
    for (let i = 1; i < decls.length; i++) {
      const dup = decls[i];
      const td = typlDiagnostic(
        "TYPL-009",
        {
          name,
          otherFile: first.entryFile,
          otherLine: first.binding.position.line,
        },
        dup.binding.position,
      );
      diagnostics.push({
        code: td.code,
        severity: td.severity,
        message: td.message,
        location: { file: dup.entryFile, line: 1, column: 1 },
      });
    }
  }

  // Citation validation (#723): bare published-shaped code spans must
  // resolve (relative → entry root namespace) to a declared symbol.
  for (const entry of entries) {
    const citations = extractTyplCitations(entry.bodyTokens);
    if (citations.length === 0) continue;
    const root = entry.types?.rootNamespace;
    const scope = root !== undefined ? { base: root } : undefined;
    for (const citation of citations) {
      const res = resolveRef(citation.name, scope, TYPL_REF_OPS);
      if (!res.ok) {
        const td = typlDiagnostic(
          "TYPL-010",
          { name: citation.name },
          { line: citation.location.line, column: citation.location.column },
        );
        diagnostics.push({
          code: td.code,
          severity: td.severity,
          message: td.message,
          location: citation.location,
        });
        continue;
      }
      if (!registry.bindings.has(res.ref)) {
        const td = typlDiagnostic(
          "TYPL-011",
          { name: res.ref },
          { line: citation.location.line, column: citation.location.column },
        );
        diagnostics.push({
          code: td.code,
          severity: td.severity,
          message: td.message,
          location: citation.location,
        });
      }
    }
  }

  // Intra-entry undefined typedef ref (TYPL-005)
  for (const entry of entries) {
    if (!entry.types) continue;
    const localTypedefs = new Set(entry.types.typedefs.map((t) => t.name));
    for (const binding of entry.types.bindings) {
      if (binding.shape) {
        collectRefDiagnostics(
          binding.shape,
          localTypedefs,
          entry,
          binding.position.line,
          diagnostics,
        );
      }
    }
    for (const typedef of entry.types.typedefs) {
      collectRefDiagnostics(
        typedef.shape,
        localTypedefs,
        entry,
        typedef.position.line,
        diagnostics,
      );
    }
  }

  return { registry, diagnostics };
}

function collectRefDiagnostics(
  shape: Shape,
  localTypedefs: ReadonlySet<string>,
  entry: Entry,
  line: number,
  out: Diagnostic[],
): void {
  switch (shape.kind) {
    case "ref":
      if (!localTypedefs.has(shape.name)) {
        const td = typlDiagnostic(
          "TYPL-005",
          { name: shape.name },
          { line: 1, column: 1 },
        );
        out.push({
          code: td.code,
          severity: td.severity,
          message: td.message,
          location: { file: entry.location.file, line, column: 1 },
        });
      }
      break;
    case "array":
      collectRefDiagnostics(shape.element, localTypedefs, entry, line, out);
      break;
    case "optional":
      collectRefDiagnostics(shape.inner, localTypedefs, entry, line, out);
      break;
    case "record":
      for (const fieldShape of Object.values(shape.fields)) {
        collectRefDiagnostics(fieldShape, localTypedefs, entry, line, out);
      }
      break;
      // All other variants (primitive, range, length, pattern, enum, literal)
      // are leaves with no nested shape — nothing to recurse into.
  }
}

// Re-export Binding for consumers that import from this module.
export type { Binding };
