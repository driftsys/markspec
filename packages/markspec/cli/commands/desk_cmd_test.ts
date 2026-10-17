import { assertEquals } from "@std/assert";
import { parseAllowOrigin } from "./desk_cmd.ts";

Deno.test("parseAllowOrigin: accepts a bare origin, with or without a trailing slash", () => {
  assertEquals(
    parseAllowOrigin("http://localhost:5173"),
    "http://localhost:5173",
  );
  assertEquals(
    parseAllowOrigin("http://localhost:5173/"),
    "http://localhost:5173",
  );
});

Deno.test("parseAllowOrigin: rejects values that are not a canonical http(s) origin", () => {
  const rejected = [
    "ws://localhost:5173",
    "ftp://x",
    "http://u:p@localhost:5173",
    "http://localhost:5173/?q",
    "http://localhost:5173/#f",
    "http://localhost:5173/path",
    "http://LOCALHOST:5173",
    "http://localhost:80",
  ];
  for (const value of rejected) {
    assertEquals(parseAllowOrigin(value), undefined, value);
  }
});
