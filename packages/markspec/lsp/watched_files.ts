/**
 * @module lsp/watched_files
 *
 * Classifier for the watched-files dispatcher (#771). The server
 * watches three files — `.markspec.yaml`, `project.yaml`, and
 * `markspec.lock`. A change batch touching only `markspec.lock` (a
 * bare `markspec lock` re-run) must not trigger a full profile-chain
 * re-resolve, delivered-corpus re-seed, or `markspec/profileChanged`
 * push — only a lockfile reload + upstream corpus re-seed. Pure and
 * connection-free for unit testing.
 */

/** The three basenames the watched-files dispatcher owns. */
const WATCHED_BASENAMES: ReadonlySet<string> = new Set([
  ".markspec.yaml",
  "project.yaml",
  "markspec.lock",
]);

/**
 * Keep only the URIs the dispatcher owns. The client may forward far
 * broader fileEvents than the server's dynamic registration asks for —
 * the shipped VS Code extension synchronizes every Markdown file via a
 * glob watcher, so without this filter every markdown save would
 * escalate to a full profile reload (#799 review). URIs use `/`
 * separators on every platform, so a basename check on the last
 * segment is sufficient.
 */
export function relevantWatchedUris(
  uris: readonly string[],
): readonly string[] {
  return uris.filter((uri) =>
    WATCHED_BASENAMES.has(uri.split("/").pop() ?? "")
  );
}

/**
 * `true` when every changed URI in the batch is a `markspec.lock`
 * file. An empty batch returns `false` — there is nothing to route.
 * Callers pass the {@linkcode relevantWatchedUris}-filtered batch.
 */
export function isLockfileOnlyChange(uris: readonly string[]): boolean {
  return uris.length > 0 &&
    uris.every((uri) => uri.split("/").pop() === "markspec.lock");
}
