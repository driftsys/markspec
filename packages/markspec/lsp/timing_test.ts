/**
 * @module lsp/timing_test
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { _resetTiming, time, timeAsync } from "./timing.ts";

async function withTempLog<T>(
  fn: (path: string) => T | Promise<T>,
): Promise<T> {
  _resetTiming();
  const path = await Deno.makeTempFile({ prefix: "markspec-timing-" });
  Deno.env.set("MARKSPEC_LSP_TIMING_LOG", path);
  try {
    return await fn(path);
  } finally {
    Deno.env.delete("MARKSPEC_LSP_TIMING_LOG");
    _resetTiming();
    try {
      await Deno.remove(path);
    } catch {
      /* already gone */
    }
  }
}

Deno.test("timing: no-op when env var unset", () => {
  _resetTiming();
  Deno.env.delete("MARKSPEC_LSP_TIMING_LOG");
  const result = time("noop", () => 42);
  assertEquals(result, 42);
});

Deno.test("timing: time() returns result and writes log line", async () => {
  await withTempLog(async (path) => {
    const result = time("sync-test", () => "hello");
    assertEquals(result, "hello");
    const contents = await Deno.readTextFile(path);
    assertStringIncludes(contents, "timing: sync-test");
    assertStringIncludes(contents, "ms");
  });
});

Deno.test("timing: timeAsync() returns result and writes log line", async () => {
  await withTempLog(async (path) => {
    const result = await timeAsync("async-test", async () => {
      await Promise.resolve();
      return 7;
    });
    assertEquals(result, 7);
    const contents = await Deno.readTextFile(path);
    assertStringIncludes(contents, "timing: async-test");
  });
});

Deno.test("timing: time() still logs when wrapped fn throws", async () => {
  await withTempLog(async (path) => {
    let threw = false;
    try {
      time("throws", () => {
        throw new Error("boom");
      });
    } catch {
      threw = true;
    }
    assert(threw, "expected exception to propagate");
    const contents = await Deno.readTextFile(path);
    assertStringIncludes(contents, "timing: throws");
  });
});

Deno.test("timing: timeAsync() still logs when wrapped fn rejects", async () => {
  await withTempLog(async (path) => {
    let threw = false;
    try {
      await timeAsync("rejects", async () => {
        await Promise.resolve();
        throw new Error("boom");
      });
    } catch {
      threw = true;
    }
    assert(threw, "expected rejection to propagate");
    const contents = await Deno.readTextFile(path);
    assertStringIncludes(contents, "timing: rejects");
  });
});
