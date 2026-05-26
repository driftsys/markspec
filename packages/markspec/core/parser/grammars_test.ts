/**
 * @module parser/grammars_test
 *
 * Unit tests for the grammar loader. Covers the compiled-binary safety
 * contract: Language.load must receive Uint8Array bytes, never a path
 * string. Path strings fail in compiled binaries because deno_node fs
 * cannot access virtual embedded paths (NotSupported in readFileFromFd).
 */

import { assert, assertInstanceOf } from "@std/assert";
import { stub } from "@std/testing/mock";
import { Language } from "web-tree-sitter";

import { isSupportedExtension, loadGrammar } from "./grammars.ts";

// ---------------------------------------------------------------------------
// Compiled-binary safety: Language.load must receive Uint8Array
// ---------------------------------------------------------------------------

/**
 * Regression test for https://github.com/driftsys/markspec/issues/513
 *
 * In compiled binary mode, Language.load(path) fails with:
 *   NotSupported: not supported
 *   at readFileFromFd (ext:deno_node/fs.ts:320:24)
 *
 * because web-tree-sitter uses the Node.js fs shim to open the file, which
 * cannot access Deno's virtual embedded filesystem. The fix is to read the
 * bytes with Deno.readFile() first and pass Uint8Array to Language.load().
 */
Deno.test(
  "loadGrammar: passes Uint8Array bytes to Language.load (not a path string)",
  async () => {
    let capturedArg: string | Uint8Array | undefined;
    const fakeLanguage = {} as Awaited<ReturnType<typeof Language.load>>;

    // Stub Language.load to capture the argument type without loading WASM.
    // Parser.init() still runs so the tree-sitter WASM runtime is ready.
    const loadStub = stub(
      Language,
      "load",
      (_arg: string | Uint8Array) => {
        capturedArg = _arg;
        return Promise.resolve(fakeLanguage);
      },
    );

    try {
      await loadGrammar(".tsx");

      assertInstanceOf(
        capturedArg,
        Uint8Array,
        "Language.load must receive Uint8Array bytes, not a path string. " +
          "Path strings fail in compiled binaries: deno_node fs cannot read " +
          "virtual embedded paths (readFileFromFd NotSupported). " +
          "Fix: const bytes = await Deno.readFile(path); Language.load(bytes);",
      );
    } finally {
      loadStub.restore();
    }
  },
);

// ---------------------------------------------------------------------------
// Smoke: isSupportedExtension covers the JS/TS/C# extensions added in 0.6.0
// ---------------------------------------------------------------------------

Deno.test("isSupportedExtension: tsx is supported", () => {
  assert(isSupportedExtension(".tsx"), ".tsx must be in EXT_TO_GRAMMAR");
});

Deno.test("isSupportedExtension: ts is supported", () => {
  assert(isSupportedExtension(".ts"), ".ts must be in EXT_TO_GRAMMAR");
});

Deno.test("isSupportedExtension: cs is supported", () => {
  assert(isSupportedExtension(".cs"), ".cs must be in EXT_TO_GRAMMAR");
});
