/**
 * Stub the `vscode` runtime module so `vscode-languageclient/node` loads
 * outside the VS Code extension host. Loaded via `node --require` before
 * the test file imports `serverOptions`, which in turn imports
 * `vscode-languageclient/node` (which requires `vscode` at module load
 * time).
 *
 * `serverOptions.ts` only references `TransportKind.stdio`. The stub
 * therefore exports just the symbols the dependency tree dereferences at
 * load time. Anything not exercised at load time is a no-op.
 */

import Module from "node:module";

// deno-lint-ignore no-explicit-any
const ModuleAny = Module as any;
const originalLoad = ModuleAny._load;

/**
 * Proxy stub: every property access returns a no-op class constructor.
 * vscode-languageclient touches many classes (CompletionItem, CodeAction,
 * DocumentLink, …) at module load time via `extends code.X`. A class
 * factory satisfies all of those without enumerating them.
 *
 * Known scalars (e.g. `version`) are returned directly so callers reading
 * them get sensible types.
 */
const scalars: Record<string, unknown> = {
  version: "1.82.0",
};

const vscodeStub: unknown = new Proxy({}, {
  get(_target, prop: string) {
    if (prop in scalars) return scalars[prop];
    // Return a no-op class so `extends code.X` works.
    return class {};
  },
});

ModuleAny._load = function (request: string, ...rest: unknown[]) {
  if (request === "vscode") return vscodeStub;
  return originalLoad.call(this, request, ...rest);
};
