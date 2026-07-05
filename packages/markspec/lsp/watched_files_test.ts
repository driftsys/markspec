import { assertEquals } from "@std/assert";
import { isLockfileOnlyChange } from "./watched_files.ts";

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
