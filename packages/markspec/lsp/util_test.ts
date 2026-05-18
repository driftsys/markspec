/**
 * @module lsp/util_test
 *
 * Unit tests for LSP utility functions.
 */

import { assertEquals } from "@std/assert";
import { debounce, pathToUri, uriToPath } from "./util.ts";

Deno.test("uriToPath: converts file URI to path", () => {
  assertEquals(
    uriToPath("file:///Users/dev/project/foo.md"),
    "/Users/dev/project/foo.md",
  );
});

Deno.test("uriToPath: decodes percent-encoded characters", () => {
  assertEquals(
    uriToPath("file:///Users/dev/my%20project/foo.md"),
    "/Users/dev/my project/foo.md",
  );
});

Deno.test("pathToUri: converts path to file URI", () => {
  assertEquals(
    pathToUri("/Users/dev/project/foo.md"),
    "file:///Users/dev/project/foo.md",
  );
});

Deno.test("pathToUri: encodes spaces", () => {
  assertEquals(
    pathToUri("/Users/dev/my project/foo.md"),
    "file:///Users/dev/my%20project/foo.md",
  );
});

Deno.test("pathToUri: preserves valid URI characters like parentheses", () => {
  assertEquals(
    pathToUri("/foo/bar(1).md"),
    "file:///foo/bar(1).md",
  );
});

Deno.test("pathToUri/uriToPath round-trip", () => {
  const path = "/Users/dev/project/foo.md";
  assertEquals(uriToPath(pathToUri(path)), path);
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
