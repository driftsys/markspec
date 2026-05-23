/**
 * @module mcp/path_test
 *
 * Unit tests for the path normalization helper.
 */

import { assertEquals } from "@std/assert";
import { relativeToRoot } from "./path.ts";

Deno.test("relativeToRoot: strips projectRoot prefix", {
  ignore: Deno.build.os === "windows",
}, () => {
  assertEquals(
    relativeToRoot("/proj/docs/req.md", "/proj"),
    "docs/req.md",
  );
});

Deno.test("relativeToRoot: tolerates trailing slash on projectRoot", {
  ignore: Deno.build.os === "windows",
}, () => {
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

// ---------------------------------------------------------------------------
// Case-sensitivity contract — POSIX is case-sensitive, Windows is not.
// ---------------------------------------------------------------------------

Deno.test("relativeToRoot (POSIX): case differences DO NOT match", {
  ignore: Deno.build.os === "windows",
}, () => {
  // On POSIX, /Proj and /proj are distinct paths — root does not strip.
  assertEquals(
    relativeToRoot("/Proj/docs/req.md", "/proj"),
    "/Proj/docs/req.md",
  );
});

Deno.test("relativeToRoot (Windows): mixed-case prefix matches", {
  ignore: Deno.build.os !== "windows",
}, () => {
  assertEquals(
    relativeToRoot("C:\\Proj\\docs\\req.md", "c:\\proj"),
    "docs\\req.md",
  );
});

Deno.test("relativeToRoot (Windows): mixed-case equal-paths match", {
  ignore: Deno.build.os !== "windows",
}, () => {
  assertEquals(relativeToRoot("C:\\Proj", "c:\\PROJ"), ".");
});
