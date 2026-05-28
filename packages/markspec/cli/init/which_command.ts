/**
 * @module cli/init/which_command
 *
 * Pure parser for `which`/`where` output. Used by the inline
 * `whichCommand` callback in `cli/commands/init.ts`. Lives in its
 * own module so the empty-stdout edge case is testable without
 * spawning a real subprocess.
 *
 * Sandboxed CIs and PATH wrappers occasionally produce exit code 0
 * with empty stdout for unresolved names. Treating that as a hit
 * pushes a bogus `'<tool>-on-path'` signal into adapter detection;
 * see PR #528 review finding #1.
 */

/**
 * Project the output of a `which name` / `where name` invocation to
 * either the resolved absolute path or `undefined`.
 *
 *   - Non-zero exit code → `undefined`.
 *   - Empty or whitespace-only first line → `undefined`.
 *   - Otherwise the trimmed first line of stdout.
 */
export function parseWhichOutput(
  exitCode: number,
  stdout: Uint8Array,
): string | undefined {
  if (exitCode !== 0) return undefined;
  const firstLine = new TextDecoder().decode(stdout).split(/\r?\n/)[0].trim();
  return firstLine.length > 0 ? firstLine : undefined;
}
