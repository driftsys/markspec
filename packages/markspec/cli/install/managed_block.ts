/**
 * @module cli/install/managed_block
 *
 * Managed-block writer for `markspec lsp install` / `mcp install`.
 *
 * The installer never owns the user's config file — it owns a single
 * delimited, idempotent region inside it (toolchain-distribution.md §6.1).
 *
 * For block-style targets (Neovim Lua), the region is fenced by sentinel
 * comments. Content between the fences is owned by the installer; every-
 * thing else is the user's.
 *
 * Idempotence: re-applying the same content yields a byte-identical file.
 * Removal: stripping the region cleans both fences and the trailing
 * newline that was solely the separator.
 */

export const LUA_FENCE_OPEN = "-- >>> markspec (managed) >>>";
export const LUA_FENCE_CLOSE = "-- <<< markspec (managed) <<<";

/**
 * Insert or replace the managed region in `currentContent`.
 *
 * - If no managed block exists, appends the fenced block at the end,
 *   separated by a blank line when the file already has content.
 * - If a managed block exists, replaces only the region between the
 *   fences (inclusive). Everything outside the fences is untouched.
 *
 * The resulting string always ends with a newline after the close fence.
 *
 * Pure: no I/O.
 */
export function applyLuaBlock(
  currentContent: string,
  newBlockContent: string,
): string {
  const openIdx = currentContent.indexOf(LUA_FENCE_OPEN);
  const closeIdx = currentContent.indexOf(LUA_FENCE_CLOSE);

  const managedRegion =
    `${LUA_FENCE_OPEN}\n${newBlockContent}\n${LUA_FENCE_CLOSE}\n`;

  if (openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx) {
    // Replace the existing managed region. The region spans from the
    // opening fence to (and including) the newline after the closing fence.
    const closeFenceEnd = closeIdx + LUA_FENCE_CLOSE.length;
    // Consume the newline that follows the close fence, if present.
    const afterClose = closeFenceEnd < currentContent.length &&
        currentContent[closeFenceEnd] === "\n"
      ? closeFenceEnd + 1
      : closeFenceEnd;

    const before = currentContent.slice(0, openIdx);
    const after = currentContent.slice(afterClose);
    return `${before}${managedRegion}${after}`;
  }

  // No existing block — append at the end.
  if (currentContent.length === 0) {
    return managedRegion;
  }

  // Ensure there is exactly one blank line between the user's content
  // and the managed block. If the file ends with \n, add one more \n
  // (blank line); if it doesn't end with \n, add \n\n (newline + blank line).
  const separator = currentContent.endsWith("\n") ? "\n" : "\n\n";
  return `${currentContent}${separator}${managedRegion}`;
}

/**
 * Remove the managed region from `currentContent`.
 *
 * - Deletes both fences and the content between them (inclusive of the
 *   trailing newline after the close fence).
 * - If the character immediately before the opening fence is a blank line
 *   (i.e., `\n\n`), removes that extra blank line so the surrounding text
 *   stays tidy.
 * - Returns the input unchanged when no managed block is present.
 *
 * Pure: no I/O.
 */
export function removeLuaBlock(currentContent: string): string {
  const openIdx = currentContent.indexOf(LUA_FENCE_OPEN);
  const closeIdx = currentContent.indexOf(LUA_FENCE_CLOSE);

  if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) {
    return currentContent;
  }

  const closeFenceEnd = closeIdx + LUA_FENCE_CLOSE.length;
  // Consume the newline that follows the close fence, if present.
  const afterClose = closeFenceEnd < currentContent.length &&
      currentContent[closeFenceEnd] === "\n"
    ? closeFenceEnd + 1
    : closeFenceEnd;

  const before = currentContent.slice(0, openIdx);
  const after = currentContent.slice(afterClose);

  const trimmed = before.endsWith("\n\n") ? before.slice(0, -1) : before;
  return `${trimmed}${after}`;
}
