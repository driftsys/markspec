/**
 * @module core/self_upgrade/manifest
 *
 * Build the release tarball + SHA-256 URLs for a (version, target) pair,
 * parse the single-line .sha256 files produced by sha256sum / shasum -a 256
 * in the release workflow, and pin the release endpoints to the canonical
 * GitHub origin. Pure — no I/O.
 *
 * The .sha256 line format is the standard one shared by GNU coreutils
 * sha256sum and BSD/macOS shasum: `<64-hex>  <basename>` with a two-space
 * separator. We accept a trailing newline and lowercase the digest so
 * callers can compare strings directly.
 *
 * Release-endpoint pinning ({@linkcode resolveReleaseEndpoints} +
 * {@linkcode assertTrustedReleaseUrl}) ensures a self-upgrade can only fetch
 * from the canonical github.com origin in production — the env overrides are
 * test-mode-only (issue #580).
 */

export interface ReleaseAssets {
  readonly tarballUrl: string;
  readonly checksumUrl: string;
}

/** Pinned GitHub releases API endpoint for the canonical markspec repo. */
export const DEFAULT_RELEASES_API =
  "https://api.github.com/repos/driftsys/markspec/releases";

/** Pinned GitHub release-asset download base for the canonical markspec repo. */
export const DEFAULT_RELEASES_DOWNLOAD_BASE =
  "https://github.com/driftsys/markspec/releases/download";

/**
 * Hosts the self-upgrade fetches are permitted to contact in production.
 * `objects.githubusercontent.com` is GitHub's release-asset CDN — a
 * `releases/download` URL 302-redirects there, and `fetch` follows the
 * redirect, so it must be on the allowlist even though we never build a
 * URL pointing at it directly.
 */
const TRUSTED_RELEASE_HOSTS: ReadonlySet<string> = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
]);

const SHA256_LINE_RE = /^([0-9a-fA-F]{64})\s+(\S.*?)\s*$/;

/** Inputs to {@linkcode resolveReleaseEndpoints}. */
export interface ResolveEndpointsInput {
  /**
   * `true` only when `MARKSPEC_TEST_MODE=1`. Gates the env overrides —
   * see {@linkcode resolveReleaseEndpoints}.
   */
  readonly testMode: boolean;
  /** Value of `MARKSPEC_RELEASES_API`, if set. */
  readonly apiOverride?: string;
  /** Value of `MARKSPEC_RELEASES_DOWNLOAD_BASE`, if set. */
  readonly downloadOverride?: string;
}

/** Resolved release endpoints. */
export interface ReleaseEndpoints {
  readonly apiBase: string;
  readonly downloadBase: string;
}

/**
 * Resolve the releases-API and download-base URLs, honouring the
 * `MARKSPEC_RELEASES_API` / `MARKSPEC_RELEASES_DOWNLOAD_BASE` overrides
 * **only** under `MARKSPEC_TEST_MODE=1` (`input.testMode`). In production
 * the pinned `DEFAULT_RELEASES_*` constants are always returned, so a stray
 * or hostile env var in the user's shell cannot redirect a self-upgrade to
 * an attacker-controlled origin (issue #580) — the same gating the
 * `MARKSPEC_SELF_UPGRADE_BIN_PATH` override already uses. A missing override
 * under test mode falls back to the pinned default for that endpoint.
 */
export function resolveReleaseEndpoints(
  input: ResolveEndpointsInput,
): ReleaseEndpoints {
  const apiBase = input.testMode && input.apiOverride
    ? input.apiOverride
    : DEFAULT_RELEASES_API;
  const downloadBase = input.testMode && input.downloadOverride
    ? input.downloadOverride
    : DEFAULT_RELEASES_DOWNLOAD_BASE;
  return { apiBase, downloadBase };
}

/**
 * Assert that a release-endpoint URL is safe to fetch from, throwing
 * otherwise. Defence-in-depth for {@linkcode resolveReleaseEndpoints}: even
 * if a future change reintroduces an unconditional override, no fetch can
 * reach an insecure or non-GitHub origin.
 *
 * In production (`allowInsecure: false`) the URL MUST use `https:` and a
 * host in the GitHub allowlist (`github.com`, `api.github.com`,
 * `objects.githubusercontent.com`). Under test mode (`allowInsecure: true`)
 * an `http(s)` URL to `localhost` / `127.0.0.1` / `[::1]` is additionally
 * permitted so the e2e suite can point at a local mock server; every other
 * host still falls through to the production https-+-allowlist check.
 *
 * @throws Error when the URL is malformed, uses a non-https scheme, or
 *   targets a host outside the allowlist.
 */
export function assertTrustedReleaseUrl(
  rawUrl: string,
  opts: { allowInsecure: boolean },
): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`invalid release URL: ${JSON.stringify(rawUrl)}`);
  }
  if (opts.allowInsecure) {
    const isLoopback = url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (
      isLoopback && (url.protocol === "http:" || url.protocol === "https:")
    ) {
      return;
    }
  }
  if (url.protocol !== "https:") {
    throw new Error(
      `refusing to self-upgrade over insecure transport: ${url.protocol}//${url.host} (only https: is permitted)`,
    );
  }
  if (!TRUSTED_RELEASE_HOSTS.has(url.hostname)) {
    throw new Error(
      `refusing to self-upgrade from untrusted host: ${url.host} (permitted: ${
        [...TRUSTED_RELEASE_HOSTS].join(", ")
      })`,
    );
  }
}

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
