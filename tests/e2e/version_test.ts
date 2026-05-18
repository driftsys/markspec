import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test("--version includes core-schema component", async () => {
  const { code, stdout } = await markspec(["--version"]);
  assertEquals(code, 0);
  assertMatch(stdout, /\d+\.\d+\.\d+ \(core-schema \d+\)/);
});

Deno.test("version subcommand includes core-schema component", async () => {
  const { code, stdout } = await markspec(["version"]);
  assertEquals(code, 0);
  assertMatch(stdout, /markspec \d+\.\d+\.\d+ \(core-schema \d+\)/m);
});

Deno.test("completions bash exits 0 and outputs bash script", async () => {
  const { code, stdout } = await markspec(["completions", "bash"]);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "markspec");
});

Deno.test("completions zsh exits 0 and outputs zsh script", async () => {
  const { code, stdout } = await markspec(["completions", "zsh"]);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "#compdef");
});
