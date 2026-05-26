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
  InlineCompletionItem,
  LanguageModelChatMessage,
  languages,
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
import {
  MarkspecInlineCompletionProvider,
  type ModelInvoker,
} from "./inlineCompletions";
import type { EntryRef } from "./prompts";
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

/**
 * Project the result of `vscode.executeDocumentSymbolProvider` /
 * `vscode.executeWorkspaceSymbolProvider` to the plain `EntryRef[]`
 * shape the inline-completion provider consumes. Discards any item
 * without a string `name`; pulls the title from `detail` (document
 * symbol convention) or `containerName` (workspace symbol convention).
 */
function symbolsToEntryRefs(symbols: unknown): EntryRef[] {
  if (!Array.isArray(symbols)) return [];
  return symbols.flatMap((s) => {
    const name = typeof s?.name === "string" ? s.name : undefined;
    if (!name) return [];
    const rawDetail = typeof s?.detail === "string" ? s.detail : undefined;
    const containerName = typeof s?.containerName === "string"
      ? s.containerName
      : undefined;
    // Document symbols carry the title in `detail` as either
    // "<type> — <title>" (when a profile assigns a type) or just
    // "<title>" (no type). Workspace symbols carry the title in
    // `containerName`. Strip the optional type prefix from `detail`
    // so the prompt sees only the entry title.
    const detail = stripTypePrefix(rawDetail);
    const title = detail ?? containerName ?? name;
    return [{ displayId: name, title }];
  });
}

/** Remove a leading "<type> — " segment if present. */
function stripTypePrefix(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  const idx = detail.indexOf(" — ");
  if (idx < 0) return detail;
  return detail.slice(idx + 3);
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
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "typescriptreact" },
      { scheme: "file", language: "javascript" },
      { scheme: "file", language: "javascriptreact" },
      { scheme: "file", language: "csharp" },
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

  const statusBar = createStatusBar(context, client);

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

  // Single handler for markspec/indexed — updates both the status bar and
  // decorations. vscode-languageclient@9 only keeps one handler per method
  // (Map keyed by method name), so a second onNotification call for the same
  // method would silently replace the first. Consolidating here ensures both
  // consumers are notified.
  client.onNotification(
    "markspec/indexed",
    (params: { files: number; entries: number } | undefined) => {
      statusBar.notifyIndexed(params ?? { files: 0, entries: 0 });
      const ed = window.activeTextEditor;
      if (ed) void decorations.refresh(ed);
    },
  );

  // Initial paint for whatever is open at activation.
  if (window.activeTextEditor) {
    void decorations.refresh(window.activeTextEditor);
  }

  registerMcpProvider(context);

  // Inline AI completion provider. Gated by `markspec.inlineCompletion.enabled`.
  if (config.get<boolean>("inlineCompletion.enabled", true)) {
    const maxWorkspaceEntries = config.get<number>(
      "inlineCompletion.maxWorkspaceEntries",
      200,
    );

    const modelInvoker: ModelInvoker = async function* (messages, token) {
      const [model] = await lm.selectChatModels({ vendor: "copilot" });
      if (!model) return;
      const chatMessages = messages.map((m) =>
        LanguageModelChatMessage.User(m)
      );
      const response = await model.sendRequest(chatMessages, {}, token);
      for await (const chunk of response.text) {
        if (token.isCancellationRequested) return;
        yield chunk;
      }
    };

    const listDocumentSymbols = async (document: TextDocument) =>
      symbolsToEntryRefs(
        await commands
          .executeCommand(
            "vscode.executeDocumentSymbolProvider",
            document.uri,
          )
          .then((v) => v, () => undefined),
      );
    const listWorkspaceSymbols = async (query: string) =>
      symbolsToEntryRefs(
        await commands.executeCommand(
          "vscode.executeWorkspaceSymbolProvider",
          query,
        ),
      );

    const provider = new MarkspecInlineCompletionProvider({
      modelInvoker,
      listDocumentSymbols,
      listWorkspaceSymbols,
      maxWorkspaceEntries,
    });

    context.subscriptions.push(
      languages.registerInlineCompletionItemProvider(
        { scheme: "file", language: "markdown" },
        {
          provideInlineCompletionItems: async (
            document,
            position,
            ctx,
            token,
          ) => {
            const raw = await provider.provideInlineCompletionItems(
              document,
              position,
              ctx,
              token,
            );
            if (!raw) return null;
            return raw.map((r) => new InlineCompletionItem(r.insertText));
          },
        },
      ),
    );
  }

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
