import { assertEquals } from "@std/assert";
import { VERSION } from "./mod.ts";

Deno.test("version is set", () => {
  assertEquals(VERSION, "0.0.1");
});
