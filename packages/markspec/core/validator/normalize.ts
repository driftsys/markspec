/**
 * @module core/validator/normalize
 *
 * Stage 2.5 normalization: split comma-separated values for profile-declared
 * list-typed attributes.
 *
 * Runs between Stage 2 (classification) and Stage 3 (typed attributes). The
 * core parser already CSV-splits values for core-catalog list types; this
 * step handles list types declared by a profile (which the parser doesn't
 * see). Idempotent — values that don't contain commas pass through unchanged.
 *
 * Empty-string fragments (e.g. from `"a,,b"`) are dropped; surrounding
 * whitespace is trimmed.
 */

import type { EffectiveProfile, Entry, ValueType } from "../model/mod.ts";
import { effectiveScope } from "./attributes.ts";

const LIST_TYPES: ReadonlySet<ValueType> = new Set(["id-list", "tag-list"]);

/**
 * Return a new Entry with list-typed attribute values split on commas. If no
 * change is needed, returns the input entry unchanged (reference equality).
 */
export function normalizeListValues(
  entry: Entry,
  profile: EffectiveProfile,
): Entry {
  const scope = effectiveScope(entry, profile);
  const rewritten = new Map<string, readonly string[]>();
  let anyChange = false;

  for (const [name, values] of entry.typedAttributes) {
    const decl = scope.attributes.get(name);
    if (decl !== undefined && LIST_TYPES.has(decl.type)) {
      const split = splitListValues(values);
      if (!arraysEqual(split, values)) {
        rewritten.set(name, split);
        anyChange = true;
        continue;
      }
    }
    rewritten.set(name, values);
  }

  if (!anyChange) return entry;
  return { ...entry, typedAttributes: rewritten };
}

function splitListValues(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const v of values) {
    const parts = v.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    if (parts.length === 0) continue;
    out.push(...parts);
  }
  return out;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
