/**
 * @module core/lock/compare
 *
 * Pure comparison utilities for lockfile-related version data.
 * Consumed by the LSP extension (slice C) and `markspec doctor`
 * (slice F) to surface skew between the project's declared
 * `[meta.toolchain].min-version` floor and the running CLI's release
 * version.
 *
 * Keeping this in the lock module makes the comparison the SSOT —
 * downstream consumers import one function rather than reinventing
 * parsing + comparison logic each time.
 */

/**
 * Strict MAJOR.MINOR grammar — must match the parser's MIN_VERSION_RE.
 * Used to validate the `floor` argument.
 */
const FLOOR_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Prefix-match grammar for the running binary's VERSION string. Accepts
 * standard semver (MAJOR.MINOR.PATCH and optional pre-release/build),
 * extracting only the major + minor pair.
 */
const ACTUAL_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\.|[-+]|$)/;

/**
 * Returns `true` when `actualVersion` is strictly below `floor`,
 * compared as `(major, minor)` tuples. The patch component of
 * `actualVersion` is ignored.
 *
 * Returns `false` when `floor` is `undefined` (project declares no
 * floor) or when `actualVersion >= floor`.
 *
 * Throws `Error` if either argument is not in the expected grammar.
 * Callers should pass values that originated from the parsed lockfile
 * model (`LockfileToolchain.minVersion`, already validated at parse
 * time) and from `VERSION` (a known-good semver constant).
 *
 * @example
 * isBelowFloor("0.6.1", "0.6")  // false
 * isBelowFloor("0.5.99", "0.6") // true
 * isBelowFloor("0.7.0", "0.6")  // false
 * isBelowFloor("0.6.1", undefined) // false (no floor)
 */
export function isBelowFloor(
  actualVersion: string,
  floor: string | undefined,
): boolean {
  if (floor === undefined) return false;
  const f = FLOOR_RE.exec(floor);
  if (!f) {
    throw new Error(`isBelowFloor: invalid floor ${JSON.stringify(floor)}`);
  }
  const a = ACTUAL_RE.exec(actualVersion);
  if (!a) {
    throw new Error(
      `isBelowFloor: invalid actualVersion ${JSON.stringify(actualVersion)}`,
    );
  }
  const fMajor = parseInt(f[1], 10);
  const fMinor = parseInt(f[2], 10);
  const aMajor = parseInt(a[1], 10);
  const aMinor = parseInt(a[2], 10);
  if (aMajor < fMajor) return true;
  if (aMajor > fMajor) return false;
  return aMinor < fMinor;
}
