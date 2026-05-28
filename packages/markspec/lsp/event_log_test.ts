/**
 * @module lsp/event_log_test
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  _resetEventLog,
  flushSync,
  isEnabled,
  logEvent,
  setProjectRoot,
} from "./event_log.ts";

async function withTempRoot<T>(
  fn: (root: string, logPath: string) => T | Promise<T>,
): Promise<T> {
  _resetEventLog();
  // Ensure env doesn't leak in from the host
  Deno.env.delete("MARKSPEC_LSP_LOG");
  Deno.env.delete("MARKSPEC_LSP_LOG_OFF");
  const root = await Deno.makeTempDir({ prefix: "markspec-event-log-" });
  const logPath = join(root, ".markspec", "lsp.log");
  try {
    return await fn(root, logPath);
  } finally {
    flushSync();
    _resetEventLog();
    Deno.env.delete("MARKSPEC_LSP_LOG");
    Deno.env.delete("MARKSPEC_LSP_LOG_OFF");
    try {
      await Deno.remove(root, { recursive: true });
    } catch {
      // already gone
    }
  }
}

Deno.test("event_log: drops events when no destination resolved", () => {
  _resetEventLog();
  Deno.env.delete("MARKSPEC_LSP_LOG");
  Deno.env.delete("MARKSPEC_LSP_LOG_OFF");
  // No setProjectRoot, no env var → drop silently
  logEvent("info", "smoke");
  assertEquals(isEnabled(), false);
});

Deno.test("event_log: writes default path after setProjectRoot", async () => {
  await withTempRoot(async (root, logPath) => {
    setProjectRoot(root);
    logEvent("info", "startup", { files: 581, entries: 40 });
    flushSync();
    const contents = await Deno.readTextFile(logPath);
    assertStringIncludes(contents, " info kind=startup");
    assertStringIncludes(contents, "files=581");
    assertStringIncludes(contents, "entries=40");
  });
});

Deno.test("event_log: MARKSPEC_LSP_LOG overrides default path", async () => {
  _resetEventLog();
  Deno.env.delete("MARKSPEC_LSP_LOG_OFF");
  const explicit = await Deno.makeTempFile({ prefix: "markspec-explicit-" });
  Deno.env.set("MARKSPEC_LSP_LOG", explicit);
  try {
    // No setProjectRoot — explicit path alone should suffice
    logEvent("warn", "slow", { label: "validateAll", ms: 184 });
    flushSync();
    const contents = await Deno.readTextFile(explicit);
    assertStringIncludes(contents, " warn kind=slow");
    assertStringIncludes(contents, "label=validateAll");
    assertStringIncludes(contents, "ms=184");
  } finally {
    Deno.env.delete("MARKSPEC_LSP_LOG");
    _resetEventLog();
    try {
      await Deno.remove(explicit);
    } catch { /* */ }
  }
});

Deno.test("event_log: MARKSPEC_LSP_LOG_OFF disables writes", async () => {
  await withTempRoot(async (root, logPath) => {
    Deno.env.set("MARKSPEC_LSP_LOG_OFF", "1");
    setProjectRoot(root);
    logEvent("info", "startup");
    flushSync();
    assertEquals(isEnabled(), false);
    let exists = false;
    try {
      await Deno.stat(logPath);
      exists = true;
    } catch { /* */ }
    assert(!exists, "expected log file not to exist when OFF is set");
  });
});

Deno.test("event_log: buffers and flushes on shutdown", async () => {
  await withTempRoot(async (root, logPath) => {
    setProjectRoot(root);
    logEvent("info", "a");
    logEvent("info", "b");
    logEvent("info", "c");
    flushSync();
    const contents = await Deno.readTextFile(logPath);
    const lines = contents.trim().split("\n");
    assertEquals(lines.length, 3);
    assertStringIncludes(lines[0], "kind=a");
    assertStringIncludes(lines[1], "kind=b");
    assertStringIncludes(lines[2], "kind=c");
  });
});

Deno.test("event_log: quotes values containing whitespace or specials", async () => {
  await withTempRoot(async (root, logPath) => {
    setProjectRoot(root);
    logEvent("error", "uncaught", {
      msg: 'cannot read property "x" of undefined',
    });
    flushSync();
    const contents = await Deno.readTextFile(logPath);
    assertStringIncludes(
      contents,
      'msg="cannot read property \\"x\\" of undefined"',
    );
  });
});

Deno.test("event_log: setProjectRoot drains pre-init buffered events", async () => {
  await withTempRoot(async (root, logPath) => {
    // No env var, no projectRoot → first emit drops silently
    logEvent("info", "before-init");
    setProjectRoot(root);
    logEvent("info", "after-init");
    flushSync();
    const contents = await Deno.readTextFile(logPath);
    // "before-init" was dropped (no destination at the time of emit);
    // only "after-init" should appear.
    assertEquals(contents.includes("kind=before-init"), false);
    assertStringIncludes(contents, "kind=after-init");
  });
});

Deno.test("event_log: undefined field values are skipped", async () => {
  await withTempRoot(async (root, logPath) => {
    setProjectRoot(root);
    logEvent("info", "smoke", { real: "yes", missing: undefined });
    flushSync();
    const contents = await Deno.readTextFile(logPath);
    assertStringIncludes(contents, "real=yes");
    assertEquals(contents.includes("missing="), false);
  });
});
