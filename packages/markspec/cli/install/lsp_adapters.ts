/**
 * @module cli/install/lsp_adapters
 *
 * LSP install adapters for `markspec lsp install --editor=<id>`.
 *
 * Each adapter returns an {@linkcode AdapterResult} with separate stdout
 * and stderr strings. The caller writes stdout to process.stdout and
 * stderr to process.stderr, then exits with `exitCode`.
 *
 * stdout carries the config block (machine-readable, pipeable).
 * stderr carries status messages, file paths, and instructions.
 */

import type { AdapterResult } from "./adapters.ts";

/**
 * Return the canonical Lua snippet for nvim-lspconfig.
 * Replace `<BINARY_PATH>` with the output of `which markspec`.
 */
export function neovimAdapter(): AdapterResult {
  const stdout = `-- markspec LSP (managed by markspec lsp install)
-- Replace <BINARY_PATH> with the output of: which markspec
require('lspconfig').markspec.setup({
  cmd = { '<BINARY_PATH>', 'lsp', '--stdio' },
  filetypes = { 'markdown' },
  root_dir = require('lspconfig.util').root_pattern('project.yaml', '.markspec.yaml'),
})`;
  const stderr =
    "Paste the snippet above into your nvim-lspconfig setup file (e.g. ~/.config/nvim/init.lua).";
  return { stdout, stderr, exitCode: 0 };
}

/**
 * Return the JSON fragment for Zed's `settings.json`.
 * Replace `<BINARY_PATH>` with the absolute path to the markspec binary.
 */
export function zedAdapter(): AdapterResult {
  const stdout = `{
  "lsp": {
    "markspec": {
      "binary": { "path": "<BINARY_PATH>", "args": ["lsp", "--stdio"] }
    }
  },
  "file_types": {
    "MarkSpec": ["md"]
  }
}`;
  const stderr =
    "Merge the JSON block above into your Zed settings.json (~/.config/zed/settings.json).";
  return { stdout, stderr, exitCode: 0 };
}

/**
 * VS Code adapter — verify-only.
 * The markspec-ide extension manages the LSP server; no config needed.
 */
export async function vscodeAdapter(): Promise<AdapterResult> {
  const extensionId = "driftsys.markspec-ide";
  let installed = false;
  try {
    const cmd = new Deno.Command("code", {
      args: ["--list-extensions"],
      stdout: "piped",
      stderr: "null",
    });
    const result = await cmd.output();
    const output = new TextDecoder().decode(result.stdout);
    installed = output.includes(extensionId);
  } catch {
    // `code` not on PATH — treat as not installed
  }

  if (installed) {
    return {
      stdout: "",
      stderr:
        `VS Code extension ${extensionId} is installed. The LSP server is launched automatically by the extension. No additional configuration needed.`,
      exitCode: 0,
    };
  }
  return {
    stdout: "",
    stderr:
      `VS Code extension ${extensionId} is not installed.\nInstall it from the VS Code Marketplace or run:\n  code --install-extension ${extensionId}`,
    exitCode: 0,
  };
}
