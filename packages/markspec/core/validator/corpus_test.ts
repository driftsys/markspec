/**
 * @module validator/corpus_test
 *
 * Unit tests for the corpus-aware diagnostic post-pass (ADR-030):
 * `detectCorpusCollisions` (MSL-R014) and `attributeCorpusDiagnostics`
 * (suppression + downgrade/attribution).
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Entry } from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";
import {
  attributeCorpusDiagnostics,
  detectCorpusCollisions,
} from "./corpus.ts";

/** Minimal Entry fixture builder, adapted from `mod_test.ts`'s `entry()`
 * helper — adds `file` (projected into `location.file`) and `origin`
 * (ADR-030 provenance) since those are what this module's tests key on. */
function makeEntry(
  partial: Partial<Omit<Entry, "displayId" | "location">> & {
    displayId: string;
    file?: string;
  },
): Entry {
  return {
    displayId: makeDisplayId(partial.displayId),
    title: partial.title ?? "Test entry",
    body: partial.body ?? "Body.",
    rawAttributes: partial.rawAttributes ?? [],
    id: partial.id,
    shape: partial.shape ?? "Authored",
    location: { file: partial.file ?? "test.md", line: 1, column: 1 },
    source: partial.source ?? { kind: "markdown" },
    typedAttributes: partial.typedAttributes ?? new Map(),
    bodyTokens: partial.bodyTokens ?? [],
    origin: partial.origin,
  };
}

// ---------------------------------------------------------------------------
// detectCorpusCollisions
// ---------------------------------------------------------------------------

Deno.test("detectCorpusCollisions: project entry reusing corpus display ID → MSL-R014", () => {
  const corpus = makeEntry({
    displayId: "PLT_0001",
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    file: "/cache/p/ref.md",
    origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
  });
  const project = makeEntry({
    displayId: "PLT_0001",
    id: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
    file: "/repo/reqs.md",
  });
  const { diagnostics, collidedTokens } = detectCorpusCollisions([
    corpus,
    project,
  ]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "MSL-R014");
  assertEquals(diagnostics[0].severity, "error");
  assertEquals(diagnostics[0].location?.file, "/repo/reqs.md");
  assertStringIncludes(diagnostics[0].message, "p@1.0.0");
  assertEquals(collidedTokens.has("PLT_0001"), true);
});

Deno.test("detectCorpusCollisions: no corpus entries → no findings", () => {
  const a = makeEntry({ displayId: "STK_0001", file: "/repo/a.md" });
  assertEquals(detectCorpusCollisions([a]).diagnostics, []);
});

Deno.test("detectCorpusCollisions: corpus entries from different profiles sharing a display ID → MSL-R014", () => {
  const first = makeEntry({
    displayId: "PLT_0001",
    file: "/cache/p/ref.md",
    origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
  });
  const second = makeEntry({
    displayId: "PLT_0001",
    file: "/cache/q/ref.md",
    origin: { kind: "profile", profileId: "q", profileVersion: "2.0.0" },
  });
  const { diagnostics, collidedTokens } = detectCorpusCollisions([
    first,
    second,
  ]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "MSL-R014");
  assertEquals(diagnostics[0].severity, "error");
  assertEquals(diagnostics[0].location?.file, "/cache/q/ref.md");
  assertStringIncludes(diagnostics[0].message, "p@1.0.0");
  assertEquals(collidedTokens.has("PLT_0001"), true);
});

Deno.test("detectCorpusCollisions: same-profile duplicate display ID stays generic (no R014)", () => {
  const first = makeEntry({
    displayId: "PLT_0001",
    file: "/cache/p/a.md",
    origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
  });
  const second = makeEntry({
    displayId: "PLT_0001",
    file: "/cache/p/b.md",
    origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
  });
  const { diagnostics, collidedTokens } = detectCorpusCollisions([
    first,
    second,
  ]);
  assertEquals(diagnostics, []);
  assertEquals(collidedTokens.size, 0);
});

// ---------------------------------------------------------------------------
// attributeCorpusDiagnostics
// ---------------------------------------------------------------------------

Deno.test("attributeCorpusDiagnostics: corpus-located error downgrades to attributed warning", () => {
  const corpus = makeEntry({
    displayId: "PLT_0001",
    file: "/cache/p/ref.md",
    origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
  });
  const out = attributeCorpusDiagnostics(
    [{
      code: "MSL-L006",
      severity: "error",
      message: "link target does not resolve: PLT_9999",
      location: { file: "/cache/p/ref.md", line: 3, column: 1 },
    }],
    [corpus],
    new Set(),
  );
  assertEquals(out[0].severity, "warning");
  assertStringIncludes(out[0].message, "delivered by p@1.0.0:");
});

Deno.test("attributeCorpusDiagnostics: generic duplicate codes suppressed for collided tokens", () => {
  const out = attributeCorpusDiagnostics(
    [{
      code: "MSL-R006",
      severity: "error",
      message: "duplicate display ID 'PLT_0001' (also at /cache/p/ref.md:1)",
      location: { file: "/repo/reqs.md", line: 5, column: 1 },
    }],
    [],
    new Set(["PLT_0001"]),
  );
  assertEquals(out, []);
});

Deno.test("attributeCorpusDiagnostics: project-side diagnostics untouched", () => {
  const input = [{
    code: "MSL-L006" as const,
    severity: "warning" as const,
    message: "link target does not resolve: NOPE_1",
    location: { file: "/repo/reqs.md", line: 2, column: 1 },
  }];
  assertEquals(attributeCorpusDiagnostics(input, [], new Set()), input);
});
