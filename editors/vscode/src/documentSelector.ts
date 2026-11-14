/**
 * Documents that the MarkSpec language server receives. Kept free of the
 * `vscode` module so that unit tests can import it without a VS Code host.
 */

/** A selector entry: a language id or a file pattern, on the file scheme. */
export type SelectorEntry =
  | { readonly scheme: "file"; readonly language: string }
  | { readonly scheme: "file"; readonly pattern: string };

const LANGUAGE_IDS = [
  "markdown",
  "rust",
  "kotlin",
  "java",
  "c",
  "cpp",
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
  "csharp",
] as const;

/**
 * Language-id entries plus one pattern entry for `.feature` files. The
 * pattern entry has no language filter, so it matches the file whatever
 * language id another extension (for example a Cucumber extension) assigns.
 */
export const MARKSPEC_DOCUMENT_SELECTOR: readonly SelectorEntry[] = [
  ...LANGUAGE_IDS.map((language) => ({ scheme: "file" as const, language })),
  { scheme: "file", pattern: "**/*.feature" },
];

/** Glob of the files whose disk events are forwarded to the server. */
export const WATCHED_FILE_GLOB = "**/*.{md,feature}";
