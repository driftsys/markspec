/**
 * @module mcp/path_test
 *
 * Unit tests for the path normalization helper.
 */

import { assertEquals } from "@std/assert";
import { relativeToRoot } from "./path.ts";

Deno.test("relativeToRoot: strips projectRoot prefix", () => {
  assertEquals(
    relativeToRoot("/proj/docs/req.md", "/proj"),
    "docs/req.md",
  );
});

Deno.test("relativeToRoot: tolerates trailing slash on projectRoot", () => {
  assertEquals(
    relativeToRoot("/proj/docs/req.md", "/proj/"),
    "docs/req.md",
  );
});

Deno.test("relativeToRoot: returns '.' when absolute equals projectRoot", () => {
  assertEquals(relativeToRoot("/proj", "/proj"), ".");
});

Deno.test("relativeToRoot: returns absolute unchanged when outside root", () => {
  assertEquals(
    relativeToRoot("/other/file.md", "/proj"),
    "/other/file.md",
  );
});

Deno.test("relativeToRoot: returns absolute unchanged when projectRoot missing", () => {
  assertEquals(
    relativeToRoot("/proj/docs/req.md", undefined),
    "/proj/docs/req.md",
  );
});

Deno.test("relativeToRoot: does not strip non-boundary prefix", () => {
  // /projects/docs is NOT under /proj — guard against substring confusion.
  assertEquals(
    relativeToRoot("/projects/docs/req.md", "/proj"),
    "/projects/docs/req.md",
  );
});
