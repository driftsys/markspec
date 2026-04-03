import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test("--help prints usage and lists subcommands", async () => {
  const { code, stdout } = await markspec(["--help"]);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "markspec");
  assertStringIncludes(stdout, "format");
  assertStringIncludes(stdout, "validate");
  assertStringIncludes(stdout, "compile");
  assertStringIncludes(stdout, "book");
  assertStringIncludes(stdout, "deck");
  assertStringIncludes(stdout, "doc");
  assertStringIncludes(stdout, "lsp");
  assertStringIncludes(stdout, "mcp");
});

Deno.test("version subcommand prints version", async () => {
  const { code, stdout } = await markspec(["version"]);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "markspec 0.0.1");
});

Deno.test("--version flag prints version", async () => {
  const { code, stdout } = await markspec(["--version"]);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "0.0.1");
});

Deno.test("format with no args exits 1", async () => {
  const { code, stderr } = await markspec(["format"]);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no files specified");
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
  assertStringIncludes(stdout, "format");
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
