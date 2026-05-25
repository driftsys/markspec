import { assertEquals } from "@std/assert";
import { VERSION } from "./mod.ts";

Deno.test("typl module exports VERSION", () => {
  assertEquals(typeof VERSION, "string");
});
