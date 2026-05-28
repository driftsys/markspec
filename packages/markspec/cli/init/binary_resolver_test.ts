import { assertEquals } from "@std/assert";
import { type BinaryResolverEnv, resolveBinaryRef } from "./binary_resolver.ts";

const env = (
  which: string | undefined,
  exec = "/abs/run/markspec",
): BinaryResolverEnv => ({
  whichCommand: () => Promise.resolve(which),
  execPath: () => exec,
  pathExists: (p) => Promise.resolve(p === "/exists/markspec"),
});

Deno.test("resolveBinaryRef: --binary-path honored when path exists", async () => {
  const r = await resolveBinaryRef({
    env: env(undefined),
    binaryPathFlag: "/exists/markspec",
  });
  assertEquals(r.command, "/exists/markspec");
  assertEquals(r.warning, undefined);
});

Deno.test("resolveBinaryRef: --binary-path rejected when path does not exist", async () => {
  const r = await resolveBinaryRef({
    env: env(undefined),
    binaryPathFlag: "/nonexistent",
  });
  assertEquals(r.command, "/nonexistent");
  assertEquals(typeof r.warning, "string");
  assertEquals(r.warning!.includes("does not exist"), true);
});

Deno.test("resolveBinaryRef: no flag, PATH resolves to same exec, no warning", async () => {
  const r = await resolveBinaryRef({
    env: env("/abs/run/markspec"),
    binaryPathFlag: undefined,
  });
  assertEquals(r.command, "markspec");
  assertEquals(r.warning, undefined);
});

Deno.test("resolveBinaryRef: PATH absent → warn", async () => {
  const r = await resolveBinaryRef({
    env: env(undefined),
    binaryPathFlag: undefined,
  });
  assertEquals(r.command, "markspec");
  assertEquals(r.warning!.includes("not on PATH"), true);
});

Deno.test("resolveBinaryRef: PATH mismatch → warn with both paths", async () => {
  const r = await resolveBinaryRef({
    env: env("/different/markspec"),
    binaryPathFlag: undefined,
  });
  assertEquals(r.command, "markspec");
  assertEquals(r.warning!.includes("/different/markspec"), true);
  assertEquals(r.warning!.includes("/abs/run/markspec"), true);
});
