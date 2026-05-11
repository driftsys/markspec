/**
 * @module mcpDefinition
 *
 * Builds the spawn arguments for the MarkSpec MCP server. Pure functions —
 * no `vscode` API access — so this module is unit-testable.
 *
 * The extension calls `resolveMcpDefinition` from its
 * `provideMcpServerDefinitions` callback and constructs an
 * `McpStdioServerDefinition` from the returned shape. The resolver mirrors
 * `resolveServerOptions` so `markspec.server.path` redirects both the LSP
 * client and the MCP definition to the same binary.
 */

import * as path from "node:path";
import { expandVariables } from "./serverOptions";

export interface ResolveMcpInput {
  /** Absolute path to the unpacked extension directory. */
  readonly extensionPath: string;
  /** Absolute path to the active VS Code workspace folder, if any. */
  readonly workspaceFolder: string | undefined;
  /** Value of `markspec.mcp.enabled` setting. */
  readonly enabled: boolean;
  /** Value of `markspec.server.path` setting, or undefined. */
  readonly configuredServerPath: string | undefined;
  /** Value of `markspec.mcp.args` setting, or undefined. */
  readonly configuredMcpArgs: readonly string[] | undefined;
  /** Platform identifier for naming the bundled binary. */
  readonly platform: NodeJS.Platform;
  /** Extension version string, surfaced to VS Code as the server version. */
  readonly extensionVersion: string;
}

/**
 * Plain data shape describing a resolved MCP stdio server. The extension
 * wraps this in `vscode.McpStdioServerDefinition`. Kept as a data record
 * so unit tests can run outside the VS Code extension host.
 */
export interface ResolvedMcpDefinition {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly version: string;
}

/** Default label shown in the MCP server picker. */
const DEFAULT_LABEL = "MarkSpec";

/**
 * Compute the spawn `command` and `args` for the MCP server.
 *
 * Returns `undefined` when the user has disabled MCP via
 * `markspec.mcp.enabled = false`. Otherwise mirrors `resolveServerOptions`:
 * if `markspec.server.path` is set, use it (developer / configured mode);
 * otherwise fall back to the bundled binary at
 * `<extensionPath>/bin/markspec(.exe)`.
 *
 * `${workspaceFolder}` is substituted in `configuredMcpArgs`.
 */
export function resolveMcpDefinition(
  input: ResolveMcpInput,
): ResolvedMcpDefinition | undefined {
  if (!input.enabled) return undefined;

  const { command, args } = resolveCommand(input);

  return {
    label: DEFAULT_LABEL,
    command,
    args,
    cwd: input.workspaceFolder,
    version: input.extensionVersion,
  };
}

function resolveCommand(
  input: ResolveMcpInput,
): { command: string; args: string[] } {
  if (input.configuredServerPath) {
    return {
      command: input.configuredServerPath,
      args: expandVariables(
        input.configuredMcpArgs ?? ["mcp"],
        input.workspaceFolder,
      ),
    };
  }
  const binaryName = input.platform === "win32" ? "markspec.exe" : "markspec";
  return {
    command: path.join(input.extensionPath, "bin", binaryName),
    args: input.configuredMcpArgs
      ? expandVariables(input.configuredMcpArgs, input.workspaceFolder)
      : ["mcp"],
  };
}
