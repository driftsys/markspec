/**
 * @module typl/validator
 *
 * Cross-entry collision detection (TYPL-002 kind mismatch, TYPL-003
 * shape mismatch) and intra-entry undefined-typedef-reference checks
 * (TYPL-005).
 *
 * Per the v1 entry-local scope rule, typedef references are resolved
 * within the binding's own entry — references to typedefs declared in
 * other entries are TYPL-005 errors.
 *
 * See ADR-019.
 */
import type { Diagnostic, Entry } from "../model/mod.ts";
import type { Binding, Shape } from "./ast.ts";
import { typlDiagnostic } from "./diagnostics.ts";
import { buildTypeRegistry, type TypeRegistry } from "./registry.ts";

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

  // Cross-entry $Name collisions (TYPL-002 + TYPL-003)
  for (const [name, decls] of registry.bindings) {
    if (decls.length < 2) continue;
    const first = decls[0];
    for (let i = 1; i < decls.length; i++) {
      const dup = decls[i];
      if (dup.binding.kind !== first.binding.kind) {
        const td = typlDiagnostic(
          "TYPL-002",
          {
            name,
            kindA: dup.binding.kind,
            kindB: first.binding.kind,
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
      } else if (!shapesEqual(dup.binding.shape, first.binding.shape)) {
        const td = typlDiagnostic(
          "TYPL-003",
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

function shapesEqual(
  a: Shape | undefined,
  b: Shape | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// Re-export Binding for consumers that import from this module.
export type { Binding };
