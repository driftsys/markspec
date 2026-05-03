/**
 * @module bundleBinary
 *
 * Copies a markspec binary into `editors/vscode/bin/<name>` so it gets
 * packaged into the next VSIX. Defaults to the host-platform binary at
 * `dist/markspec`. Pass `--source <path>` to override.
 *
 * Usage:
 *   deno run --allow-read --allow-write \
 *     editors/vscode/scripts/bundleBinary.ts \
 *     [--source dist/markspec] [--name markspec]
 */

import { parseArgs } from "@std/cli/parse-args";
import { dirname, fromFileUrl, join } from "@std/path";

const HERE = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const BIN_DIR = join(HERE, "..", "bin");

const args = parseArgs(Deno.args, {
  string: ["source", "name"],
  default: {
    source: join(REPO_ROOT, "dist", "markspec"),
    name: "markspec",
  },
});

const source = args.source as string;
const targetName = args.name as string;

try {
  const stat = await Deno.stat(source);
  if (!stat.isFile) {
    console.error(`error: ${source} is not a regular file`);
    Deno.exit(1);
  }
} catch {
  console.error(
    `error: ${source} not found. Run 'just compile' (or 'deno compile') first.`,
  );
  Deno.exit(1);
}

await Deno.mkdir(BIN_DIR, { recursive: true });
const target = join(BIN_DIR, targetName);
await Deno.copyFile(source, target);
await Deno.chmod(target, 0o755).catch(() => {/* windows */});
console.error(`bundled ${source} -> ${target}`);
