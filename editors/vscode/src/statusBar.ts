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
 *
 * NOTE: `createStatusBar` intentionally does NOT register a
 * `client.onNotification("markspec/indexed", ...)` handler.
 * `vscode-languageclient@9` uses a `Map` keyed by method name, so calling
 * `onNotification` twice for the same method silently replaces the first
 * handler. The caller (extension.ts) owns the single `markspec/indexed`
 * handler and must call `notifyIndexed()` from it.
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

/** Returned by `createStatusBar` so the caller can forward notifications. */
export interface StatusBarController {
  readonly item: StatusBarItem;
  /**
   * Call this when the `markspec/indexed` notification arrives.
   * Transitions the status bar from "starting" to "ready".
   */
  notifyIndexed(params: { files: number; entries: number }): void;
}

export function createStatusBar(
  context: ExtensionContext,
  client: LanguageClient,
): StatusBarController {
  const item = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  item.command = COMMAND_SHOW_OUTPUT;

  setStarting(item);
  item.show();

  client.onDidChangeState((event) => {
    if (event.newState === State.Starting) setStarting(item);
    else if (event.newState === State.Stopped) setFailed(item);
    // State.Running alone doesn't mean indexing complete — wait for
    // the markspec/indexed notification forwarded via notifyIndexed().
  });

  context.subscriptions.push(
    item,
    {
      dispose: () => item.dispose(),
    },
  );

  return {
    item,
    notifyIndexed: (params) => setReady(item, params),
  };
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
