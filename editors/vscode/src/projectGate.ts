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
  maxResults?: number,
) => PromiseLike<readonly unknown[]>;

/** `true` when the workspace holds at least one `.markspec.yaml`. */
export async function shouldStartServer(
  findFiles: FindFiles,
): Promise<boolean> {
  const found = await findFiles(PROJECT_MARKER_GLOB, 1);
  return found.length > 0;
}
