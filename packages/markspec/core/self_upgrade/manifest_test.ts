import { assertEquals, assertThrows } from "@std/assert";
import {
  assertTrustedReleaseUrl,
  DEFAULT_RELEASES_API,
  DEFAULT_RELEASES_DOWNLOAD_BASE,
  parseSha256Line,
  releaseAssets,
  resolveReleaseEndpoints,
} from "./manifest.ts";

const BASE = "https://github.com/driftsys/markspec/releases/download";

Deno.test("releaseAssets: builds tarball + checksum URLs (linux)", () => {
  assertEquals(
    releaseAssets(BASE, "0.7.0", "x86_64-unknown-linux-gnu"),
    {
      tarballUrl: `${BASE}/v0.7.0/markspec-x86_64-unknown-linux-gnu.tar.gz`,
      checksumUrl:
        `${BASE}/v0.7.0/markspec-x86_64-unknown-linux-gnu.tar.gz.sha256`,
    },
  );
});

Deno.test("releaseAssets: accepts 'v' prefix on version (idempotent)", () => {
  assertEquals(
    releaseAssets(BASE, "v0.7.0", "x86_64-apple-darwin"),
    {
      tarballUrl: `${BASE}/v0.7.0/markspec-x86_64-apple-darwin.tar.gz`,
      checksumUrl: `${BASE}/v0.7.0/markspec-x86_64-apple-darwin.tar.gz.sha256`,
    },
  );
});

Deno.test("releaseAssets: builds windows URLs", () => {
  assertEquals(
    releaseAssets(BASE, "0.6.1", "x86_64-pc-windows-msvc"),
    {
      tarballUrl: `${BASE}/v0.6.1/markspec-x86_64-pc-windows-msvc.tar.gz`,
      checksumUrl:
        `${BASE}/v0.6.1/markspec-x86_64-pc-windows-msvc.tar.gz.sha256`,
    },
  );
});

Deno.test("parseSha256Line: 64-hex + double-space + basename", () => {
  const line =
    "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234  markspec-x86_64-unknown-linux-gnu.tar.gz";
  assertEquals(
    parseSha256Line(line),
    "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234",
  );
});

Deno.test("parseSha256Line: lowercases mixed-case hex", () => {
  const line =
    "ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234ABCD1234  markspec.tar.gz";
  assertEquals(
    parseSha256Line(line),
    "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234",
  );
});

Deno.test("parseSha256Line: tolerates trailing newline + extra whitespace", () => {
  const line =
    "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234  file.tar.gz\n";
  assertEquals(
    parseSha256Line(line),
    "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234",
  );
});

Deno.test("parseSha256Line: rejects line with no whitespace", () => {
  assertThrows(
    () => parseSha256Line("nodelimiterhereatall"),
    Error,
    "malformed sha256 line",
  );
});

Deno.test("parseSha256Line: rejects non-hex digest", () => {
  assertThrows(
    () => parseSha256Line("ZZ".repeat(32) + "  file.tar.gz"),
    Error,
    "malformed sha256 line",
  );
});

Deno.test("parseSha256Line: rejects wrong-length digest", () => {
  assertThrows(
    () => parseSha256Line("abcd  file.tar.gz"),
    Error,
    "malformed sha256 line",
  );
});

// ---------------------------------------------------------------------------
// resolveReleaseEndpoints — URL overrides are test-mode-only (issue #580)
// ---------------------------------------------------------------------------

Deno.test("resolveReleaseEndpoints: production ignores env overrides", () => {
  assertEquals(
    resolveReleaseEndpoints({
      testMode: false,
      apiOverride: "https://github.com/attacker/evil/releases",
      downloadOverride: "http://evil.invalid/download",
    }),
    {
      apiBase: DEFAULT_RELEASES_API,
      downloadBase: DEFAULT_RELEASES_DOWNLOAD_BASE,
    },
  );
});

Deno.test("resolveReleaseEndpoints: production with no overrides uses defaults", () => {
  assertEquals(
    resolveReleaseEndpoints({ testMode: false }),
    {
      apiBase: DEFAULT_RELEASES_API,
      downloadBase: DEFAULT_RELEASES_DOWNLOAD_BASE,
    },
  );
});

Deno.test("resolveReleaseEndpoints: test mode honors overrides", () => {
  assertEquals(
    resolveReleaseEndpoints({
      testMode: true,
      apiOverride: "http://127.0.0.1:8080/releases",
      downloadOverride: "http://127.0.0.1:8080/releases/download",
    }),
    {
      apiBase: "http://127.0.0.1:8080/releases",
      downloadBase: "http://127.0.0.1:8080/releases/download",
    },
  );
});

Deno.test("resolveReleaseEndpoints: test mode with a missing override falls back to default", () => {
  assertEquals(
    resolveReleaseEndpoints({
      testMode: true,
      downloadOverride: "http://127.0.0.1:8080/releases/download",
    }),
    {
      apiBase: DEFAULT_RELEASES_API,
      downloadBase: "http://127.0.0.1:8080/releases/download",
    },
  );
});

// ---------------------------------------------------------------------------
// assertTrustedReleaseUrl — scheme + host pinning (issue #580)
// ---------------------------------------------------------------------------

Deno.test("assertTrustedReleaseUrl: accepts https github.com hosts", () => {
  assertTrustedReleaseUrl(DEFAULT_RELEASES_API, { allowInsecure: false });
  assertTrustedReleaseUrl(DEFAULT_RELEASES_DOWNLOAD_BASE, {
    allowInsecure: false,
  });
  assertTrustedReleaseUrl(
    "https://objects.githubusercontent.com/foo",
    { allowInsecure: false },
  );
});

Deno.test("assertTrustedReleaseUrl: rejects non-https scheme in production", () => {
  assertThrows(
    () =>
      assertTrustedReleaseUrl("http://github.com/driftsys/markspec", {
        allowInsecure: false,
      }),
    Error,
    "insecure transport",
  );
});

Deno.test("assertTrustedReleaseUrl: rejects untrusted host in production", () => {
  assertThrows(
    () =>
      assertTrustedReleaseUrl("https://evil.invalid/driftsys/markspec", {
        allowInsecure: false,
      }),
    Error,
    "untrusted host",
  );
});

Deno.test("assertTrustedReleaseUrl: rejects a non-github https host even under allowInsecure", () => {
  assertThrows(
    () =>
      assertTrustedReleaseUrl("https://evil.invalid/x", {
        allowInsecure: true,
      }),
    Error,
    "untrusted host",
  );
});

Deno.test("assertTrustedReleaseUrl: allows http localhost only under allowInsecure", () => {
  assertTrustedReleaseUrl("http://127.0.0.1:8080/releases", {
    allowInsecure: true,
  });
  assertTrustedReleaseUrl("http://localhost:8080/releases", {
    allowInsecure: true,
  });
  assertThrows(
    () =>
      assertTrustedReleaseUrl("http://127.0.0.1:8080/releases", {
        allowInsecure: false,
      }),
    Error,
    "insecure transport",
  );
});

Deno.test("assertTrustedReleaseUrl: rejects a malformed URL", () => {
  assertThrows(
    () => assertTrustedReleaseUrl("not a url", { allowInsecure: false }),
    Error,
    "invalid release URL",
  );
});
