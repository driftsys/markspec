/**
 * @module lsp/version_notification_test
 *
 * Unit tests for the markspec/version notification payload builder.
 * Covers the four lockfile cases (none / no toolchain / floor met /
 * floor unmet).
 */

import { assertEquals } from "@std/assert";
import type { Lockfile } from "../core/mod.ts";
import { buildVersionNotification } from "./version_notification.ts";

const EMPTY_CACHE = { edgesHash: "sha256:0", edgesCount: 0 };

function lockfileWith(toolchainMinVersion: string | undefined): Lockfile {
  return {
    schema: 1,
    meta: {
      markspecSchema: 1,
      lockedAt: "2026-05-28T00:00:00Z",
      toolchain: toolchainMinVersion === undefined
        ? undefined
        : { minVersion: toolchainMinVersion },
    },
    upstreams: [],
    boundEntries: [],
    edges: [],
    generatedCache: EMPTY_CACHE,
  };
}

Deno.test("buildVersionNotification: no lockfile → minVersion null, isBelow false", () => {
  const payload = buildVersionNotification("0.6.1", 1, undefined);
  assertEquals(payload, {
    release: "0.6.1",
    coreSchemaVersion: 1,
    minVersion: null,
    isBelow: false,
  });
});

Deno.test("buildVersionNotification: lockfile without [meta.toolchain] → minVersion null, isBelow false", () => {
  const payload = buildVersionNotification("0.6.1", 1, lockfileWith(undefined));
  assertEquals(payload, {
    release: "0.6.1",
    coreSchemaVersion: 1,
    minVersion: null,
    isBelow: false,
  });
});

Deno.test("buildVersionNotification: floor met → minVersion echoed, isBelow false", () => {
  const payload = buildVersionNotification("0.6.1", 1, lockfileWith("0.6"));
  assertEquals(payload, {
    release: "0.6.1",
    coreSchemaVersion: 1,
    minVersion: "0.6",
    isBelow: false,
  });
});

Deno.test("buildVersionNotification: floor unmet → minVersion echoed, isBelow true", () => {
  const payload = buildVersionNotification("0.6.1", 1, lockfileWith("999.0"));
  assertEquals(payload, {
    release: "0.6.1",
    coreSchemaVersion: 1,
    minVersion: "999.0",
    isBelow: true,
  });
});
