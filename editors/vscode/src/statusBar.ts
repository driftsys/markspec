/**
 * @module statusBar
 *
 * Status bar item showing the LSP health, the running CLI release, and
 * any skew between that release and the workspace's declared toolchain
 * floor (`meta.toolchain.minVersion`).
 *
 *   ⟳  starting / restarting / indexing
 *   ✓  ready (initial indexing complete)
 *   ⚠  ready, but the CLI is below the workspace floor
 *   ✗  failed / stopped unexpectedly
 *
 * The tooltip composes whatever state the controller has on hand:
 * indexed counts (from `markspec/indexed`) and CLI version + floor
 * (from `markspec/version`). The two notifications can arrive in
 * either order; the controller re-renders on each update.
 *
 * Click action opens the MarkSpec output channel.
 *
 * NOTE: `createStatusBar` intentionally does NOT register
 * `client.onNotification("markspec/indexed", …)` or
 * `client.onNotification("markspec/version", …)` handlers.
 * `vscode-languageclient@9` uses a `Map` keyed by method name, so
 * calling `onNotification` twice for the same method silently replaces
 * the first handler. The caller (extension.ts) owns the single
 * handler per method and must forward via `notifyIndexed()` /
 * `notifyVersion()`.
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

/** Payload from `markspec/indexed`. */
export interface IndexedInfo {
  readonly files: number;
  readonly entries: number;
}

/** Payload from `markspec/version`. */
export interface VersionInfo {
  readonly release: string;
  readonly coreSchemaVersion: number;
  readonly minVersion: string | null;
  readonly isBelow: boolean;
}

/** LSP lifecycle states the renderer cares about. */
export type LspState = "starting" | "ready" | "failed";

/** Pure render output — plain data, no vscode objects. */
export interface RenderedState {
  readonly text: string;
  /** Composed Markdown tooltip body. Empty string for transitional states. */
  readonly tooltip: string;
  /** `"warning"` selects `statusBarItem.warningBackground`; `"error"` selects `statusBarItem.errorBackground`; `undefined` = no tint. */
  readonly background: "warning" | "error" | undefined;
}

/** Returned by `createStatusBar` so the caller can forward notifications. */
export interface StatusBarController {
  readonly item: StatusBarItem;
  /**
   * Call this when the `markspec/indexed` notification arrives.
   * Updates the cached IndexedInfo and re-renders.
   */
  notifyIndexed(params: IndexedInfo): void;
  /**
   * Call this when the `markspec/version` notification arrives.
   * Updates the cached VersionInfo and re-renders.
   */
  notifyVersion(params: VersionInfo): void;
}

/**
 * Pure render function. Returns the desired `(text, tooltip, background)`
 * for the given LSP state and accumulated notification info. Exported for
 * unit testing without a real VS Code runtime.
 */
export function renderState(
  lspState: LspState,
  indexed: IndexedInfo | undefined,
  version: VersionInfo | undefined,
): RenderedState {
  if (lspState === "starting") {
    return {
      text: "$(sync~spin) MarkSpec",
      tooltip: "MarkSpec LSP starting…",
      background: undefined,
    };
  }
  if (lspState === "failed") {
    return {
      text: "$(error) MarkSpec",
      tooltip: "MarkSpec LSP not running. Click to view output.",
      background: "error",
    };
  }
  // ready
  const belowFloor = version?.isBelow === true;
  const text = belowFloor ? "$(warning) MarkSpec" : "$(check) MarkSpec";
  const tooltip = belowFloor
    ? composeReadyBelowFloorTooltip(indexed, version!)
    : composeReadyOkTooltip(indexed, version);
  return {
    text,
    tooltip,
    background: belowFloor ? "warning" : undefined,
  };
}

function composeReadyOkTooltip(
  indexed: IndexedInfo | undefined,
  version: VersionInfo | undefined,
): string {
  const sections: string[] = ["**MarkSpec LSP** ready"];
  if (indexed) {
    sections.push(`Indexed ${indexed.files} files, ${indexed.entries} entries.`);
  }
  if (version) {
    sections.push(`Version: ${version.release}`);
    sections.push(
      version.minVersion === null
        ? "No workspace floor declared"
        : `Workspace floor: ${version.minVersion} ✓`,
    );
  }
  return sections.join("\n\n");
}

function composeReadyBelowFloorTooltip(
  indexed: IndexedInfo | undefined,
  version: VersionInfo,
): string {
  const sections: string[] = ["**MarkSpec LSP** below workspace floor"];
  if (indexed) {
    sections.push(`Indexed ${indexed.files} files, ${indexed.entries} entries.`);
  }
  // `version.minVersion` is guaranteed non-null when `isBelow` is true —
  // see `isBelowFloor`: it returns false for `undefined` floor.
  sections.push(
    `Running ${version.release}; project requires ${version.minVersion}+.`,
  );
  sections.push(
    "Reload window after upgrading the CLI to refresh this check.",
  );
  return sections.join("\n\n");
}

export function createStatusBar(
  context: ExtensionContext,
  client: LanguageClient,
): StatusBarController {
  const item = window.createStatusBarItem(StatusBarAlignment.Right, 100);
  item.command = COMMAND_SHOW_OUTPUT;

  let lspState: LspState = "starting";
  let indexed: IndexedInfo | undefined;
  let version: VersionInfo | undefined;

  function repaint(): void {
    const rendered = renderState(lspState, indexed, version);
    item.text = rendered.text;
    if (rendered.tooltip === "") {
      item.tooltip = undefined;
    } else {
      const md = new MarkdownString();
      md.appendMarkdown(rendered.tooltip);
      item.tooltip = md;
    }
    item.backgroundColor = rendered.background === "warning"
      ? new ThemeColor("statusBarItem.warningBackground")
      : rendered.background === "error"
      ? new ThemeColor("statusBarItem.errorBackground")
      : undefined;
  }

  repaint();
  item.show();

  client.onDidChangeState((event) => {
    if (event.newState === State.Starting) lspState = "starting";
    else if (event.newState === State.Stopped) lspState = "failed";
    // State.Running alone doesn't mean indexing complete — wait for
    // the markspec/indexed notification forwarded via notifyIndexed().
    repaint();
  });

  context.subscriptions.push(
    item,
    {
      dispose: () => item.dispose(),
    },
  );

  return {
    item,
    notifyIndexed: (params) => {
      lspState = "ready";
      indexed = params;
      repaint();
    },
    notifyVersion: (params) => {
      version = params;
      repaint();
    },
  };
}
