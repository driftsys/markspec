import { assertEquals } from "@std/assert";
import { detectTarget, type Platform, platformFromBuild } from "./target.ts";

Deno.test("detectTarget: linux x86_64 → x86_64-unknown-linux-gnu", () => {
  const p: Platform = { os: "linux", arch: "x86_64" };
  assertEquals(detectTarget(p), "x86_64-unknown-linux-gnu");
});

Deno.test("detectTarget: darwin x86_64 → x86_64-apple-darwin", () => {
  assertEquals(
    detectTarget({ os: "darwin", arch: "x86_64" }),
    "x86_64-apple-darwin",
  );
});

Deno.test("detectTarget: darwin aarch64 → aarch64-apple-darwin", () => {
  assertEquals(
    detectTarget({ os: "darwin", arch: "aarch64" }),
    "aarch64-apple-darwin",
  );
});

Deno.test("detectTarget: windows x86_64 → x86_64-pc-windows-msvc", () => {
  assertEquals(
    detectTarget({ os: "windows", arch: "x86_64" }),
    "x86_64-pc-windows-msvc",
  );
});

Deno.test("detectTarget: linux aarch64 → aarch64-unknown-linux-gnu", () => {
  assertEquals(
    detectTarget({ os: "linux", arch: "aarch64" }),
    "aarch64-unknown-linux-gnu",
  );
});

Deno.test("detectTarget: windows aarch64 (not shipped) → undefined", () => {
  assertEquals(detectTarget({ os: "windows", arch: "aarch64" }), undefined);
});

Deno.test("platformFromBuild: maps Deno.build.os/arch strings", () => {
  assertEquals(platformFromBuild("linux", "x86_64"), {
    os: "linux",
    arch: "x86_64",
  });
  assertEquals(platformFromBuild("darwin", "aarch64"), {
    os: "darwin",
    arch: "aarch64",
  });
  assertEquals(platformFromBuild("windows", "x86_64"), {
    os: "windows",
    arch: "x86_64",
  });
});

Deno.test("platformFromBuild: unknown os returns undefined", () => {
  assertEquals(platformFromBuild("freebsd", "x86_64"), undefined);
});

Deno.test("platformFromBuild: unknown arch returns undefined", () => {
  assertEquals(platformFromBuild("linux", "riscv64"), undefined);
});
