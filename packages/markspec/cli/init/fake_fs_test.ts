import { assertEquals, assertRejects } from "@std/assert";
import { createMemFs, type MemFs } from "./fake_fs.ts";

Deno.test("MemFs: write then read round-trips", async () => {
  const fs: MemFs = createMemFs();
  await fs.write("/a/b.txt", "hello");
  assertEquals(await fs.read("/a/b.txt"), "hello");
  assertEquals(await fs.exists("/a/b.txt"), true);
});

Deno.test("MemFs: read of missing file returns undefined", async () => {
  const fs = createMemFs();
  assertEquals(await fs.read("/missing"), undefined);
  assertEquals(await fs.exists("/missing"), false);
});

Deno.test("MemFs: mkdir is idempotent", async () => {
  const fs = createMemFs();
  await fs.mkdir("/a/b/c");
  await fs.mkdir("/a/b/c");
  assertEquals(await fs.exists("/a/b/c"), true);
});

Deno.test("MemFs: remove deletes the file", async () => {
  const fs = createMemFs();
  await fs.write("/x", "y");
  await fs.remove("/x");
  assertEquals(await fs.exists("/x"), false);
});

Deno.test("MemFs: listEntries returns immediate children of a dir", async () => {
  const fs = createMemFs();
  await fs.write("/repo/a.md", "1");
  await fs.write("/repo/b.md", "2");
  await fs.write("/repo/sub/c.md", "3");
  const entries = await fs.listEntries("/repo");
  assertEquals([...entries].sort(), ["a.md", "b.md", "sub"]);
});

Deno.test("MemFs: write rejects without parent dir auto-create when option=false", async () => {
  const fs = createMemFs({ autoMkdir: false });
  await assertRejects(() => fs.write("/missing/x", "y"));
});

Deno.test("MemFs: write auto-creates parents by default", async () => {
  const fs = createMemFs();
  await fs.write("/a/b/c.txt", "ok");
  assertEquals(await fs.read("/a/b/c.txt"), "ok");
});
