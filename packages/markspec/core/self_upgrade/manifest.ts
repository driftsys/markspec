/**
 * @module core/self_upgrade/manifest
 *
 * Build the release tarball + SHA-256 URLs for a (version, target) pair,
 * and parse the single-line .sha256 files produced by sha256sum /
 * shasum -a 256 in the release workflow. Pure — no I/O.
 *
 * The .sha256 line format is the standard one shared by GNU coreutils
 * sha256sum and BSD/macOS shasum: `<64-hex>  <basename>` with a two-space
 * separator. We accept a trailing newline and lowercase the digest so
 * callers can compare strings directly.
 */

export interface ReleaseAssets {
  readonly tarballUrl: string;
  readonly checksumUrl: string;
}

const SHA256_LINE_RE = /^([0-9a-fA-F]{64})\s+(\S.*?)\s*$/;

/** Build the tarball + checksum URLs for a (version, target). */
export function releaseAssets(
  baseUrl: string,
  version: string,
  target: string,
): ReleaseAssets {
  const tag = version.startsWith("v") ? version : `v${version}`;
  const tarballUrl = `${baseUrl}/${tag}/markspec-${target}.tar.gz`;
  const checksumUrl = `${tarballUrl}.sha256`;
  return { tarballUrl, checksumUrl };
}

/** Parse a single sha256sum-format line; return the lowercase hex digest. */
export function parseSha256Line(line: string): string {
  const m = SHA256_LINE_RE.exec(line);
  if (!m) throw new Error(`malformed sha256 line: ${JSON.stringify(line)}`);
  return m[1].toLowerCase();
}
