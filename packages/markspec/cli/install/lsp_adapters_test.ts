import { assertStringIncludes } from "@std/assert";
import { neovimAdapter, zedAdapter } from "./lsp_adapters.ts";

Deno.test("neovim adapter: output contains lsp and --stdio args", () => {
  const { stdout } = neovimAdapter();
  // Lua array: { '<BINARY_PATH>', 'lsp', '--stdio' }
  assertStringIncludes(stdout, "'lsp', '--stdio'");
});

Deno.test("neovim adapter: output contains lspconfig", () => {
  const { stdout } = neovimAdapter();
  assertStringIncludes(stdout, "lspconfig");
});

Deno.test("neovim adapter: output contains BINARY_PATH placeholder", () => {
  const { stdout } = neovimAdapter();
  assertStringIncludes(stdout, "<BINARY_PATH>");
});

Deno.test("zed adapter: stdout contains markspec", () => {
  const { stdout } = zedAdapter();
  assertStringIncludes(stdout, "markspec");
});

Deno.test("zed adapter: stdout contains lsp", () => {
  const { stdout } = zedAdapter();
  assertStringIncludes(stdout, "lsp");
});

Deno.test("zed adapter: stdout contains file_types key", () => {
  const { stdout } = zedAdapter();
  assertStringIncludes(stdout, "file_types");
});

Deno.test("zed adapter: stderr mentions settings.json", () => {
  const { stderr } = zedAdapter();
  assertStringIncludes(stderr, "settings.json");
});

Deno.test("zed adapter: stdout contains BINARY_PATH placeholder", () => {
  const { stdout } = zedAdapter();
  assertStringIncludes(stdout, "<BINARY_PATH>");
});
