/**
 * @module core/self_upgrade/compare
 *
 * Strict semver-tuple comparison for self-upgrade. Three outcomes:
 *   - "up-to-date"      current === target
 *   - "newer-available" current  <  target
 *   - "downgrade"       current  >  target
 *
 * Accepts an optional leading 'v' on either arg. Rejects pre-release
 * and build-metadata suffixes — the CLI only ships clean MAJOR.MINOR.PATCH
 * tags and any drift means the input is malformed.
 *
 * Throws `Error` on malformed input; callers pass the compiled-in
 * VERSION constant (known good) and the parsed GitHub `tag_name` (also
 * known good if `releases/latest` returned successfully).
 */

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export type Comparison = "up-to-date" | "newer-available" | "downgrade";

export function compareVersions(current: string, target: string): Comparison {
  const c = parse(current);
  const t = parse(target);
  if (c[0] !== t[0]) return c[0] < t[0] ? "newer-available" : "downgrade";
  if (c[1] !== t[1]) return c[1] < t[1] ? "newer-available" : "downgrade";
  if (c[2] !== t[2]) return c[2] < t[2] ? "newer-available" : "downgrade";
  return "up-to-date";
}

function parse(s: string): [number, number, number] {
  const stripped = s.startsWith("v") ? s.slice(1) : s;
  const m = VERSION_RE.exec(stripped);
  if (!m) throw new Error(`invalid version: ${JSON.stringify(s)}`);
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}
