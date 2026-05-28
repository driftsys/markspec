import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { cleanupStaleOld, isDirWritable, swapBinary } from "./swap.ts";

Deno.test("isDirWritable: tempdir is writable", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assertEquals(await isDirWritable(dir), true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("isDirWritable: non-existent dir is not writable", async () => {
  assertEquals(
    await isDirWritable("/this/path/should/not/exist/anywhere/2026"),
    false,
  );
});

Deno.test("swapBinary: rename-dance leaves new bytes at currentPath, old at .old", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const current = join(dir, "markspec");
    const next = join(dir, "markspec.new");
    await Deno.writeTextFile(current, "OLD");
    await Deno.writeTextFile(next, "NEW");

    await swapBinary(current, next);
    assertEquals(await Deno.readTextFile(current), "NEW");
    assertEquals(await Deno.readTextFile(`${current}.old`), "OLD");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("swapBinary: removes pre-existing .old leftover before swap", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const current = join(dir, "markspec");
    const next = join(dir, "markspec.new");
    await Deno.writeTextFile(current, "OLD");
    await Deno.writeTextFile(`${current}.old`, "STALE");
    await Deno.writeTextFile(next, "NEW");

    await swapBinary(current, next);
    assertEquals(await Deno.readTextFile(current), "NEW");
    assertEquals(await Deno.readTextFile(`${current}.old`), "OLD");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("swapBinary: rolls back when step 2 fails", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const current = join(dir, "markspec");
    await Deno.writeTextFile(current, "OLD");
    // Pass a non-existent newPath so the second rename throws.

    await assertRejects(
      () => swapBinary(current, join(dir, "does-not-exist")),
      Error,
    );

    // Rollback: current should still be readable with OLD content.
    assertEquals(await Deno.readTextFile(current), "OLD");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cleanupStaleOld: removes .old if present", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const current = join(dir, "markspec");
    await Deno.writeTextFile(`${current}.old`, "STALE");
    await cleanupStaleOld(current);
    let exists = true;
    try {
      await Deno.stat(`${current}.old`);
    } catch {
      exists = false;
    }
    assert(!exists, "expected .old to be removed");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("cleanupStaleOld: no-op when .old absent", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const current = join(dir, "markspec");
    await cleanupStaleOld(current); // should not throw
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
