/**
 * Decides whether the extension should start the language server.
 *
 * The extension contributes the `feature` language, which activates it
 * whenever a `.feature` file opens, in any workspace. The server must only
 * start in a workspace that contains a MarkSpec project.
 */

/** Glob of the file that marks a MarkSpec project (ADR-008). */
export const PROJECT_MARKER_GLOB = "**/.markspec.yaml";

/** The part of `workspace.findFiles` that the gate uses. */
export type FindFiles = (
  glob: string,
  exclude: string | null | undefined,
  maxResults?: number,
) => PromiseLike<readonly unknown[]>;

/** `true` when the workspace holds at least one `.markspec.yaml`. */
export async function shouldStartServer(
  findFiles: FindFiles,
): Promise<boolean> {
  // `undefined` excludes apply the default `files.exclude`; `null` would
  // apply none and scan every folder.
  const found = await findFiles(PROJECT_MARKER_GLOB, undefined, 1);
  return found.length > 0;
}

/** The part of a VS Code `FileSystemWatcher` that the gate uses. */
export interface MarkerWatcher {
  onDidCreate(listener: () => void): unknown;
  dispose(): void;
}

/** Host callbacks for {@linkcode startServerWhenProject}. */
export interface GateHost {
  findFiles: FindFiles;
  createWatcher(glob: string): MarkerWatcher;
  start(): void;
}

/**
 * Start the server now when the workspace holds a `.markspec.yaml`.
 * Otherwise watch for one and start the server once, when the first
 * `.markspec.yaml` is created; the watcher is then disposed. Deleting the
 * file later does not stop the server.
 *
 * @returns The marker watcher while it waits, or `undefined` when the
 *   server started at once. The caller disposes it on deactivation.
 */
export async function startServerWhenProject(
  host: GateHost,
): Promise<MarkerWatcher | undefined> {
  if (await shouldStartServer(host.findFiles)) {
    host.start();
    return undefined;
  }
  const watcher = host.createWatcher(PROJECT_MARKER_GLOB);
  let started = false;
  watcher.onDidCreate(() => {
    if (started) return;
    started = true;
    host.start();
    watcher.dispose();
  });
  return watcher;
}
