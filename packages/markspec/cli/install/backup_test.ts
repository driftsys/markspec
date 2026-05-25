import { assert, assertEquals, assertMatch } from "@std/assert";
import { backupPath, writeBackup } from "./backup.ts";

Deno.test("backupPath: appends .markspec-bak-<ISO8601>", () => {
  const p = backupPath("/tmp/foo.lua", new Date("2026-05-25T15:30:45.000Z"));
  assertEquals(p, "/tmp/foo.lua.markspec-bak-2026-05-25T15-30-45Z");
});

Deno.test("backupPath: dot-files get the suffix appended (not prepended)", () => {
  const p = backupPath("/tmp/.config", new Date("2026-05-25T15:30:45.000Z"));
  assertEquals(p, "/tmp/.config.markspec-bak-2026-05-25T15-30-45Z");
});

Deno.test("backupPath: zero-padded date parts", () => {
  const p = backupPath(
    "/home/user/file.txt",
    new Date("2026-01-05T09:05:03.789Z"),
  );
  assertEquals(p, "/home/user/file.txt.markspec-bak-2026-01-05T09-05-03Z");
});

Deno.test("writeBackup: copies the original file byte-identically", async () => {
  const tmp = await Deno.makeTempDir();
  const orig = `${tmp}/source.lua`;
  await Deno.writeTextFile(orig, "original content\n");
  try {
    const backup = await writeBackup(orig);
    const restored = await Deno.readTextFile(backup);
    assertEquals(restored, "original content\n");
    assertMatch(backup, /\.markspec-bak-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("writeBackup: preserves binary content exactly", async () => {
  const tmp = await Deno.makeTempDir();
  const orig = `${tmp}/binary.bin`;
  const binaryContent = new Uint8Array([0, 1, 127, 128, 255]);
  await Deno.writeFile(orig, binaryContent);
  try {
    const backup = await writeBackup(orig);
    const restored = await Deno.readFile(backup);
    assertEquals(restored, binaryContent);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("writeBackup: missing source file → throws", async () => {
  let threw = false;
  try {
    await writeBackup("/nonexistent/path.lua");
  } catch {
    threw = true;
  }
  assert(threw);
});
