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

/**
 * `true` when every changed URI in the batch is a `markspec.lock`
 * file. An empty batch returns `false` — there is nothing to route.
 * URIs use `/` separators on every platform, so a basename check on
 * the last segment is sufficient.
 */
export function isLockfileOnlyChange(uris: readonly string[]): boolean {
  return uris.length > 0 &&
    uris.every((uri) => uri.split("/").pop() === "markspec.lock");
}
