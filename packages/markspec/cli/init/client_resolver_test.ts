import { assertEquals } from "@std/assert";
import type { DetectEnv } from "../install/adapters.ts";
import { resolveClientSet } from "./client_resolver.ts";

const ALL_DETECTED: DetectEnv = {
  whichCommand: () => Promise.resolve("/usr/bin/x"),
  pathExists: () => Promise.resolve(true),
  projectRoot: "/r",
  homeDir: "/h",
};

const NONE_DETECTED: DetectEnv = {
  whichCommand: () => Promise.resolve(undefined),
  pathExists: () => Promise.resolve(false),
  projectRoot: "/r",
  homeDir: "/h",
};

Deno.test("resolveClientSet: detected clients are written", async () => {
  const set = await resolveClientSet({
    env: ALL_DETECTED,
    forcedClients: [],
    allClients: false,
    noMcp: false,
  });
  assertEquals(set.write.has("claude-code"), true);
  assertEquals(set.write.has("opencode"), true);
});

Deno.test("resolveClientSet: --no-mcp returns empty", async () => {
  const set = await resolveClientSet({
    env: ALL_DETECTED,
    forcedClients: [],
    allClients: false,
    noMcp: true,
  });
  assertEquals(set.write.size, 0);
});

Deno.test("resolveClientSet: --all-clients overrides detection (claude-code + opencode only)", async () => {
  const set = await resolveClientSet({
    env: NONE_DETECTED,
    forcedClients: [],
    allClients: true,
    noMcp: false,
  });
  assertEquals(set.write.has("claude-code"), true);
  assertEquals(set.write.has("opencode"), true);
});

Deno.test("resolveClientSet: --client claude-code forces despite no detection", async () => {
  const set = await resolveClientSet({
    env: NONE_DETECTED,
    forcedClients: ["claude-code"],
    allClients: false,
    noMcp: false,
  });
  assertEquals(set.write.has("claude-code"), true);
});

Deno.test("resolveClientSet: --no-mcp wins over --client", async () => {
  const set = await resolveClientSet({
    env: ALL_DETECTED,
    forcedClients: ["claude-code"],
    allClients: false,
    noMcp: true,
  });
  assertEquals(set.write.size, 0);
});
