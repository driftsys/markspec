/**
 * @module lsp/util_test
 *
 * Unit tests for LSP utility functions.
 */

import { assertEquals } from "@std/assert";
import {
  _pathToUriPosix,
  _pathToUriWindows,
  _uriToPathPosix,
  _uriToPathWindows,
  debounce,
  pathToUri,
  uriToPath,
} from "./util.ts";

// The host-platform-default `pathToUri` / `uriToPath` accept the host
// platform's path form (drive-letter on Windows, POSIX elsewhere). The
// suite exercises both shapes through the `_*Posix` / `_*Windows`
// helpers below so the same fixtures run identically on every runner.

Deno.test("_uriToPathPosix: converts file URI to path", () => {
  assertEquals(
    _uriToPathPosix("file:///Users/dev/project/foo.md"),
    "/Users/dev/project/foo.md",
  );
});

Deno.test("_uriToPathPosix: decodes percent-encoded characters", () => {
  assertEquals(
    _uriToPathPosix("file:///Users/dev/my%20project/foo.md"),
    "/Users/dev/my project/foo.md",
  );
});

Deno.test("_pathToUriPosix: converts path to file URI", () => {
  assertEquals(
    _pathToUriPosix("/Users/dev/project/foo.md"),
    "file:///Users/dev/project/foo.md",
  );
});

Deno.test("_pathToUriPosix: encodes spaces", () => {
  assertEquals(
    _pathToUriPosix("/Users/dev/my project/foo.md"),
    "file:///Users/dev/my%20project/foo.md",
  );
});

Deno.test("_pathToUriPosix: preserves valid URI characters like parentheses", () => {
  assertEquals(
    _pathToUriPosix("/foo/bar(1).md"),
    "file:///foo/bar(1).md",
  );
});

// Platform-default round-trip: exercises whichever pair `pathToUri` /
// `uriToPath` is wired to at runtime. Uses `Deno.cwd()` so the input
// is guaranteed to be a valid host-platform path.
Deno.test("pathToUri/uriToPath round-trip (host platform)", () => {
  const path = Deno.cwd();
  assertEquals(uriToPath(pathToUri(path)), path);
});

// ---------------------------------------------------------------------------
// Windows path handling — exercised via the platform-specific internal helpers
// so the tests run identically on macOS, Linux, and Windows CI.
// ---------------------------------------------------------------------------

Deno.test("_pathToUriWindows: converts drive-letter path to file URI", () => {
  assertEquals(
    _pathToUriWindows("C:\\Users\\dev\\project\\foo.md"),
    "file:///C:/Users/dev/project/foo.md",
  );
});

Deno.test("_pathToUriWindows: encodes spaces in Windows paths", () => {
  assertEquals(
    _pathToUriWindows("C:\\Users\\dev\\my project\\foo.md"),
    "file:///C:/Users/dev/my%20project/foo.md",
  );
});

Deno.test("_uriToPathWindows: converts file URI to drive-letter path", () => {
  assertEquals(
    _uriToPathWindows("file:///C:/Users/dev/project/foo.md"),
    "C:\\Users\\dev\\project\\foo.md",
  );
});

Deno.test("_uriToPathWindows: decodes percent-encoded characters", () => {
  assertEquals(
    _uriToPathWindows("file:///C:/Users/dev/my%20project/foo.md"),
    "C:\\Users\\dev\\my project\\foo.md",
  );
});

Deno.test("_pathToUriWindows/_uriToPathWindows round-trip", () => {
  const path = "C:\\Users\\dev\\project\\foo.md";
  assertEquals(_uriToPathWindows(_pathToUriWindows(path)), path);
});

Deno.test("_pathToUriWindows/_uriToPathWindows round-trip with Unicode", () => {
  const path = "C:\\Users\\dev\\café\\日本語.md";
  assertEquals(_uriToPathWindows(_pathToUriWindows(path)), path);
});

Deno.test("_pathToUriPosix/_uriToPathPosix round-trip", () => {
  const path = "/Users/dev/project/foo.md";
  assertEquals(_uriToPathPosix(_pathToUriPosix(path)), path);
});

Deno.test("debounce: calls function after delay", async () => {
  let callCount = 0;
  const fn = debounce(() => {
    callCount++;
  }, 50);
  fn();
  fn();
  fn();
  assertEquals(callCount, 0);
  await new Promise((r) => setTimeout(r, 100));
  assertEquals(callCount, 1);
});

Deno.test("debounce: cancel prevents execution", async () => {
  let callCount = 0;
  const fn = debounce(() => {
    callCount++;
  }, 50);
  fn();
  fn.cancel();
  await new Promise((r) => setTimeout(r, 100));
  assertEquals(callCount, 0);
});
