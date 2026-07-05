import { assertEquals } from "@std/assert";
import { detectSlugCollisions, slugForChapterPath } from "./mod.ts";

Deno.test("slugForChapterPath: strips .md extension", () => {
  assertEquals(slugForChapterPath("index.md"), "index");
});

Deno.test("slugForChapterPath: flattens nested directory separators to hyphens", () => {
  assertEquals(
    slugForChapterPath("recipes/shipping-a-reference-architecture.md"),
    "recipes-shipping-a-reference-architecture",
  );
});

Deno.test("slugForChapterPath: normalizes a redundant './' prefix before slugifying", () => {
  assertEquals(slugForChapterPath("./index.md"), "index");
});

Deno.test("detectSlugCollisions: none when every chapter maps to a distinct slug", () => {
  assertEquals(
    detectSlugCollisions(["index.md", "recipes/deploy.md", "specs.md"]),
    [],
  );
});

Deno.test("detectSlugCollisions: flags two distinct source paths that flatten to one slug", () => {
  // The canonical #778 case: a nested path and a hyphenated top-level path
  // both slugify to "recipes-deploy" and would clobber each other on write.
  assertEquals(
    detectSlugCollisions(["recipes/deploy.md", "recipes-deploy.md"]),
    [{
      slug: "recipes-deploy",
      paths: ["recipes/deploy.md", "recipes-deploy.md"],
    }],
  );
});

Deno.test("detectSlugCollisions: reports colliding paths in the given order", () => {
  const [collision] = detectSlugCollisions([
    "recipes-deploy.md",
    "recipes/deploy.md",
  ]);
  assertEquals(collision.paths, ["recipes-deploy.md", "recipes/deploy.md"]);
});

Deno.test("detectSlugCollisions: a redundant './' spelling of the same file is not a collision", () => {
  // "./index.md" and "index.md" name the SAME file (both normalize to
  // "index.md"); reading it under two SUMMARY spellings must not be flagged
  // as two chapters clobbering each other.
  assertEquals(detectSlugCollisions(["./index.md", "index.md"]), []);
});

Deno.test("detectSlugCollisions: groups three-way collisions into a single entry", () => {
  assertEquals(
    detectSlugCollisions(["a/b.md", "a-b.md", "specs.md"]).map((c) => c.slug),
    ["a-b"],
  );
  const [collision] = detectSlugCollisions(["a/b.md", "a-b.md", "specs.md"]);
  assertEquals(collision.paths, ["a/b.md", "a-b.md"]);
});
