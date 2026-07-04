import { assertEquals } from "@std/assert";
import { isUnsafeRelPath } from "./paths.ts";

Deno.test("isUnsafeRelPath: plain relative paths are safe", () => {
  for (const p of ["compiled.json", "sub/entries.ndjson", "a.b-c_d.json"]) {
    assertEquals(isUnsafeRelPath(p), false, p);
  }
});

Deno.test("isUnsafeRelPath: absolute paths are unsafe", () => {
  for (const p of ["/etc/passwd", "C:\\win\\x", "c:/win/x"]) {
    assertEquals(isUnsafeRelPath(p), true, p);
  }
});

Deno.test("isUnsafeRelPath: parent segments are unsafe", () => {
  for (const p of ["..", "../x", "a/../b", "a\\..\\b", "x/.."]) {
    assertEquals(isUnsafeRelPath(p), true, p);
  }
});

Deno.test("isUnsafeRelPath: dot-dot inside a name is safe", () => {
  for (const p of ["a..b", "..hidden", "x/..y"]) {
    assertEquals(isUnsafeRelPath(p), false, p);
  }
});
