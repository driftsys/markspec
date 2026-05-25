/**
 * @module cli/install/preview
 *
 * Preview and confirm helpers for `markspec lsp install` / `mcp install`.
 * Per toolchain-distribution.md §6.3:
 * - Print the diff of (current file) vs (new file) to stderr.
 * - Prompt for confirmation on TTY.
 * - Reject in non-TTY without --force (§6.4 / clig.dev).
 *
 * The diff is a minimal line-based unified diff — managed blocks are
 * small, no need for an external diff library or context lines.
 */

/** Stdin abstraction — lets tests inject answers without a real TTY. */
export interface LineReader {
  /** Read one line; return null on EOF. */
  readLine(): Promise<string | null>;
}

/**
 * Render a minimal unified-style diff between `current` and `next`.
 *
 * Header lines:
 *   `--- <path>`
 *   `+++ <path> (new)`
 *
 * Body: for each index in `0..max(oldLines, newLines)`:
 *   - If lines are identical: emit nothing (no context lines).
 *   - Otherwise: emit `-<oldLine>` if defined, then `+<newLine>` if defined.
 *
 * Inputs are split on `\n`; a trailing empty segment (file ends with `\n`)
 * is dropped before the comparison walk.
 */
export function renderDiff(
  current: string,
  next: string,
  path: string,
): string {
  const splitLines = (s: string): string[] => {
    const parts = s.split("\n");
    // Drop trailing empty segment produced by a final newline.
    if (parts.length > 0 && parts[parts.length - 1] === "") {
      parts.pop();
    }
    return parts;
  };

  const oldLines = splitLines(current);
  const newLines = splitLines(next);

  const outputLines: string[] = [];
  outputLines.push(`--- ${path}`);
  outputLines.push(`+++ ${path} (new)`);

  const len = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < len; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) {
      // Identical — omit (no context lines).
      continue;
    }
    if (oldLine !== undefined) {
      outputLines.push(`-${oldLine}`);
    }
    if (newLine !== undefined) {
      outputLines.push(`+${newLine}`);
    }
  }

  return outputLines.join("\n") + "\n";
}

/**
 * Prompt the user for confirmation on a TTY.
 *
 * When `isNonTty` is true, throws immediately — non-interactive contexts
 * must use `--force` or `--print` instead of interactive confirmation
 * (clig.dev / toolchain-distribution.md §6.4).
 *
 * Otherwise, writes `<prompt> [y/N] ` to stderr and reads one line via
 * `stdin`. Returns `true` for `"y"` or `"yes"` (case-insensitive),
 * `false` for any other input including a blank line.
 */
export async function confirm(
  prompt: string,
  stdin: LineReader,
  isNonTty: boolean,
): Promise<boolean> {
  if (isNonTty) {
    throw new Error(
      "non-interactive context (stdin is not a TTY); pass --force to apply or --print to skip writing",
    );
  }
  await Deno.stderr.write(new TextEncoder().encode(`${prompt} [y/N] `));
  const line = (await stdin.readLine()) ?? "";
  const answer = line.trim().toLowerCase();
  return answer === "y" || answer === "yes";
}
