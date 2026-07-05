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
  // The remedy prose is origin-generic — it must not read as
  // corpus-exclusive, since the same MSL-R014 shape now also fires for
  // upstream origins (federated-upstream epic, slice 4).
  assertStringIncludes(
    diagnostics[0].message,
    "upstream and delivered-corpus entries are read-only",
  );
  assertEquals(collidedTokens.has("PLT_0001"), true);
});

Deno.test("detectCorpusCollisions: project entry reusing corpus Id (ULID) → MSL-R014", () => {
  // Distinct display IDs isolate the Id-collision branch: only the shared
  // ULID collides, so the finding must be the `Id '…'` message, not the
  // display-ID one.
  const sharedId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
  const corpus = makeEntry({
    displayId: "PLT_0001",
    id: sharedId,
    file: "/cache/p/ref.md",
    origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
  });
  const project = makeEntry({
    displayId: "REQ_0009",
    id: sharedId,
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
  assertStringIncludes(diagnostics[0].message, `Id '${sharedId}'`);
  assertStringIncludes(diagnostics[0].message, "p@1.0.0");
  assertStringIncludes(
    diagnostics[0].message,
    "upstream and delivered-corpus entries are read-only",
  );
  assertEquals(collidedTokens.has(sharedId), true);
  // The project entry keeps a unique display ID, so no display-ID token collides.
  assertEquals(collidedTokens.has("REQ_0009"), false);
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
  // Both origins are known (owner + colliding entry) — the design (D5:
  // "any collision is a hard diagnostic naming both origins") requires
  // naming both, not just the first-registered owner.
  assertStringIncludes(diagnostics[0].message, "p@1.0.0");
  assertStringIncludes(diagnostics[0].message, "q@2.0.0");
  assertEquals(collidedTokens.has("PLT_0001"), true);
});

Deno.test("detectCorpusCollisions: project entry reusing an UPSTREAM display ID → MSL-R014 naming the upstream origin", () => {
  const upstream = makeEntry({
    displayId: "PLT_2001",
    id: "01ARZ3NDEKTSV4RRFFQ69G5FD0",
    file: "/repo/.markspec/cache/upstream/productX/ref.md",
    origin: { kind: "upstream", upstreamId: "productX", version: "2.1.0" },
  });
  const project = makeEntry({
    displayId: "PLT_2001",
    id: "01ARZ3NDEKTSV4RRFFQ69G5FD1",
    file: "/repo/reqs.md",
  });
  const { diagnostics, collidedTokens } = detectCorpusCollisions([
    upstream,
    project,
  ]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "MSL-R014");
  assertEquals(diagnostics[0].severity, "error");
  assertEquals(diagnostics[0].location?.file, "/repo/reqs.md");
  assertStringIncludes(diagnostics[0].message, "productX@2.1.0");
  // The remedy must be origin-generic, not corpus-specific prose — this
  // collision was caused by an upstream entry, not a delivered corpus one.
  assertStringIncludes(
    diagnostics[0].message,
    "upstream and delivered-corpus entries are read-only",
  );
  assertEquals(collidedTokens.has("PLT_2001"), true);
});

Deno.test("detectCorpusCollisions: two upstreams declaring the same display ID → MSL-R014 naming both upstream origins", () => {
  const first = makeEntry({
    displayId: "PLT_3001",
    file: "/repo/.markspec/cache/upstream/productX/ref.md",
    origin: { kind: "upstream", upstreamId: "productX", version: "2.1.0" },
  });
  const second = makeEntry({
    displayId: "PLT_3001",
    file: "/repo/.markspec/cache/upstream/productY/ref.md",
    origin: { kind: "upstream", upstreamId: "productY", version: "1.0.0" },
  });
  const { diagnostics, collidedTokens } = detectCorpusCollisions([
    first,
    second,
  ]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "MSL-R014");
  assertEquals(diagnostics[0].severity, "error");
  assertEquals(
    diagnostics[0].location?.file,
    "/repo/.markspec/cache/upstream/productY/ref.md",
  );
  assertStringIncludes(diagnostics[0].message, "productX@2.1.0");
  assertStringIncludes(diagnostics[0].message, "productY@1.0.0");
  assertEquals(collidedTokens.has("PLT_3001"), true);
});

Deno.test("detectCorpusCollisions: upstream entry colliding with a profile-delivered corpus entry → MSL-R014 naming both origins", () => {
  const corpus = makeEntry({
    displayId: "PLT_4001",
    file: "/cache/p/ref.md",
    origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
  });
  const upstream = makeEntry({
    displayId: "PLT_4001",
    file: "/repo/.markspec/cache/upstream/productX/ref.md",
    origin: { kind: "upstream", upstreamId: "productX", version: "2.1.0" },
  });
  const { diagnostics } = detectCorpusCollisions([corpus, upstream]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "MSL-R014");
  assertStringIncludes(diagnostics[0].message, "p@1.0.0");
  assertStringIncludes(diagnostics[0].message, "productX@2.1.0");
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

Deno.test("attributeCorpusDiagnostics: every generic duplicate code is suppressed for a collided token", () => {
  // MSL-R014 replaces the generic duplicate codes for a corpus collision, so
  // all four must be suppressed once their token is in `collidedTokens`. The
  // suppression keys on the token appearing single-quoted (`'PLT_0001'`) in
  // the message — a load-bearing coupling with how the R005/R006/I007/I008
  // validators format their messages. These fixtures mirror that
  // single-quoted shape; if a producer stops single-quoting the token, the
  // generic duplicate leaks and this test fails, flagging the drift.
  for (const code of ["MSL-R005", "MSL-R006", "MSL-I007", "MSL-I008"]) {
    const out = attributeCorpusDiagnostics(
      [{
        code,
        severity: "error",
        message: `duplicate token 'PLT_0001' (also at /cache/p/ref.md:1)`,
        location: { file: "/repo/reqs.md", line: 5, column: 1 },
      }],
      [],
      new Set(["PLT_0001"]),
    );
    assertEquals(
      out,
      [],
      `${code} should be suppressed for the collided token`,
    );
  }
});

Deno.test("attributeCorpusDiagnostics: a generic duplicate for a non-collided token is kept", () => {
  // Only tokens in `collidedTokens` are suppressed; an unrelated duplicate
  // (a genuine project-side dup) must survive untouched.
  const input = [{
    code: "MSL-R006" as const,
    severity: "error" as const,
    message: "duplicate display ID 'OTHER_0002' (also at /repo/b.md:1)",
    location: { file: "/repo/reqs.md", line: 7, column: 1 },
  }];
  assertEquals(
    attributeCorpusDiagnostics(input, [], new Set(["PLT_0001"])),
    input,
  );
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

// ---------------------------------------------------------------------------
// #771 polish: upstream-aware remedies and attribution
// ---------------------------------------------------------------------------

Deno.test("detectCorpusCollisions: upstream↔upstream display-ID collision → consumer-actionable remedy", () => {
  const upstreamA = makeEntry({
    displayId: "SYS_0042",
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    file: "docs/a.md",
    origin: { kind: "upstream", upstreamId: "product", version: "v1" },
  });
  const upstreamB = makeEntry({
    displayId: "SYS_0042",
    id: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
    file: "docs/b.md",
    origin: { kind: "upstream", upstreamId: "icd", version: "v2" },
  });
  const { diagnostics } = detectCorpusCollisions([upstreamA, upstreamB]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "MSL-R014");
  // The consumer can rename neither read-only upstream entry — the remedy
  // must name an action the consumer CAN take, not "one must rename".
  assertEquals(diagnostics[0].message.includes("one must rename"), false);
  assertStringIncludes(diagnostics[0].message, "product@v1");
  assertStringIncludes(diagnostics[0].message, "icd@v2");
  assertStringIncludes(diagnostics[0].message, "project.yaml");
});

Deno.test("detectCorpusCollisions: corpus↔upstream collision also gets the consumer-actionable remedy", () => {
  // Mixed tiers: the consumer reading the diagnostic still owns
  // neither entry (the profile author does, but they are not the
  // audience) — same consumer-actionable wording as upstream↔upstream
  // (#799 review).
  const corpus = makeEntry({
    displayId: "STD_0001",
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    file: "/cache/p/ref.md",
    origin: { kind: "profile", profileId: "p", profileVersion: "1.0.0" },
  });
  const upstream = makeEntry({
    displayId: "STD_0001",
    id: "01ARZ3NDEKTSV4RRFFQ69G5FB0",
    file: "docs/a.md",
    origin: { kind: "upstream", upstreamId: "product", version: "v1" },
  });
  const { diagnostics } = detectCorpusCollisions([corpus, upstream]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].message.includes("one must rename"), false);
  assertStringIncludes(diagnostics[0].message, ".markspec.yaml");
});

Deno.test("attributeCorpusDiagnostics: upstream-located finding gets 'from upstream' attribution, not 'delivered by'", () => {
  const upstream = makeEntry({
    displayId: "SYS_0042",
    file: "docs/a.md",
    origin: { kind: "upstream", upstreamId: "product", version: "v1" },
  });
  // Vehicle is a generic per-entry code — NOT MSL-R014: collision
  // diagnostics are appended AFTER this post-pass at every production
  // call site and stay hard errors (ADR-031 D5); pinning a downgrade
  // for them here would spec a composition production never takes
  // (#799 review).
  const input = [{
    code: "MSL-M060",
    severity: "error" as const,
    message: "SYS_0042: modal keyword 'SHALL' must be lowercase",
    location: { file: "docs/a.md", line: 1, column: 1 },
  }];
  const out = attributeCorpusDiagnostics(input, [upstream], new Set());
  assertEquals(out.length, 1);
  assertEquals(out[0].severity, "warning");
  assertStringIncludes(out[0].message, "from upstream product@v1:");
  assertEquals(out[0].message.includes("delivered by"), false);
});
