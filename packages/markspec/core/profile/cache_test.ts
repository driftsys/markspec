import { assertEquals } from "@std/assert";
import { cacheDir } from "./cache.ts";

Deno.test("cacheDir: uses XDG_CACHE_HOME when set", () => {
  const dir = cacheDir({ XDG_CACHE_HOME: "/custom/cache" });
  assertEquals(dir, "/custom/cache/markspec");
});

Deno.test("cacheDir: falls back to platform default when XDG_CACHE_HOME unset", () => {
  const dir = cacheDir(
    { XDG_CACHE_HOME: undefined, HOME: "/Users/test" },
    "darwin",
  );
  assertEquals(dir, "/Users/test/Library/Caches/markspec");
});

Deno.test("cacheDir: uses ~/.cache/markspec on linux without XDG", () => {
  const dir = cacheDir(
    { XDG_CACHE_HOME: undefined, HOME: "/home/user" },
    "linux",
  );
  assertEquals(dir, "/home/user/.cache/markspec");
});
