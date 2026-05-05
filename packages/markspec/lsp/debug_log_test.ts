import { assertEquals, assertStringIncludes } from "@std/assert";
import { _resetDebugLog, debugLog, getDebugLogPath } from "./debug_log.ts";

Deno.test("debug_log: no-op when env var is unset", () => {
  Deno.env.delete("MARKSPEC_LSP_DEBUG_LOG");
  _resetDebugLog();
  assertEquals(getDebugLogPath(), undefined);
  // Does not throw.
  debugLog("noop");
});

Deno.test("debug_log: writes timestamped lines when env var is set", async () => {
  const path = await Deno.makeTempFile({ suffix: ".log" });
  try {
    Deno.env.set("MARKSPEC_LSP_DEBUG_LOG", path);
    _resetDebugLog();
    debugLog("first event");
    debugLog("second event");
    const content = await Deno.readTextFile(path);
    const lines = content.trim().split("\n");
    assertEquals(lines.length, 2);
    assertStringIncludes(lines[0], "first event");
    assertStringIncludes(lines[1], "second event");
    // ISO-8601 prefix
    const isoMatch = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/.test(
      lines[0],
    );
    assertEquals(isoMatch, true);
  } finally {
    Deno.env.delete("MARKSPEC_LSP_DEBUG_LOG");
    _resetDebugLog();
    await Deno.remove(path);
  }
});

Deno.test("debug_log: empty env var value is treated as unset", () => {
  Deno.env.set("MARKSPEC_LSP_DEBUG_LOG", "");
  _resetDebugLog();
  assertEquals(getDebugLogPath(), undefined);
  Deno.env.delete("MARKSPEC_LSP_DEBUG_LOG");
});
