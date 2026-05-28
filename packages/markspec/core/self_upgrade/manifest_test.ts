import { assertEquals, assertThrows } from "@std/assert";
import { parseSha256Line, releaseAssets } from "./manifest.ts";

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
