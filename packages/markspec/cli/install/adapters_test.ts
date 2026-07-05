import { assertEquals } from "@std/assert";
import { LSP_EDITOR_IDS, MCP_CLIENT_IDS, suggestId } from "./adapters.ts";

Deno.test("LSP_EDITOR_IDS contains expected editors", () => {
  assertEquals(LSP_EDITOR_IDS.includes("vscode"), true);
  assertEquals(LSP_EDITOR_IDS.includes("neovim"), true);
  assertEquals(LSP_EDITOR_IDS.includes("zed"), true);
});

Deno.test("MCP_CLIENT_IDS contains expected clients", () => {
  assertEquals(MCP_CLIENT_IDS.includes("claude"), true);
  assertEquals(MCP_CLIENT_IDS.includes("cursor"), true);
  assertEquals(MCP_CLIENT_IDS.includes("vscode"), true);
  assertEquals(MCP_CLIENT_IDS.includes("copilot"), true);
  // claude-desktop was removed (#637, sanctioned-surfaces policy).
  assertEquals(
    (MCP_CLIENT_IDS as readonly string[]).includes("claude-desktop"),
    false,
  );
});

Deno.test("suggestId: returns closest match within distance 3", () => {
  assertEquals(suggestId("neovm", LSP_EDITOR_IDS), "neovim");
  assertEquals(suggestId("vsocde", LSP_EDITOR_IDS), "vscode");
  assertEquals(suggestId("zeed", LSP_EDITOR_IDS), "zed");
});

Deno.test("suggestId: returns undefined when no close match", () => {
  assertEquals(suggestId("emacs", LSP_EDITOR_IDS), undefined);
  assertEquals(suggestId("intellij", MCP_CLIENT_IDS), undefined);
});

Deno.test("suggestId: claude typo", () => {
  assertEquals(suggestId("cladue", MCP_CLIENT_IDS), "claude");
});
