import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test("--help prints usage and lists subcommands", async () => {
  const { code, stdout } = await markspec(["--help"]);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "markspec");
  assertStringIncludes(stdout, "fmt");
  assertStringIncludes(stdout, "check");
  assertStringIncludes(stdout, "compile");
  assertStringIncludes(stdout, "book");
  assertStringIncludes(stdout, "deck");
  assertStringIncludes(stdout, "doc");
  assertStringIncludes(stdout, "lsp");
  assertStringIncludes(stdout, "mcp");
});

Deno.test("no args prints help (clig.dev)", async () => {
  const { code, stdout } = await markspec([]);
  assertEquals(code, 0);
  // Same top-of-output as --help.
  assertStringIncludes(stdout, "markspec");
  assertStringIncludes(stdout, "Commands");
  assertStringIncludes(stdout, "check");
});

Deno.test("version subcommand prints version", async () => {
  const { code, stdout } = await markspec(["version"]);
  assertEquals(code, 0);
  // Don't pin to a literal — match the shape (semver-ish).
  assertMatch(stdout, /^markspec \d+\.\d+\.\d+/m);
});

Deno.test("--version flag prints version", async () => {
  const { code, stdout } = await markspec(["--version"]);
  assertEquals(code, 0);
  assertMatch(stdout, /\d+\.\d+\.\d+/);
});

Deno.test("fmt with no args outside a project exits 1 with hint", async () => {
  const { code, stderr } = await markspec(["fmt"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no project root found");
});

Deno.test("book build without project.yaml exits 1", async () => {
  const { code, stderr } = await markspec(["book", "build"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no project.yaml found");
});

Deno.test("help subcommand shows root help", async () => {
  const { code, stdout } = await markspec(["help"]);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "markspec");
  assertStringIncludes(stdout, "fmt");
});

Deno.test("help show prints show subcommand help", async () => {
  const { code, stdout } = await markspec(["help", "show"]);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "show");
});

Deno.test("help nonexistent exits with error", async () => {
  const { code, stderr } = await markspec(["help", "nonexistent"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "unknown command");
});

Deno.test("unknown subcommand fails with non-zero exit", async () => {
  const { code } = await markspec(["nonexistent"]);
  assertEquals(code !== 0, true);
});
