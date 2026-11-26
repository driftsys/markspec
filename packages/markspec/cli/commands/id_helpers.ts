/**
 * @module cli/commands/id_helpers
 *
 * Shared display-ID helpers used by next-id, create, and insert.
 * Extracts the copy-pasted `nextDisplayId` computation into one place.
 */

import {
  displayIdScopeFilter,
  displayIdScopesInUse,
  formatDisplayId,
  hasScopePlaceholder,
  highestDisplayIdNumber,
  isValidScope,
  parseDisplayIdPattern,
  type ProfileChain,
  SEGMENT_CLASS,
  substituteScope,
  validateDisplayIdPattern,
} from "../../core/mod.ts";

/** A named (counter-less) placeholder — `{name}`, `{scope}` — in a pattern. */
const NAMED_PLACEHOLDER_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/**
 * Render a *named* (counter-less) `display-id-pattern` as a fill-in
 * template: each `{name}` placeholder becomes its upper-cased identifier
 * for the author to replace by hand. e.g. `SWC_{name}` → `SWC_NAME`,
 * `X_{a}_{b}` → `X_A_B`. Literals are left untouched.
 *
 * The placeholder MUST be a slug-valid token, not `<name>`: an angle-bracket
 * placeholder is parsed as inline HTML, so a scaffold like `- [SWC_<name>]`
 * yields zero entries and fails `markspec check` (MSL-P003). Upper-casing the
 * identifier keeps the form slug-valid and matches the LSP snippet, whose
 * `${1:NAME}` tab stop renders to `SWC_NAME`.
 */
export function namedIdTemplate(pattern: string): string {
  return pattern.replace(
    NAMED_PLACEHOLDER_RE,
    (_, ident) => ident.toUpperCase(),
  );
}

/**
 * Compute the next display ID for a given pattern and existing entries.
 *
 * For a *numbered* pattern, parses the `{n:Nd}` counter, scans `entries`
 * for the highest existing number with the same prefix/suffix, and returns
 * `prefix + (max+1 zero-padded to N digits) + suffix`.
 *
 * A *named* (counter-less) type — e.g. `sw-component: "SWC_{name}"` (ADR-025)
 * — has no counter to mint. Rather than failing, this prints a "named type,
 * author the identifier yourself" note to stderr and returns a slug-valid
 * placeholder template (`SWC_NAME`) so `create` / `insert` scaffold a block
 * that still passes `markspec check`, and `next-id` prints the form to fill in.
 *
 * A numbered pattern with a `{scope}` placeholder (`SRS_{scope}_{n:04d}`)
 * needs `scope`, the `--scope` value: it replaces the placeholder, so the
 * number is the highest number in that scope plus one (#1038); an ID that
 * `displayIdScope` reads under another scope never counts
 * (`displayIdScopeFilter`). See {@linkcode resolveScopedPattern} for the
 * errors.
 *
 * Exits when `pattern` is genuinely malformed (which profile-load now
 * rejects upstream via PROFILE-TYPE-008, so this is a defensive fallback),
 * or when `scope` does not suit the pattern.
 */
export function nextDisplayId(
  pattern: string,
  entries: Iterable<{ displayId: string }>,
  scope?: string,
): string {
  // Read the entries once: the scope listing and the number scan both use
  // them, and an iterator such as `Map.values()` can be read only once.
  const entryList = [...entries];
  const shape = parseDisplayIdPattern(
    resolveScopedPattern(pattern, entryList, scope),
  );
  if (shape) {
    // For a `{scope}` pattern, an ID that displayIdScope reads under another
    // scope does not count, even when it starts with the scoped prefix
    // (`G_BR10001` is scope `BR1` for `G_{scope}{n:04d}`, not scope `BR`).
    const accept = scope === undefined
      ? undefined
      : displayIdScopeFilter(pattern, scope);
    const counted = accept
      ? entryList.filter((e) => accept(e.displayId))
      : entryList;
    return formatDisplayId(
      shape,
      highestDisplayIdNumber(shape, counted) + 1,
    );
  }
  const validation = validateDisplayIdPattern(pattern);
  if (validation.ok) {
    const template = namedIdTemplate(pattern);
    console.error(
      `note: '${pattern}' is a named (counter-less) type — not auto-numbered; ` +
        `author the identifier yourself by replacing the upper-case ` +
        `placeholder in '${template}'`,
    );
    return template;
  }
  console.error(
    `error: display-id-pattern '${pattern}' is invalid: ${validation.message}`,
  );
  Deno.exit(1);
}

/**
 * Apply the `--scope` value to `pattern`. For a numbered pattern with a
 * `{scope}` placeholder, returns the pattern with `scope` in place of the
 * placeholder. For any other pattern, returns it unchanged. Prints an error
 * and exits 1 when the pattern is numbered with `{scope}` and `scope` is
 * absent (the message lists the scopes `entries` already use), when `scope`
 * is set but the pattern is not a numbered pattern with `{scope}` (it has no
 * `{scope}`, or it has no counter, such as `XREQ_{scope}`), or when `scope`
 * is not one or more ASCII letters or digits.
 */
export function resolveScopedPattern(
  pattern: string,
  entries: Iterable<{ displayId: string }>,
  scope: string | undefined,
): string {
  if (!hasScopePlaceholder(pattern)) {
    if (scope === undefined) return pattern;
    console.error(
      `error: --scope applies only to a numbered display-id-pattern with a ` +
        `{scope} placeholder; '${pattern}' is not one`,
    );
    Deno.exit(1);
  }
  if (scope === undefined) {
    const inUse = displayIdScopesInUse(pattern, entries);
    const listing = inUse.length > 0
      ? `scopes in use: ${inUse.join(", ")}`
      : "no scope is in use yet";
    console.error(
      `error: display-id-pattern '${pattern}' has a {scope} placeholder; ` +
        `pass --scope <value> (${listing})`,
    );
    Deno.exit(1);
  }
  if (!isValidScope(scope)) {
    console.error(
      `error: --scope '${scope}' is invalid: a scope must match ` +
        `${SEGMENT_CLASS} (ASCII letters and digits only)`,
    );
    Deno.exit(1);
  }
  return substituteScope(pattern, scope);
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
