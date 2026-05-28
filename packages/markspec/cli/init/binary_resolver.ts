/**
 * @module cli/init/binary_resolver
 *
 * Resolve the markspec binary reference written into MCP config
 * `command:` fields. `--binary-path` takes precedence; otherwise we
 * write `"markspec"` and emit a warning if the name does not resolve
 * to the currently-running binary (or doesn't resolve at all).
 */

import type { BinaryRef } from "./types.ts";

export interface BinaryResolverEnv {
  /** PATH lookup for the literal name "markspec". */
  readonly whichCommand: (name: string) => Promise<string | undefined>;
  /** Absolute path of the running binary (Deno.execPath()). */
  readonly execPath: () => string;
  /** Async existence check, used to validate --binary-path. */
  readonly pathExists: (path: string) => Promise<boolean>;
}

export interface ResolveBinaryOptions {
  readonly env: BinaryResolverEnv;
  /** Absolute path passed via --binary-path, or undefined. */
  readonly binaryPathFlag: string | undefined;
}

export async function resolveBinaryRef(
  options: ResolveBinaryOptions,
): Promise<BinaryRef> {
  if (options.binaryPathFlag !== undefined) {
    const exists = await options.env.pathExists(options.binaryPathFlag);
    return {
      command: options.binaryPathFlag,
      warning: exists
        ? undefined
        : `--binary-path '${options.binaryPathFlag}' does not exist; MCP configs will reference it as-is`,
    };
  }
  const resolved = await options.env.whichCommand("markspec");
  const exec = options.env.execPath();
  if (resolved === undefined) {
    return {
      command: "markspec",
      warning:
        `'markspec' not on PATH; MCP auto-trigger may silently fail. Rerun with --binary-path ${exec}, or symlink ${exec} into a directory on PATH`,
    };
  }
  if (resolved !== exec) {
    return {
      command: "markspec",
      warning:
        `'markspec' on PATH resolves to ${resolved} but init is running from ${exec}. MCP auto-trigger may load the wrong version. Rerun with --binary-path ${exec}`,
    };
  }
  return { command: "markspec" };
}
