/**
 * @module parser/grammars
 *
 * Lazy-loading tree-sitter grammar resolver. Maps file extensions to
 * grammar WASM files and caches loaded languages for reuse.
 */

import Parser from "web-tree-sitter";
import { join } from "@std/path";

/** Map file extensions to grammar WASM file names. */
const EXT_TO_GRAMMAR: Record<string, string> = {
  ".rs": "tree-sitter-rust",
  ".kt": "tree-sitter-kotlin",
  ".kts": "tree-sitter-kotlin",
  ".java": "tree-sitter-java",
  ".c": "tree-sitter-c",
  ".h": "tree-sitter-c",
  ".cpp": "tree-sitter-cpp",
  ".cc": "tree-sitter-cpp",
  ".cxx": "tree-sitter-cpp",
  ".hpp": "tree-sitter-cpp",
  ".hxx": "tree-sitter-cpp",
};

/** Directory containing grammar WASM files. */
const GRAMMARS_DIR = join(
  import.meta.dirname!,
  "..",
  "..",
  "..",
  "..",
  "grammars",
);

let initialized = false;
const cache = new Map<string, Promise<Parser.Language>>();

/** Check whether a file extension has a supported grammar. */
export function isSupportedExtension(ext: string): boolean {
  return ext in EXT_TO_GRAMMAR;
}

/**
 * Load a tree-sitter language grammar for the given file extension.
 *
 * Initializes the Parser WASM runtime on first call. Grammar languages
 * are cached — repeated calls with the same extension return the
 * same `Parser.Language` instance. Concurrent-safe: stores the loading
 * promise so parallel calls await the same load.
 *
 * @param ext - File extension including the dot (e.g., `.rs`, `.java`)
 * @throws If the extension is unsupported or the WASM file cannot be loaded
 */
export function loadGrammar(ext: string): Promise<Parser.Language> {
  const grammarName = EXT_TO_GRAMMAR[ext];
  if (!grammarName) {
    throw new Error(`unsupported file extension: ${ext}`);
  }

  let pending = cache.get(grammarName);
  if (!pending) {
    pending = doLoad(grammarName);
    cache.set(grammarName, pending);
  }
  return pending;
}

async function doLoad(grammarName: string): Promise<Parser.Language> {
  if (!initialized) {
    await Parser.init();
    initialized = true;
  }
  const wasmPath = join(GRAMMARS_DIR, `${grammarName}.wasm`);
  return Parser.Language.load(wasmPath);
}
