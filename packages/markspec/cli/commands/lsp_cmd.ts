/**
 * @module cli/commands/lsp_cmd
 *
 * `markspec lsp` — start the LSP server or install its configuration.
 */

import { Command } from "@cliffy/command";

export const lspCmd = new Command()
  .description("Start LSP server or install its configuration")
  // LSP clients (e.g. vscode-languageclient) append a transport flag to args.
  // We always use stdio, so accept and ignore these.
  .option("--stdio", "Transport flag (no-op; stdio is always used)")
  .option("--node-ipc", "Transport flag (no-op; stdio is always used)")
  .option(
    "--socket=<port:number>",
    "Transport flag (no-op; stdio is always used)",
  )
  .action(async () => {
    await import("../../lsp/server.ts");
  })
  .command("install")
  .description("Print LSP server configuration for an editor")
  .option("--editor <editor:string>", "Editor ID (vscode|neovim|zed)", {
    required: true,
  })
  .option(
    "--scope <scope:string>",
    "Config scope: user|workspace (reserved for Tier 3)",
  )
  .action(
    async (options: { editor: string; scope?: string }) => {
      const { LSP_EDITOR_IDS, suggestId } = await import(
        "../install/adapters.ts"
      );
      const editorId = options.editor;
      if (!LSP_EDITOR_IDS.includes(editorId as "vscode" | "neovim" | "zed")) {
        const suggestion = suggestId(editorId, LSP_EDITOR_IDS);
        const hint = suggestion ? `\n  did you mean: ${suggestion}` : "";
        console.error(
          `error: unknown editor '${editorId}' (known: ${
            LSP_EDITOR_IDS.join(", ")
          })${hint}`,
        );
        Deno.exit(1);
      }
      const { neovimAdapter, vscodeAdapter, zedAdapter } = await import(
        "../install/lsp_adapters.ts"
      );
      const result = editorId === "neovim"
        ? neovimAdapter()
        : editorId === "zed"
        ? zedAdapter()
        : await vscodeAdapter();
      if (result.stdout) console.log(result.stdout);
      if (result.stderr) console.error(result.stderr);
      Deno.exit(result.exitCode);
    },
  );
