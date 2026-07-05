/**
 * @module core/model/entry_origin_test
 *
 * Unit test for {@linkcode formatEntryOrigin} — the shared
 * `<profileId>@<profileVersion>` label for a delivered-corpus origin (ADR-030,
 * #674) — and {@linkcode sameOriginSource} — whether two origins come from
 * the same source regardless of version. The `corpusOriginLabel` twin
 * (`core/profile/delivered.ts`) is covered by the delivered-corpus loader
 * tests.
 */

import { assertEquals } from "@std/assert";
import type { Entry, EntryOrigin } from "./mod.ts";
import {
  emittableEntries,
  formatEntryOrigin,
  makeDisplayId,
  sameOriginSource,
} from "./mod.ts";

Deno.test("formatEntryOrigin: joins profile id and version with '@'", () => {
  const origin: EntryOrigin = {
    kind: "profile",
    profileId: "@acme/safety",
    profileVersion: "2.1.0",
  };
  assertEquals(formatEntryOrigin(origin), "@acme/safety@2.1.0");
});

Deno.test("formatEntryOrigin: upstream origin renders id@version", () => {
  const origin: EntryOrigin = {
    kind: "upstream",
    upstreamId: "product",
    version: "v2.1.0",
  };
  assertEquals(formatEntryOrigin(origin), "product@v2.1.0");
});

Deno.test("sameOriginSource: same profile id, different version → true", () => {
  const a: EntryOrigin = {
    kind: "profile",
    profileId: "@acme/safety",
    profileVersion: "1.0.0",
  };
  const b: EntryOrigin = {
    kind: "profile",
    profileId: "@acme/safety",
    profileVersion: "2.0.0",
  };
  assertEquals(sameOriginSource(a, b), true);
});

Deno.test("sameOriginSource: different upstream ids → false", () => {
  const a: EntryOrigin = {
    kind: "upstream",
    upstreamId: "product",
    version: "v1",
  };
  const b: EntryOrigin = { kind: "upstream", upstreamId: "icd", version: "v1" };
  assertEquals(sameOriginSource(a, b), false);
});

Deno.test("sameOriginSource: profile vs upstream → false", () => {
  const a: EntryOrigin = {
    kind: "profile",
    profileId: "product",
    profileVersion: "1",
  };
  const b: EntryOrigin = {
    kind: "upstream",
    upstreamId: "product",
    version: "1",
  };
  assertEquals(sameOriginSource(a, b), false);
});

function buildOriginEntry(displayId: string, origin?: EntryOrigin): Entry {
  return {
    displayId: makeDisplayId(displayId),
    title: displayId,
    body: "",
    shape: "Authored",
    source: { kind: "markdown" },
    rawAttributes: [],
    typedAttributes: new Map(),
    location: { file: "t.md", line: 1, column: 1 },
    bodyTokens: [],
    ...(origin ? { origin } : {}),
  };
}

Deno.test("emittableEntries: drops upstream, keeps project + corpus, preserves order", () => {
  const upstream = buildOriginEntry("SYS-0001", {
    kind: "upstream",
    upstreamId: "product",
    version: "v1",
  });
  const project = buildOriginEntry("STK-0001");
  const corpus = buildOriginEntry("STD-0001", {
    kind: "profile",
    profileId: "@acme/safety",
    profileVersion: "1.0.0",
  });
  const result = emittableEntries([upstream, project, corpus]);
  assertEquals(result.map((e) => e.displayId), ["STK-0001", "STD-0001"]);
});
