import { assertEquals } from "@std/assert";
import "../mod.ts";
import { loadedGherkin } from "./load.ts";

// Separate file: each test file runs in its own module graph, so the
// parser cache is guaranteed to be empty here.
Deno.test("core/mod.ts import does not load the parser", () => {
  assertEquals(loadedGherkin(), undefined);
});
