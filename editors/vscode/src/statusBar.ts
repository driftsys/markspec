/**
 * @module statusBar
 *
 * Status bar item showing the LSP health. Driven by LanguageClient state
 * transitions plus the server's custom `markspec/indexed` notification.
 *
 *   ⟳  starting / restarting / indexing
 *   ✓  ready (initial indexing complete)
 *   ✗  failed / stopped unexpectedly
 *
 * Click action opens the MarkSpec output channel.
 */

import {
  type ExtensionContext,
  MarkdownString,
  StatusBarAlignment,
  type StatusBarItem,
  ThemeColor,
  window,
} from "vscode";
import { type LanguageClient, State } from "vscode-languageclient/node";

const COMMAND_SHOW_OUTPUT = "markspec.showOutput";

export function createStatusBar(
  context: ExtensionContext,
  client: LanguageClient,
): StatusBarItem {
  const item = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  item.command = COMMAND_SHOW_OUTPUT;

  setStarting(item);
  item.show();

  client.onDidChangeState((event) => {
    if (event.newState === State.Starting) setStarting(item);
    else if (event.newState === State.Stopped) setFailed(item);
    // State.Running alone doesn't mean indexing complete — wait for
    // markspec/indexed notification.
  });

  client.onNotification("markspec/indexed", (params) => {
    setReady(
      item,
      (params as { files: number; entries: number } | undefined) ??
        { files: 0, entries: 0 },
    );
  });

  context.subscriptions.push(
    item,
    {
      dispose: () => item.dispose(),
    },
  );

  return item;
}

function setStarting(item: StatusBarItem): void {
  item.text = "$(sync~spin) MarkSpec";
  item.tooltip = "MarkSpec LSP starting…";
  item.backgroundColor = undefined;
}

function setReady(
  item: StatusBarItem,
  params: { files: number; entries: number },
): void {
  item.text = "$(check) MarkSpec";
  const tooltip = new MarkdownString();
  tooltip.appendMarkdown("**MarkSpec LSP** ready\n\n");
  tooltip.appendMarkdown(
    `Indexed ${params.files} files, ${params.entries} entries.`,
  );
  item.tooltip = tooltip;
  item.backgroundColor = undefined;
}

function setFailed(item: StatusBarItem): void {
  item.text = "$(error) MarkSpec";
  item.tooltip = "MarkSpec LSP not running. Click to view output.";
  item.backgroundColor = new ThemeColor("statusBarItem.errorBackground");
}
