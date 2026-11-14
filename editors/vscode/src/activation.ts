/**
 * The activation sequence of the extension, kept free of the `vscode`
 * module so that unit tests can run it without a VS Code host.
 */

import { type GateHost, startServerWhenProject } from "./projectGate";

/** Commands that need no language server, so they work in any workspace. */
export const SERVERLESS_COMMANDS = [
  "markspec.showOutput",
  "markspec.installToPath",
] as const;

/** One of {@linkcode SERVERLESS_COMMANDS}. */
export type ServerlessCommandId = typeof SERVERLESS_COMMANDS[number];

/** Something that can be disposed on deactivation. */
export interface Disposable {
  dispose(): unknown;
}

/** Host callbacks for {@linkcode activateWith}. */
export interface ActivationHost {
  /** The extension context's subscriptions. */
  readonly subscriptions: { push(...items: Disposable[]): unknown };
  registerCommand(
    id: string,
    handler: (...args: unknown[]) => unknown,
  ): Disposable;
  readonly commandHandlers: Record<
    ServerlessCommandId,
    (...args: unknown[]) => unknown
  >;
  readonly gate: GateHost;
}

/**
 * Register the serverless commands, then start the server when the
 * workspace is a MarkSpec project (see {@linkcode startServerWhenProject}).
 * A marker watcher that is still waiting is added to the subscriptions, so
 * it is disposed on deactivation.
 */
export async function activateWith(host: ActivationHost): Promise<void> {
  for (const id of SERVERLESS_COMMANDS) {
    host.subscriptions.push(
      host.registerCommand(id, host.commandHandlers[id]),
    );
  }
  const markerWatcher = await startServerWhenProject(host.gate);
  if (markerWatcher) host.subscriptions.push(markerWatcher);
}
