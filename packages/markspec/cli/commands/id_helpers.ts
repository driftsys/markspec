/**
 * @module cli/commands/id_helpers
 *
 * Shared display-ID helpers used by next-id, create, and insert.
 * Extracts the copy-pasted `nextDisplayId` computation into one place.
 */

import type { ProfileChain } from "../../core/mod.ts";

/**
 * Compute the next display ID for a given pattern and existing entries.
 *
 * Parses the `{n:Nd}` placeholder from `pattern`, scans `entries` for
 * the highest existing number with the same prefix/suffix, and returns
 * `prefix + (max+1 zero-padded to N digits) + suffix`.
 *
 * Exits with an error message if `pattern` contains no valid `{n:Nd}`
 * placeholder.
 */
export function nextDisplayId(
  pattern: string,
  entries: Iterable<{ displayId: string }>,
): string {
  const placeholderMatch = /\{n:(\d+)d\}/.exec(pattern);
  if (!placeholderMatch) {
    console.error(
      `error: display-id-pattern '${pattern}' does not contain a recognised number placeholder ('{n:Nd}')`,
    );
    Deno.exit(1);
  }
  const width = parseInt(placeholderMatch[1], 10);
  const prefix = pattern.slice(0, placeholderMatch.index);
  const suffix = pattern.slice(
    placeholderMatch.index + placeholderMatch[0].length,
  );
  let max = 0;
  for (const entry of entries) {
    const id = entry.displayId;
    if (!id.startsWith(prefix)) continue;
    if (suffix && !id.endsWith(suffix)) continue;
    const numberPart = id.slice(prefix.length, id.length - suffix.length);
    const n = parseInt(numberPart, 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(width, "0")}${suffix}`;
}

/**
 * Resolve the display-id-pattern for a named type from the active profile chain,
 * exiting with an informative error when the type or pattern is absent.
 */
export function resolveTypePattern(
  typeName: string,
  chain: ProfileChain,
  _commandName: string,
): string {
  const typeEntry = chain.effective.types.get(typeName);
  if (!typeEntry) {
    console.error(
      `error: type '${typeName}' is not declared by the active profile`,
    );
    Deno.exit(1);
  }
  const pattern = typeEntry.value.displayIdPattern.value;
  if (!pattern) {
    console.error(
      `error: type '${typeName}' has no display-id-pattern`,
    );
    Deno.exit(1);
  }
  return pattern;
}
