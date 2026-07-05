import { assertEquals } from "@std/assert";
import { classifyUxilForm } from "./recognize.ts";

Deno.test("classifyUxilForm: routes each declaration form", () => {
  assertEquals(classifyUxilForm("ux:media.home : screen @ loading"), "root");
  assertEquals(classifyUxilForm("media.home : screen"), "root");
  assertEquals(classifyUxilForm("/play : activate"), "element");
  assertEquals(classifyUxilForm(".confirm_dialog @ default"), "child");
});

Deno.test("classifyUxilForm: a citation ref is not a declaration", () => {
  assertEquals(classifyUxilForm("ux:media.home/play"), undefined);
  assertEquals(classifyUxilForm("ux:media.home/play:{id}"), undefined);
  assertEquals(classifyUxilForm("just prose"), undefined);
});
