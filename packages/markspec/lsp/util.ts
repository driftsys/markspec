/**
 * @module lsp/util
 *
 * Shared utilities for the LSP server: URI/path conversion and debounce.
 */

import { fromFileUrl, toFileUrl } from "@std/path";
import {
  fromFileUrl as fromFileUrlPosix,
  toFileUrl as toFileUrlPosix,
} from "@std/path/posix";
import {
  fromFileUrl as fromFileUrlWindows,
  toFileUrl as toFileUrlWindows,
} from "@std/path/windows";

/**
 * Convert a `file://` URI to a filesystem path using the host platform's
 * convention — drive-letter + backslash on Windows, POSIX otherwise.
 */
export function uriToPath(uri: string): string {
  return fromFileUrl(uri);
}

/**
 * Convert a filesystem path to a `file://` URI using the host platform's
 * convention. On Windows `C:\\foo\\bar` becomes `file:///C:/foo/bar`; on
 * POSIX `/foo/bar` becomes `file:///foo/bar`.
 */
export function pathToUri(path: string): string {
  return toFileUrl(path).href;
}

// ---------------------------------------------------------------------------
// Platform-specific helpers — exported with an `_` prefix to mark them as
// test-only seams. Production code should call `pathToUri` / `uriToPath`,
// which dispatch to the host platform's converter. The named exports below
// let unit tests verify Windows behaviour from a macOS or Linux CI runner.
// ---------------------------------------------------------------------------

export function _pathToUriPosix(path: string): string {
  return toFileUrlPosix(path).href;
}

export function _uriToPathPosix(uri: string): string {
  return fromFileUrlPosix(uri);
}

export function _pathToUriWindows(path: string): string {
  return toFileUrlWindows(path).href;
}

export function _uriToPathWindows(uri: string): string {
  return fromFileUrlWindows(uri);
}

/** A debounced function with a `cancel()` method. */
export interface DebouncedFunction<T extends (...args: never[]) => void> {
  (...args: Parameters<T>): void;
  cancel(): void;
}

/**
 * Create a debounced version of a function.
 * The function is called after `delayMs` milliseconds of inactivity.
 */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  delayMs: number,
): DebouncedFunction<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = ((...args: Parameters<T>) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delayMs);
  }) as DebouncedFunction<T>;
  debounced.cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return debounced;
}
