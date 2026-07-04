import { assertEquals } from "@std/assert";
import { slugForChapterPath } from "./mod.ts";

Deno.test("slugForChapterPath: strips .md extension", () => {
  assertEquals(slugForChapterPath("index.md"), "index");
});

Deno.test("slugForChapterPath: flattens nested directory separators to hyphens", () => {
  assertEquals(
    slugForChapterPath("recipes/shipping-a-reference-architecture.md"),
    "recipes-shipping-a-reference-architecture",
  );
});
