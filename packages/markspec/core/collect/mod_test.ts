/**
 * @module core/collect/mod_test
 *
 * Unit tests for {@linkcode collectProjectEntries} — the single
 * discover-and-parse collector shared by `lock` (the edge-hash pinner)
 * and its checkers (`compile`, `fmt`, `doctor`).
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { DiscoveryIO } from "../discovery/mod.ts";
import { collectProjectEntries } from "./mod.ts";

function realIO(): DiscoveryIO {
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

async function makeTree(files: Record<string, string>): Promise<string> {
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

const REQ_A = `# A

- [REQ-0001] First

  The system shall do X within 10 ms.

      Id: 01REQ000000000000000000001
      Type: requirement
`;

const REQ_B = `# B

- [REQ-0002] Second

  The system shall do Y within 20 ms.

      Id: 01REQ000000000000000000002
      Type: requirement
`;

const ids = (es: Awaited<ReturnType<typeof collectProjectEntries>>) =>
  es.map((e) => String(e.displayId)).sort();

Deno.test("collectProjectEntries: discovers + parses markdown entries across the tree", async () => {
  const dir = await makeTree({ "docs/a.md": REQ_A, "docs/sub/b.md": REQ_B });
  try {
    const entries = await collectProjectEntries(dir, realIO());
    assertEquals(ids(entries), ["REQ-0001", "REQ-0002"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collectProjectEntries: honors exclude patterns", async () => {
  const dir = await makeTree({ "docs/a.md": REQ_A, "vendor/b.md": REQ_B });
  try {
    const entries = await collectProjectEntries(dir, realIO(), {
      exclude: ["vendor/"],
    });
    assertEquals(ids(entries), ["REQ-0001"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("collectProjectEntries: relies on the default extension set (ignores .txt)", async () => {
  const dir = await makeTree({ "docs/a.md": REQ_A, "notes.txt": REQ_B });
  try {
    // No `extensions` passed — the default RELEVANT_EXTENSIONS excludes .txt,
    // the same default `markspec lock` relies on (parity point).
    const entries = await collectProjectEntries(dir, realIO());
    assertEquals(ids(entries), ["REQ-0001"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
