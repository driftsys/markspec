import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { writeTextFileAtomic } from "./write.ts";

/** Names of the entries of `dir`, sorted. */
async function namesIn(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) names.push(entry.name);
  return names.sort();
}

Deno.test("writeTextFileAtomic: replaces the file content", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "doc.md");
    await Deno.writeTextFile(path, "old\n");
    await writeTextFileAtomic(path, "new text\n");
    assertEquals(await Deno.readTextFile(path), "new text\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeTextFileAtomic: leaves no temporary file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "doc.md");
    await Deno.writeTextFile(path, "old\n");
    await writeTextFileAtomic(path, "new\n");
    assertEquals(await namesIn(dir), ["doc.md"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  name: "writeTextFileAtomic: keeps the file mode",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const dir = await Deno.makeTempDir();
    try {
      const path = join(dir, "doc.md");
      await Deno.writeTextFile(path, "old\n");
      await Deno.chmod(path, 0o640);
      await writeTextFileAtomic(path, "new\n");
      assertEquals((await Deno.stat(path)).mode! & 0o777, 0o640);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "writeTextFileAtomic: renames a new file over the original",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    const dir = await Deno.makeTempDir();
    try {
      const path = join(dir, "doc.md");
      await Deno.writeTextFile(path, "old\n");
      const before = (await Deno.stat(path)).ino;
      await writeTextFileAtomic(path, "new\n");
      const after = (await Deno.stat(path)).ino;
      // A rename gives the path a new inode; an in-place write keeps it.
      assert(before !== null && after !== null);
      assert(before !== after, "the file was written in place");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test("writeTextFileAtomic: keeps a UTF-8 BOM", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "doc.md");
    await Deno.writeFile(
      path,
      new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("old\n")]),
    );
    // A text read strips the BOM, so callers pass text without it.
    await writeTextFileAtomic(path, "new\n");
    const bytes = await Deno.readFile(path);
    assertEquals([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    assertEquals(new TextDecoder().decode(bytes.slice(3)), "new\n");
    // A text that already starts with a BOM gets no second one.
    await writeTextFileAtomic(path, "﻿again\n");
    const again = await Deno.readFile(path);
    assertEquals([...again.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    assertEquals(new TextDecoder().decode(again.slice(3)), "again\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeTextFileAtomic: removes the temp file when rename fails", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const target = join(dir, "doc.md");
    await Deno.mkdir(target);
    await Deno.writeTextFile(join(target, "inside.txt"), "x");
    await assertRejects(() => writeTextFileAtomic(target, "new\n"));
    const names = await namesIn(dir);
    assertEquals(names, ["doc.md"]);
    assert(!names.some((n) => n.endsWith(".tmp")));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
