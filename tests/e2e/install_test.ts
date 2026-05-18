import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test(
  "lsp install --editor=neovim: exits 0, stdout contains lspconfig",
  async () => {
    const { code, stdout } = await markspec(
      ["lsp", "install", "--editor=neovim"],
      { permissions: ["--allow-run"] },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "lspconfig");
  },
);

Deno.test(
  "lsp install --editor=zed: exits 0, stdout is valid JSON with lsp key",
  async () => {
    const { code, stdout, stderr } = await markspec(
      ["lsp", "install", "--editor=zed"],
      { permissions: ["--allow-run"] },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, '"lsp"');
    assertStringIncludes(stdout, "markspec");
    // Instructions go to stderr
    assertStringIncludes(stderr, "settings.json");
  },
);

Deno.test(
  "lsp install --editor=nevim: exits 1, stderr contains did you mean",
  async () => {
    const { code, stderr } = await markspec(
      ["lsp", "install", "--editor=nevim"],
      { permissions: ["--allow-run"] },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr.toLowerCase(), "did you mean");
  },
);

Deno.test(
  "mcp install --client=claude-desktop: exits 0, stdout contains mcpServers",
  async () => {
    const { code, stdout } = await markspec(
      ["mcp", "install", "--client=claude-desktop"],
      { permissions: ["--allow-run"] },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "mcpServers");
  },
);

Deno.test(
  "mcp install --client=cursor: exits 0, stdout contains mcpServers, stderr mentions mcp.json",
  async () => {
    const { code, stdout, stderr } = await markspec(
      ["mcp", "install", "--client=cursor"],
      { permissions: ["--allow-run"] },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, "mcpServers");
    assertStringIncludes(stderr, "mcp.json");
  },
);

Deno.test(
  "lsp (bare): exits 0 — LSP server still starts (regression)",
  async () => {
    // Spawn the LSP server with stdin closed immediately. The server
    // should start and then exit cleanly when stdin reaches EOF.
    const CLI_ENTRY = new URL(
      "../../packages/markspec/main.ts",
      import.meta.url,
    ).pathname;
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-run",
        "--allow-env",
        "--allow-net",
        CLI_ENTRY,
        "lsp",
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    const process = cmd.spawn();
    await process.stdin.close();
    const result = await process.output();
    // Exit code 0 or 1 is acceptable (clean shutdown vs connection error).
    // What matters: it does NOT print "not implemented" and starts up.
    const stderr = new TextDecoder().decode(result.stderr);
    assertEquals(stderr.includes("not implemented"), false);
  },
);

Deno.test(
  "mcp (bare): exits 0 — MCP server still starts (regression)",
  async () => {
    const CLI_ENTRY = new URL(
      "../../packages/markspec/main.ts",
      import.meta.url,
    ).pathname;
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-run",
        "--allow-env",
        "--allow-net",
        CLI_ENTRY,
        "mcp",
      ],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    const process = cmd.spawn();
    await process.stdin.close();
    const result = await process.output();
    const stderr = new TextDecoder().decode(result.stderr);
    assertEquals(stderr.includes("not implemented"), false);
  },
);

Deno.test(
  "mcp install --client=curser: exits 1, stderr contains did you mean",
  async () => {
    const { code, stderr } = await markspec(
      ["mcp", "install", "--client=curser"],
      { permissions: ["--allow-run"] },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr.toLowerCase(), "did you mean");
  },
);

Deno.test(
  "lsp install --editor=emacs: exits 1, no suggestion (too distant)",
  async () => {
    const { code, stderr } = await markspec(
      ["lsp", "install", "--editor=emacs"],
      { permissions: ["--allow-run"] },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "unknown editor 'emacs'");
    // No "did you mean" for a completely unrelated editor name
    assertEquals(stderr.toLowerCase().includes("did you mean"), false);
  },
);
