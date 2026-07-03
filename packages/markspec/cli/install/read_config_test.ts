import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { readConfigText } from "./read_config.ts";

Deno.test("readConfigText: returns file contents for an existing file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "config.json");
    await Deno.writeTextFile(path, '{"hello":"world"}');
    assertEquals(await readConfigText(path), '{"hello":"world"}');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readConfigText: returns undefined for a missing file", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assertEquals(await readConfigText(join(dir, "nope.json")), undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readConfigText: reads an empty file as empty string", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = join(dir, "empty.json");
    await Deno.writeTextFile(path, "");
    assertEquals(await readConfigText(path), "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  // The load-bearing property behind #634: a read that blocks (FIFO with
  // no writer) must NOT starve the event loop, so a concurrent timer can
  // still fire. Deno.readTextFile fails this; readConfigText (Deno.open)
  // must pass it. POSIX-only.
  name: "readConfigText: a blocked read leaves the event loop alive",
  ignore: Deno.build.os === "windows",
  // The read is intentionally left blocked (the FIFO never gets a writer),
  // so its open() op stays pending past the test — expected, not a leak.
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const dir = await Deno.makeTempDir();
    try {
      const fifo = join(dir, "fifo");
      const mk = await new Deno.Command("mkfifo", { args: [fifo] }).output();
      assertEquals(mk.code, 0);
      // Race the never-resolving read against a short timer. If the read
      // starved the loop, the timer would never resolve and this test
      // would hang; a passing test proves the loop stayed alive.
      const timer = new Promise<string>((resolve) =>
        setTimeout(() => resolve("timer-won"), 100)
      );
      const winner = await Promise.race([readConfigText(fifo), timer]);
      assertEquals(winner, "timer-won");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
