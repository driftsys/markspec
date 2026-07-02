/**
 * @module core/model/entry_origin_test
 *
 * Unit test for {@linkcode formatEntryOrigin} — the shared
 * `<profileId>@<profileVersion>` label for a delivered-corpus origin (ADR-030,
 * #674). The `corpusOriginLabel` twin (`core/profile/delivered.ts`) is covered
 * by the delivered-corpus loader tests.
 */

import { assertEquals } from "@std/assert";
import type { EntryOrigin } from "./mod.ts";
import { formatEntryOrigin } from "./mod.ts";

Deno.test("formatEntryOrigin: joins profile id and version with '@'", () => {
  const origin: EntryOrigin = {
    kind: "profile",
    profileId: "@acme/safety",
    profileVersion: "2.1.0",
  };
  assertEquals(formatEntryOrigin(origin), "@acme/safety@2.1.0");
});
