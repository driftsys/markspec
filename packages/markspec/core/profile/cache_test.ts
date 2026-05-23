import { assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { cacheDir } from "./cache.ts";

Deno.test("cacheDir: uses XDG_CACHE_HOME when set", () => {
  const xdg = resolve("/custom/cache");
  const dir = cacheDir({ XDG_CACHE_HOME: xdg });
  assertEquals(dir, join(xdg, "markspec"));
});

Deno.test(
  "cacheDir: falls back to platform default when XDG_CACHE_HOME unset",
  () => {
    const home = resolve("/Users/test");
    const dir = cacheDir(
      { XDG_CACHE_HOME: undefined, HOME: home },
      "darwin",
    );
    assertEquals(dir, join(home, "Library", "Caches", "markspec"));
  },
);

Deno.test("cacheDir: uses ~/.cache/markspec on linux without XDG", () => {
  const home = resolve("/home/user");
  const dir = cacheDir(
    { XDG_CACHE_HOME: undefined, HOME: home },
    "linux",
  );
  assertEquals(dir, join(home, ".cache", "markspec"));
});
