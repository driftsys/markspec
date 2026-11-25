/**
 * @module core/model/profile_typed_keys
 *
 * The rule that decides which profile-declared attribute values are trimmed
 * of all whitespace (#990).
 *
 * The parser has no profile. It trims the value of a typed core attribute
 * (an `Id:`, a trace link, a label, ...) with JavaScript `trim()`, but it
 * keeps a U+FEFF or a non-breaking space (U+00A0) at either end of any other
 * value, as free text. A profile-declared attribute whose type is not `text`
 * must behave like a typed core attribute, so the validator pipeline,
 * `markspec fmt` and `markspec compile` trim its value with the functions of
 * this module once a profile is loaded.
 *
 * The formatter and the compiler do not always know the type of an entry,
 * so the rule does not depend on it: a key is a profile typed key when the
 * effective profile declares it with a type other than `text` (as a
 * universal attribute, a type-scoped attribute, or a trace rule name, which
 * is an implicit `id-list` attribute) and no declaration gives it the type
 * `text`. Keys are compared in canonical case (first character upper case,
 * every other character lower case), the case `markspec fmt` writes and the
 * case the parser uses to look up a core attribute.
 */

import type { Attribute, Entry } from "./mod.ts";
import type { EffectiveProfile } from "./profile.ts";

/** `key` in canonical case: `HAZARD` and `hazard` are `Hazard`. */
function canonicalCase(key: string): string {
  if (key.length === 0) return key;
  return key[0].toUpperCase() + key.slice(1).toLowerCase();
}

/**
 * The canonical-case keys whose values are trimmed of all whitespace under
 * `profile`: every key the profile declares with a type other than `text`
 * (universal attributes, type-scoped attributes, and trace rule names), less
 * every key that some declaration gives the type `text`.
 */
export function profileTypedKeys(
  profile: EffectiveProfile,
): ReadonlySet<string> {
  const typed = new Set<string>();
  const text = new Set<string>();
  const note = (name: string, type: string) =>
    (type === "text" ? text : typed).add(canonicalCase(name));
  for (const [name, { value }] of profile.attributes) note(name, value.type);
  for (const [, { value: typeDef }] of profile.types) {
    for (const [name, { value }] of typeDef.attributes) {
      note(name, value.type);
    }
    // A trace rule is an implicit `id-list` attribute (`effectiveScope`).
    for (const [name] of typeDef.traceability) note(name, "id-list");
  }
  for (const key of text) typed.delete(key);
  return typed;
}

/**
 * Trim the values of the keys in `typedKeys` (canonical case, see
 * {@linkcode profileTypedKeys}) with JavaScript `trim()`, in
 * `rawAttributes` and `typedAttributes`. A key is matched in canonical
 * case, so `HAZARD:` matches `Hazard`. A value that is empty after the trim
 * is dropped, as the parser drops an empty value, together with its line in
 * `attributeLines`. Other values, including free text, are unchanged. An
 * entry with nothing to change is returned as is (reference equality).
 */
export function trimProfileTypedValues(
  entries: readonly Entry[],
  typedKeys: ReadonlySet<string>,
): Entry[] {
  if (typedKeys.size === 0) return [...entries];
  return entries.map((entry) => trimEntry(entry, typedKeys));
}

function trimEntry(entry: Entry, typedKeys: ReadonlySet<string>): Entry {
  const isTyped = (key: string) => typedKeys.has(canonicalCase(key));
  const needsTrim = (value: string) => value !== value.trim();
  const changed =
    entry.rawAttributes.some((a) => isTyped(a.key) && needsTrim(a.value)) ||
    [...entry.typedAttributes].some(([key, values]) =>
      isTyped(key) && values.some(needsTrim)
    );
  if (!changed) return entry;

  const rawAttributes: Attribute[] = [];
  const attributeLines: number[] = [];
  entry.rawAttributes.forEach((attr, index) => {
    const value = isTyped(attr.key) ? attr.value.trim() : attr.value;
    if (value.length === 0) return;
    rawAttributes.push(value === attr.value ? attr : { ...attr, value });
    const line = entry.attributeLines?.[index];
    if (line !== undefined) attributeLines.push(line);
  });
  const typedAttributes = new Map<string, readonly string[]>();
  for (const [key, values] of entry.typedAttributes) {
    if (!isTyped(key)) {
      typedAttributes.set(key, values);
      continue;
    }
    const trimmed = values.map((v) => v.trim()).filter((v) => v.length > 0);
    if (trimmed.length > 0) typedAttributes.set(key, trimmed);
  }
  return {
    ...entry,
    rawAttributes,
    typedAttributes,
    ...(entry.attributeLines ? { attributeLines } : {}),
  };
}
