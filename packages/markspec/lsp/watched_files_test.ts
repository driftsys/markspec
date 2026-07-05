import { assertEquals } from "@std/assert";
import { isLockfileOnlyChange, relevantWatchedUris } from "./watched_files.ts";

Deno.test("isLockfileOnlyChange: lock-only batch → true", () => {
  assertEquals(isLockfileOnlyChange(["file:///proj/markspec.lock"]), true);
});

Deno.test("isLockfileOnlyChange: profile file → false", () => {
  assertEquals(isLockfileOnlyChange(["file:///proj/.markspec.yaml"]), false);
});

Deno.test("isLockfileOnlyChange: mixed batch → false", () => {
  assertEquals(
    isLockfileOnlyChange([
      "file:///proj/markspec.lock",
      "file:///proj/project.yaml",
    ]),
    false,
  );
});

Deno.test("isLockfileOnlyChange: empty batch → false", () => {
  assertEquals(isLockfileOnlyChange([]), false);
});

Deno.test("relevantWatchedUris: drops .md and other unowned files, keeps the three watched files", () => {
  assertEquals(
    relevantWatchedUris([
      "file:///proj/docs/reqs.md",
      "file:///proj/markspec.lock",
      "file:///proj/.markspec.yaml",
      "file:///proj/sub/project.yaml",
      "file:///proj/src/main.rs",
    ]),
    [
      "file:///proj/markspec.lock",
      "file:///proj/.markspec.yaml",
      "file:///proj/sub/project.yaml",
    ],
  );
});

Deno.test("relevantWatchedUris: all-unowned batch → empty", () => {
  assertEquals(relevantWatchedUris(["file:///proj/a.md"]), []);
});
