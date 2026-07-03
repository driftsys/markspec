import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import {
  DeadlineExceeded,
  DEFAULT_INSTALL_DEADLINE_MS,
  resolveInstallDeadlineMs,
  withDeadline,
} from "./deadline.ts";

Deno.test("withDeadline: resolves with work's value when work settles first", async () => {
  const value = await withDeadline(Promise.resolve(42), 1000);
  assertEquals(value, 42);
});

Deno.test("withDeadline: rejects with DeadlineExceeded when work stalls past the deadline", async () => {
  // A promise that never settles — models a wedged async syscall.
  const stalled = new Promise<never>(() => {});
  const err = await assertRejects(() => withDeadline(stalled, 20));
  assertInstanceOf(err, DeadlineExceeded);
  assertEquals(err.ms, 20);
});

Deno.test("withDeadline: clears the timer on fast resolve (no leaked timer)", async () => {
  // If the timer were not cleared, Deno's default op/resource sanitizer
  // would fail this test with a leaked-timer error.
  await withDeadline(Promise.resolve("ok"), 60_000);
});

Deno.test("resolveInstallDeadlineMs: default when the env var is unset", () => {
  assertEquals(
    resolveInstallDeadlineMs(() => undefined),
    DEFAULT_INSTALL_DEADLINE_MS,
  );
});

Deno.test("resolveInstallDeadlineMs: parses a valid positive override", () => {
  assertEquals(resolveInstallDeadlineMs(() => "500"), 500);
});

Deno.test("resolveInstallDeadlineMs: falls back on empty / NaN / zero / negative", () => {
  for (const bad of ["", "  ", "abc", "0", "-1", "NaN", "Infinity"]) {
    assertEquals(
      resolveInstallDeadlineMs(() => bad),
      DEFAULT_INSTALL_DEADLINE_MS,
      `expected fallback for ${JSON.stringify(bad)}`,
    );
  }
});
