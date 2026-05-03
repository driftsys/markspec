/**
 * @module serverOptions
 *
 * Builds the spawn arguments for the MarkSpec LSP server. Pure functions —
 * no `vscode` API access — so this module is unit-testable.
 *
 * The extension calls `resolveServerOptions` during activation and passes the
 * result to `LanguageClient`.
 */

import * as path from "node:path";
import process from "node:process";
import { TransportKind } from "vscode-languageclient/node";
import type { ServerOptions } from "vscode-languageclient/node";

export interface ResolveInput {
  /** Absolute path to the unpacked extension directory. */
  readonly extensionPath: string;
  /** Absolute path to the active VS Code workspace folder, if any. */
  readonly workspaceFolder: string | undefined;
  /** Value of `markspec.server.path` setting, or undefined. */
  readonly configuredServerPath: string | undefined;
  /** Value of `markspec.server.args` setting, or undefined. */
  readonly configuredServerArgs: readonly string[] | undefined;
  /** Value of `markspec.trace.debugLog` setting, or undefined. */
  readonly debugLogPath: string | undefined;
  /** Platform identifier for naming the bundled binary. */
  readonly platform: NodeJS.Platform;
}

/**
 * Compute the spawn `command` and `args` for the LSP server.
 *
 * If `configuredServerPath` is set, use it (developer mode). Otherwise fall
 * back to the bundled binary at `<extensionPath>/bin/markspec(.exe)`.
 *
 * `${workspaceFolder}` is substituted in `configuredServerArgs`.
 */
export function resolveServerOptions(input: ResolveInput): ServerOptions {
  const { command, args } = resolveCommand(input);
  const env = { ...process.env };
  if (input.debugLogPath) {
    env.MARKSPEC_LSP_DEBUG_LOG = input.debugLogPath;
  }
  return {
    command,
    args,
    transport: TransportKind.stdio,
    options: { env },
  };
}

function resolveCommand(
  input: ResolveInput,
): { command: string; args: string[] } {
  if (input.configuredServerPath) {
    return {
      command: input.configuredServerPath,
      args: expandVariables(
        input.configuredServerArgs ?? ["lsp"],
        input.workspaceFolder,
      ),
    };
  }
  const binaryName = input.platform === "win32" ? "markspec.exe" : "markspec";
  return {
    command: path.join(input.extensionPath, "bin", binaryName),
    args: ["lsp"],
  };
}

/** Expand `${workspaceFolder}` in each arg. Other `${...}` left untouched. */
export function expandVariables(
  args: readonly string[],
  workspaceFolder: string | undefined,
): string[] {
  return args.map((arg) => {
    if (workspaceFolder === undefined) return arg;
    return arg.replaceAll("${workspaceFolder}", workspaceFolder);
  });
}
