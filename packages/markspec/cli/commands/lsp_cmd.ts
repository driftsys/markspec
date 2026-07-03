/**
 * @module cli/commands/lsp_cmd
 *
 * `markspec lsp` — start the LSP server or install its configuration.
 *
 * Slice A (this iteration): Neovim install runs through the full
 * `runLspInstall` orchestrator — workspace marker detection, managed
 * Lua block, timestamped sidecar backup, diff preview, atomic write.
 * VS Code and Zed adapters remain print-only inside the orchestrator
 * until Slice B/C migrate them.
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
  .description("Install or print LSP server configuration for an editor")
  .option("--editor <editor:string>", "Editor ID (vscode|neovim|zed)", {
    required: true,
  })
  .option("--scope <scope:string>", "Config scope: user|workspace")
  .option(
    "--binary-path <path:string>",
    "Path or invoked name written into config",
    {
      default: "markspec",
    },
  )
  .option(
    "--print",
    "Write the new file contents to stdout; do not write to disk",
  )
  .option("--force", "Apply without TTY confirmation; required in non-TTY")
  // Cliffy converts `--no-color` into the `color: boolean` option, default
  // true; we invert it back into `noColor` for the orchestrator. The flag
  // is reserved for future colorized diff output — no color is emitted yet.
  .option("--no-color", "Disable color output")
  .option("--remove", "Remove the managed block from the config file")
  .action(
    async (
      options: {
        editor: string;
        scope?: string;
        binaryPath: string;
        print?: boolean;
        force?: boolean;
        color?: boolean;
        remove?: boolean;
      },
    ) => {
      const {
        DeadlineExceeded,
        resolveInstallDeadlineMs,
        withDeadline,
      } = await import("../install/deadline.ts");
      const { runLspInstall } = await import("../install/orchestrator.ts");
      const deadlineMs = resolveInstallDeadlineMs();
      let result;
      try {
        // Never hang (#634): a config read wedged under host load trips
        // the watchdog into a fast diagnostic + non-zero exit instead of
        // an uninterruptible silent stall.
        result = await withDeadline(
          runLspInstall({
            editor: options.editor,
            scope: options.scope,
            binaryPath: options.binaryPath,
            print: options.print,
            force: options.force,
            noColor: options.color === false,
            remove: options.remove,
          }),
          deadlineMs,
        );
      } catch (err) {
        if (err instanceof DeadlineExceeded) {
          await Deno.stderr.write(
            new TextEncoder().encode(
              `error: lsp install for editor '${options.editor}' timed out after ${deadlineMs}ms ` +
                `(host IO/lock contention?). Raise MARKSPEC_INSTALL_TIMEOUT_MS to wait longer.\n`,
            ),
          );
          Deno.exit(1);
        }
        throw err;
      }
      if (result.stdout) {
        await Deno.stdout.write(new TextEncoder().encode(result.stdout));
      }
      if (result.stderr) {
        await Deno.stderr.write(new TextEncoder().encode(result.stderr));
      }
      Deno.exit(result.exitCode);
    },
  );
