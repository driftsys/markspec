/**
 * @module scripts/compile_binary
 *
 * Wrapper around `deno compile` that works around Deno's WASM-import
 * resolution.
 *
 * Background: when `deno compile --include <dir>` discovers a `.wasm` file,
 * Deno parses it as a WebAssembly module and tries to resolve its host
 * imports (e.g., `env.*` for tree-sitter, `typst_env.*` for cmarker).
 * Those host imports are satisfied at runtime by the embedding host
 * (tree-sitter, Typst), not by Deno modules — so resolution fails with:
 *
 *     Import "env" not a dependency and not in import map from "...wasm"
 *
 * Workaround: mirror each `.wasm` to a sibling `.wasm.bin` file at compile
 * time. Deno does not parse non-`.wasm` extensions as modules, so it
 * embeds them as opaque data. The compiled binary then loads `.wasm.bin`
 * (its `import.meta`-relative paths still work). For cmarker, which
 * references `plugin.wasm` from a `.typ` file, we also patch
 * `vendor/cmarker/lib.typ` to point at `plugin.wasm.bin` for the duration
 * of the compile.
 *
 * Outside `deno compile`, source code prefers the original `.wasm` files;
 * this script's mirrors and patch are reverted on exit.
 *
 * Usage:
 *   deno run --allow-read --allow-write --allow-run --allow-env \
 *     scripts/compile_binary.ts [--output dist/markspec] [--target <triple>]
 *
 * --target is forwarded to `deno compile` for cross-compilation
 * (e.g. x86_64-pc-windows-msvc). Omitting it builds for the host platform.
 */

import { parseArgs } from "@std/cli/parse-args";
import { dirname, fromFileUrl, join, relative } from "@std/path";
import { walk } from "@std/fs/walk";

const HERE = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const GRAMMARS_DIR = join(REPO_ROOT, "grammars");
const CMARKER_DIR = join(
  REPO_ROOT,
  "packages",
  "markspec-typst",
  "vendor",
  "cmarker",
);
const CMARKER_LIB = join(CMARKER_DIR, "lib.typ");

const args = parseArgs(Deno.args, {
  string: ["output", "target"],
  default: { output: join(REPO_ROOT, "dist", "markspec") },
});

const output = args.output as string;
const target = args.target as string | undefined;

interface Mirror {
  readonly source: string;
  readonly mirror: string;
}

/** Find every .wasm file we need to mirror, return [(source, mirror)…]. */
async function discoverMirrors(): Promise<Mirror[]> {
  const mirrors: Mirror[] = [];
  for (const dir of [GRAMMARS_DIR, CMARKER_DIR]) {
    for await (
      const entry of walk(dir, {
        exts: ["wasm"],
        includeDirs: false,
        skip: [/\.bin$/],
      })
    ) {
      mirrors.push({ source: entry.path, mirror: `${entry.path}.bin` });
    }
  }
  return mirrors;
}

/** Copy each .wasm to its .wasm.bin sibling. */
async function createMirrors(mirrors: readonly Mirror[]): Promise<void> {
  for (const m of mirrors) {
    await Deno.copyFile(m.source, m.mirror);
  }
}

/** Remove .wasm.bin sibling files. */
async function removeMirrors(mirrors: readonly Mirror[]): Promise<void> {
  for (const m of mirrors) {
    await Deno.remove(m.mirror).catch(() => {});
  }
}

/**
 * Patch cmarker's lib.typ to reference plugin.wasm.bin. Returns the
 * original content so the caller can restore it.
 */
async function patchCmarkerLib(): Promise<string> {
  const original = await Deno.readTextFile(CMARKER_LIB);
  const patched = original.replace(
    'plugin("./plugin.wasm")',
    'plugin("./plugin.wasm.bin")',
  );
  if (patched === original) {
    throw new Error(
      `expected to patch plugin.wasm reference in ${CMARKER_LIB}, ` +
        "but the literal 'plugin(\"./plugin.wasm\")' was not found",
    );
  }
  await Deno.writeTextFile(CMARKER_LIB, patched);
  return original;
}

async function restoreCmarkerLib(original: string): Promise<void> {
  await Deno.writeTextFile(CMARKER_LIB, original);
}

async function runDenoCompile(mirrors: readonly Mirror[]): Promise<number> {
  const excludeFlags: string[] = [];
  for (const m of mirrors) {
    excludeFlags.push("--exclude", relative(REPO_ROOT, m.source));
  }

  const cmd = new Deno.Command("deno", {
    args: [
      "compile",
      "--no-check",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      "--allow-ffi",
      ...(target ? ["--target", target] : []),
      "--include",
      "grammars/",
      "--include",
      "packages/markspec-typst/",
      "--include",
      "packages/markspec/core/lexicons/capitalized-allow.txt",
      "--include",
      "packages/markspec/core/lexicons/sentence-abbrev.txt",
      ...excludeFlags,
      "--output",
      output,
      "packages/markspec/main.ts",
    ],
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const result = await cmd.output();
  return result.code;
}

const mirrors = await discoverMirrors();
if (mirrors.length === 0) {
  console.error("warning: no .wasm files found to mirror — compile may fail");
}

let originalLib: string | undefined;
let exitCode = 1;
try {
  await createMirrors(mirrors);
  originalLib = await patchCmarkerLib();
  exitCode = await runDenoCompile(mirrors);
} finally {
  if (originalLib !== undefined) {
    await restoreCmarkerLib(originalLib).catch(() => {});
  }
  await removeMirrors(mirrors);
}

Deno.exit(exitCode);
