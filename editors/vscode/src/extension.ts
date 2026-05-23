/**
 * MarkSpec VSCode Extension
 *
 * Thin LSP client. Spawns the markspec LSP server (bundled binary by default,
 * or a configured deno + source path for dev mode) and connects it to VS Code.
 *
 * Also registers the markspec MCP server with VS Code (1.101+) so Copilot
 * and other MCP-aware clients see the same binary as the LSP — no
 * separate `.vscode/mcp.json` required.
 */

import {
  commands,
  EventEmitter,
  type ExtensionContext,
  lm,
  McpStdioServerDefinition,
  type OutputChannel,
  type TextDocument,
  Uri,
  window,
  workspace,
} from "vscode";
import process from "node:process";
import {
  LanguageClient,
  type LanguageClientOptions,
} from "vscode-languageclient/node";
import { resolveServerOptions } from "./serverOptions";
import { resolveMcpDefinition } from "./mcpDefinition";
import { createStatusBar } from "./statusBar";
import { DecorationManager } from "./decorations";

let client: LanguageClient | undefined;
let outputChannel: OutputChannel | undefined;

const MCP_PROVIDER_ID = "markspec";

/** Setting keys whose changes invalidate the MCP definition. */
const MCP_SETTING_KEYS = [
  "markspec.mcp.enabled",
  "markspec.mcp.args",
  "markspec.server.path",
];

function debounce<T extends (...args: never[]) => void>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

export function activate(context: ExtensionContext): void {
  const config = workspace.getConfiguration("markspec");
  const traceLevel = config.get<string>("trace.server", "off");

  outputChannel = window.createOutputChannel("MarkSpec");
  context.subscriptions.push(outputChannel);

  const workspaceFolder = workspace.workspaceFolders?.[0]?.uri.fsPath;

  const serverOptions = resolveServerOptions({
    extensionPath: context.extensionPath,
    workspaceFolder,
    configuredServerPath: config.get<string>("server.path") || undefined,
    configuredServerArgs: config.get<string[]>("server.args"),
    debugLogPath: config.get<string>("trace.debugLog") || undefined,
    platform: process.platform,
  });

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "markdown" },
      { scheme: "file", language: "rust" },
      { scheme: "file", language: "kotlin" },
      { scheme: "file", language: "java" },
      { scheme: "file", language: "c" },
      { scheme: "file", language: "cpp" },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher("**/*.md"),
    },
    outputChannel,
    traceOutputChannel: traceLevel !== "off"
      ? window.createOutputChannel("MarkSpec LSP")
      : undefined,
  };

  client = new LanguageClient(
    "markspec",
    "MarkSpec",
    serverOptions,
    clientOptions,
  );

  context.subscriptions.push(
    commands.registerCommand("markspec.showOutput", () => {
      outputChannel?.show();
    }),
  );

  client.start();

  createStatusBar(context, client);

  const decorations = new DecorationManager(client);
  context.subscriptions.push(decorations);

  context.subscriptions.push(
    window.onDidChangeActiveTextEditor((ed) => {
      if (ed) void decorations.refresh(ed);
    }),
  );

  const debouncedRefresh = debounce((doc: TextDocument) => {
    const ed = window.activeTextEditor;
    if (ed && ed.document === doc) void decorations.refresh(ed);
  }, 100);
  context.subscriptions.push(
    workspace.onDidChangeTextDocument((ev) => debouncedRefresh(ev.document)),
  );

  // Refresh after the server finishes initial indexing.
  client.onNotification("markspec/indexed", () => {
    const ed = window.activeTextEditor;
    if (ed) void decorations.refresh(ed);
  });

  // Initial paint for whatever is open at activation.
  if (window.activeTextEditor) {
    void decorations.refresh(window.activeTextEditor);
  }

  registerMcpProvider(context);

  context.subscriptions.push({
    dispose: () => {
      client?.stop();
    },
  });
}

/**
 * Register the MarkSpec MCP server definition provider with VS Code.
 *
 * Uses the stable `vscode.lm.registerMcpServerDefinitionProvider` API
 * (VS Code 1.101+, June 2025). The provider returns a single stdio
 * definition that spawns the same binary as the LSP client.
 *
 * Changes to `markspec.mcp.*` or `markspec.server.path` settings fire the
 * `didChange` event so VS Code re-queries the provider.
 */
function registerMcpProvider(context: ExtensionContext): void {
  const didChange = new EventEmitter<void>();
  context.subscriptions.push(didChange);

  context.subscriptions.push(
    workspace.onDidChangeConfiguration((event) => {
      if (MCP_SETTING_KEYS.some((key) => event.affectsConfiguration(key))) {
        didChange.fire();
      }
    }),
  );

  context.subscriptions.push(
    lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
      onDidChangeMcpServerDefinitions: didChange.event,
      provideMcpServerDefinitions: () => {
        const cfg = workspace.getConfiguration("markspec");
        const workspaceFolder = workspace.workspaceFolders?.[0]?.uri.fsPath;
        const resolved = resolveMcpDefinition({
          extensionPath: context.extensionPath,
          workspaceFolder,
          enabled: cfg.get<boolean>("mcp.enabled", true),
          configuredServerPath: cfg.get<string>("server.path") || undefined,
          configuredMcpArgs: cfg.get<string[]>("mcp.args"),
          platform: process.platform,
          extensionVersion: extensionVersion(context),
        });
        if (!resolved) return [];
        const def = new McpStdioServerDefinition(
          resolved.label,
          resolved.command,
          [...resolved.args],
          {},
          resolved.version,
        );
        if (resolved.cwd) def.cwd = Uri.file(resolved.cwd);
        return [def];
      },
    }),
  );
}

/** Best-effort extension version lookup; falls back to "0.0.0". */
function extensionVersion(context: ExtensionContext): string {
  const pkg = (context.extension?.packageJSON ?? {}) as { version?: string };
  return pkg.version ?? "0.0.0";
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
