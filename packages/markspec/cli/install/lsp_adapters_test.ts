import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { neovimAdapter, neovimDescriptor, zedAdapter } from "./lsp_adapters.ts";

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

// ---------------------------------------------------------------------------
// neovimDescriptor (new descriptor shape — Task 5)
// ---------------------------------------------------------------------------

Deno.test("neovimDescriptor: id matches editor id", () => {
  assertEquals(neovimDescriptor.id, "neovim");
});

// Normalize backslash → forward-slash so path assertions are portable
// across POSIX and Windows runners. @std/path's `join()` produces native
// separators (backslash on Windows); the implementation must walk through
// `join()` for cross-platform path correctness, so the test verifies
// behavior after normalization.
function normalizePath(p: string): string {
  return p.replaceAll("\\", "/");
}

Deno.test(
  "neovimDescriptor: user-scope config path is <home>/.config/nvim/lsp/markspec.lua",
  () => {
    const path = neovimDescriptor.resolveConfigPath(
      "user",
      "/cwd",
      "/home/test",
    );
    assertEquals(
      normalizePath(path),
      "/home/test/.config/nvim/lsp/markspec.lua",
    );
  },
);

Deno.test(
  "neovimDescriptor: workspace-scope path is <root>/.nvim/markspec.lua",
  () => {
    const path = neovimDescriptor.resolveConfigPath(
      "workspace",
      "/cwd",
      "/home/test",
      "/repo",
    );
    assertEquals(normalizePath(path), "/repo/.nvim/markspec.lua");
  },
);

Deno.test(
  "neovimDescriptor: workspace scope without workspaceRoot → throws",
  () => {
    let threw = false;
    try {
      neovimDescriptor.resolveConfigPath("workspace", "/cwd", "/home/test");
    } catch {
      threw = true;
    }
    assert(threw);
  },
);

Deno.test(
  "neovimDescriptor: renderBlock embeds the binary path verbatim",
  () => {
    const block = neovimDescriptor.renderBlock({ binaryPath: "markspec" });
    assertStringIncludes(block, "cmd = { 'markspec', 'lsp', '--stdio' }");
    assertStringIncludes(block, "filetypes = { 'markdown' }");
  },
);

Deno.test(
  "neovimDescriptor: renderBlock with absolute binary path uses it",
  () => {
    const block = neovimDescriptor.renderBlock({
      binaryPath: "/Users/x/.local/bin/markspec",
    });
    assertStringIncludes(block, "cmd = { '/Users/x/.local/bin/markspec'");
  },
);

Deno.test(
  "neovimDescriptor: renderBlock includes all three workspace markers in root_pattern",
  () => {
    const block = neovimDescriptor.renderBlock({ binaryPath: "markspec" });
    assertStringIncludes(block, "'markspec.yaml'");
    assertStringIncludes(block, "'.markspec.yaml'");
    assertStringIncludes(block, "'project.yaml'");
  },
);

Deno.test(
  "neovimAdapter (legacy print-only) still returns AdapterResult",
  () => {
    // Do not remove the existing API in Slice A — Slice B/C migrate the
    // print-only path. Confirms the legacy shape survives this refactor.
    const r = neovimAdapter();
    assert(typeof r.stdout === "string");
    assert(typeof r.stderr === "string");
    assert(typeof r.exitCode === "number");
  },
);
