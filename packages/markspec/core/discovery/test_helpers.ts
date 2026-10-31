/** Shared fixtures for discovery tests (not part of the public API). */

import { join } from "@std/path";
import type { DiscoveryIO } from "./mod.ts";

/** A `DiscoveryIO` backed by the real filesystem. */
export function realIO(): DiscoveryIO {
  return {
    readDir: (path) => Deno.readDir(path),
    readFile: async (path) => {
      try {
        return await Deno.readTextFile(path);
      } catch {
        return undefined;
      }
    },
  };
}

/** Create a temp directory holding `files` (relative path to content). */
export async function makeTree(files: Record<string, string>): Promise<string> {
  const dir = await Deno.makeTempDir();
  for (const [name, content] of Object.entries(files)) {
    const parts = name.split("/");
    if (parts.length > 1) {
      await Deno.mkdir(join(dir, ...parts.slice(0, -1)), { recursive: true });
    }
    await Deno.writeTextFile(join(dir, ...parts), content);
  }
  return dir;
}
