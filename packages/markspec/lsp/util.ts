/**
 * @module lsp/util
 *
 * Shared utilities for the LSP server: URI/path conversion and debounce.
 */

/**
 * Convert a `file://` URI to a filesystem path.
 * Strips the `file://` scheme and decodes percent-encoding.
 */
export function uriToPath(uri: string): string {
  const url = new URL(uri);
  return decodeURIComponent(url.pathname);
}

/**
 * Convert a filesystem path to a `file://` URI.
 * Encodes special characters for URI safety.
 */
export function pathToUri(path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `file://${encoded}`;
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
