import { assertEquals } from "@std/assert";
import { parseLockfile } from "../../../core/mod.ts";
import { createMemFs } from "../fake_fs.ts";
import {
  buildMarkspecLockStub,
  scaffoldMarkspecLock,
} from "./markspec_lock.ts";

Deno.test("buildMarkspecLockStub: TOML round-trips through parseLockfile", async () => {
  const toml = await buildMarkspecLockStub({
    toolchainMinVersion: "0.6",
    lockedAt: "2026-05-28T12:00:00Z",
  });
  const parsed = parseLockfile(toml);
  assertEquals(parsed.lockfile !== undefined, true, "parse should succeed");
  assertEquals(parsed.diagnostics.length, 0);
  assertEquals(parsed.lockfile!.meta.toolchain?.minVersion, "0.6");
  assertEquals(parsed.lockfile!.upstreams.length, 0);
  assertEquals(parsed.lockfile!.boundEntries.length, 0);
});

Deno.test("buildMarkspecLockStub: deterministic for the same inputs", async () => {
  const a = await buildMarkspecLockStub({
    toolchainMinVersion: "0.6",
    lockedAt: "2026-05-28T12:00:00Z",
  });
  const b = await buildMarkspecLockStub({
    toolchainMinVersion: "0.6",
    lockedAt: "2026-05-28T12:00:00Z",
  });
  assertEquals(a, b);
});

Deno.test("scaffoldMarkspecLock: writes when absent", async () => {
  const fs = createMemFs();
  const wrote = await scaffoldMarkspecLock(fs, "/r", {
    toolchainMinVersion: "0.6",
    lockedAt: "2026-05-28T12:00:00Z",
  });
  assertEquals(wrote, true);
  const out = await fs.read("/r/markspec.lock");
  assertEquals(out !== undefined, true);
});

Deno.test("scaffoldMarkspecLock: skips when present", async () => {
  const fs = createMemFs();
  await fs.write("/r/markspec.lock", "existing");
  const wrote = await scaffoldMarkspecLock(fs, "/r", {
    toolchainMinVersion: "0.6",
    lockedAt: "2026-05-28T12:00:00Z",
  });
  assertEquals(wrote, false);
  assertEquals(await fs.read("/r/markspec.lock"), "existing");
});
