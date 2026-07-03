import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { writeConfigText } from "./write_config.ts";

Deno.test("writeConfigText: creates a new file with the given content", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "out.json");
    await writeConfigText(path, '{"a":1}');
    assertEquals(await Deno.readTextFile(path), '{"a":1}');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeConfigText: truncates and overwrites an existing file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "out.json");
    await Deno.writeTextFile(path, "old-longer-content");
    await writeConfigText(path, "new");
    assertEquals(await Deno.readTextFile(path), "new");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeConfigText: writes an empty string", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "empty.json");
    await writeConfigText(path, "");
    assertEquals(await Deno.readTextFile(path), "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  // The load-bearing property behind #634 for the write path: a write that
  // blocks (FIFO with no reader) must NOT starve the event loop, so a
  // concurrent timer can still fire. Deno.writeTextFile fails this;
  // writeConfigText (Deno.open) must pass it. POSIX-only.
  name: "writeConfigText: a blocked write leaves the event loop alive",
  ignore: Deno.build.os === "windows",
  // The write is intentionally left blocked (the FIFO never gets a
  // reader), so its open() op stays pending past the test — expected.
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const dir = await Deno.makeTempDir();
    try {
      const fifo = join(dir, "fifo");
      const mk = await new Deno.Command("mkfifo", { args: [fifo] }).output();
      assertEquals(mk.code, 0);
      const timer = new Promise<string>((resolve) =>
        setTimeout(() => resolve("timer-won"), 100)
      );
      const winner = await Promise.race([
        writeConfigText(fifo, "blocked"),
        timer,
      ]);
      assertEquals(winner, "timer-won");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
