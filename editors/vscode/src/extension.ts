/**
 * MarkSpec VSCode Extension
 *
 * Thin LSP client. Spawns the markspec LSP server (bundled binary by default,
 * or a configured deno + source path for dev mode) and connects it to VS Code.
 */

import {
  commands,
  type ExtensionContext,
  type OutputChannel,
  window,
  workspace,
} from "vscode";
import process from "node:process";
import {
  LanguageClient,
  type LanguageClientOptions,
} from "vscode-languageclient/node";
import { resolveServerOptions } from "./serverOptions";
import { createStatusBar } from "./statusBar";

let client: LanguageClient | undefined;
let outputChannel: OutputChannel | undefined;

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

  context.subscriptions.push({
    dispose: () => {
      client?.stop();
    },
  });
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
