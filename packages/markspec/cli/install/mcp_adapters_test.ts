import { assertStringIncludes } from "@std/assert";
import { claudeDesktopAdapter, cursorAdapter } from "./mcp_adapters.ts";

Deno.test("claude-desktop adapter: stdout contains mcpServers", () => {
  const { stdout } = claudeDesktopAdapter();
  assertStringIncludes(stdout, "mcpServers");
});

Deno.test("claude-desktop adapter: stdout contains args mcp", () => {
  const { stdout } = claudeDesktopAdapter();
  assertStringIncludes(stdout, '"args": ["mcp"]');
});

Deno.test("claude-desktop adapter: stdout contains BINARY_PATH placeholder", () => {
  const { stdout } = claudeDesktopAdapter();
  assertStringIncludes(stdout, "<BINARY_PATH>");
});

Deno.test("claude-desktop adapter: stderr contains config file path", () => {
  const { stderr } = claudeDesktopAdapter();
  // Should mention the config file location
  assertStringIncludes(stderr, "claude_desktop_config.json");
});

Deno.test("cursor adapter: stdout contains mcpServers", () => {
  const { stdout } = cursorAdapter();
  assertStringIncludes(stdout, "mcpServers");
});

Deno.test("cursor adapter: stderr mentions mcp.json", () => {
  const { stderr } = cursorAdapter();
  assertStringIncludes(stderr, "mcp.json");
});

Deno.test("cursor adapter: stdout contains args mcp", () => {
  const { stdout } = cursorAdapter();
  assertStringIncludes(stdout, '"args": ["mcp"]');
});
