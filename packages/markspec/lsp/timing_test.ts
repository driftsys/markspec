/**
 * @module lsp/timing_test
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { _resetEventLog, flushSync } from "./event_log.ts";
import { time, timeAsync } from "./timing.ts";

/**
 * Set up a temp MARKSPEC_LSP_LOG so the default-on event_log writes
 * land in a known location. Mirrors `event_log_test.ts` so slow-event
 * assertions can read the destination file directly.
 */
async function withEventLog<T>(
  fn: (logPath: string) => T | Promise<T>,
): Promise<T> {
  _resetEventLog();
  Deno.env.delete("MARKSPEC_LSP_LOG");
  Deno.env.delete("MARKSPEC_LSP_LOG_OFF");
  const logPath = await Deno.makeTempFile({ prefix: "markspec-slow-events-" });
  Deno.env.set("MARKSPEC_LSP_LOG", logPath);
  try {
    return await fn(logPath);
  } finally {
    flushSync();
    _resetEventLog();
    Deno.env.delete("MARKSPEC_LSP_LOG");
    Deno.env.delete("MARKSPEC_LSP_LOG_OFF");
    try {
      await Deno.remove(logPath);
    } catch {
      /* already gone */
    }
  }
}

/** Busy-wait so duration is wall-clock independent of timer fidelity. */
function busySleep(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // tight loop
  }
}

Deno.test("timing: time() returns wrapped result", () => {
  const result = time("unregistered-label", () => 42);
  assertEquals(result, 42);
});

Deno.test("timing: timeAsync() returns wrapped result", async () => {
  const result = await timeAsync("unregistered-label", async () => {
    await Promise.resolve();
    return 7;
  });
  assertEquals(result, 7);
});

Deno.test("timing: time() propagates exceptions", () => {
  let threw = false;
  try {
    time("unregistered-label", () => {
      throw new Error("boom");
    });
  } catch {
    threw = true;
  }
  assert(threw, "expected exception to propagate");
});

Deno.test("timing: timeAsync() propagates rejections", async () => {
  let threw = false;
  try {
    await timeAsync("unregistered-label", async () => {
      await Promise.resolve();
      throw new Error("boom");
    });
  } catch {
    threw = true;
  }
  assert(threw, "expected rejection to propagate");
});

Deno.test("timing: time() returns result for a registered label", async () => {
  // Registered label triggers the slow-flag path; verify result still
  // flows through.
  await withEventLog(() => {
    const result = time("onInitialized/parseFile", () => "hello");
    assertEquals(result, "hello");
  });
});

Deno.test("timing: time() still flags slow when wrapped fn throws", async () => {
  await withEventLog(async (logPath) => {
    let threw = false;
    try {
      time("onInitialized/parseFile", () => {
        busySleep(60);
        throw new Error("boom");
      });
    } catch {
      threw = true;
    }
    assert(threw, "expected exception to propagate");
    flushSync();
    const contents = await Deno.readTextFile(logPath);
    assertStringIncludes(contents, "kind=slow");
    assertStringIncludes(contents, "label=onInitialized/parseFile");
  });
});

Deno.test("timing: slow event fires when threshold exceeded (sync)", async () => {
  await withEventLog(async (logPath) => {
    // onInitialized/parseFile threshold is 50ms; sleep 60ms.
    time("onInitialized/parseFile", () => {
      busySleep(60);
    });
    flushSync();
    const contents = await Deno.readTextFile(logPath);
    assertStringIncludes(contents, " warn kind=slow");
    assertStringIncludes(contents, "label=onInitialized/parseFile");
    assertStringIncludes(contents, "threshold=50");
    assertStringIncludes(contents, "ms=");
  });
});

Deno.test("timing: slow event does NOT fire when below threshold", async () => {
  await withEventLog(async (logPath) => {
    // Fast no-op under the 50ms threshold.
    time("onInitialized/parseFile", () => 1);
    flushSync();
    let contents = "";
    try {
      contents = await Deno.readTextFile(logPath);
    } catch {
      // File may not exist yet; that's also "no slow event".
    }
    assertEquals(contents.includes("kind=slow"), false);
  });
});

Deno.test("timing: slow event does NOT fire for unregistered label", async () => {
  await withEventLog(async (logPath) => {
    // "noSuchPrefix" matches no entry in THRESHOLDS.
    time("noSuchPrefix", () => {
      busySleep(60);
    });
    flushSync();
    let contents = "";
    try {
      contents = await Deno.readTextFile(logPath);
    } catch {
      // File may not exist yet.
    }
    assertEquals(contents.includes("kind=slow"), false);
  });
});

Deno.test("timing: slow event fires for async", async () => {
  await withEventLog(async (logPath) => {
    await timeAsync("onInitialized/parseFile", async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
    });
    flushSync();
    const contents = await Deno.readTextFile(logPath);
    assertStringIncludes(contents, " warn kind=slow");
    assertStringIncludes(contents, "label=onInitialized/parseFile");
    assertStringIncludes(contents, "threshold=50");
  });
});

Deno.test("timing: longest matching prefix wins", async () => {
  await withEventLog(async (logPath) => {
    // "onInitialized/parseFile" is more specific than the (hypothetical)
    // shorter "onInitialized/" prefix and currently sits before
    // "onInitialized/parseAll" in THRESHOLDS — confirm its 50ms
    // threshold applies, not the 5000ms parseAll threshold.
    time("onInitialized/parseFile", () => {
      busySleep(60);
    });
    flushSync();
    const contents = await Deno.readTextFile(logPath);
    assertStringIncludes(contents, "label=onInitialized/parseFile");
    assertStringIncludes(contents, "threshold=50");
    // The parseAll threshold (5000) must not appear for this label.
    assertEquals(contents.includes("threshold=5000"), false);
  });
});
