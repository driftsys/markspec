import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildCorpusIndex, loadDeliveredCorpus } from "./delivered.ts";
import type { DeliveredDocument } from "../model/mod.ts";

const CORPUS_MD = `- [PLT_0001] Platform core service

  The platform core service shall expose the vehicle state bus.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV
`;

const doc = (over: Partial<DeliveredDocument>): DeliveredDocument => ({
  profileId: "platform-arch",
  profileVersion: "1.2.0",
  path: "ref/arch.md",
  absPath: "/cache/platform-arch/ref/arch.md",
  corpus: true,
  description: undefined,
  ...over,
});

Deno.test("loadDeliveredCorpus: parses corpus entries and stamps origin", async () => {
  const { entries, diagnostics } = await loadDeliveredCorpus(
    [doc({})],
    // deno-lint-ignore require-await
    async (
      p,
    ) => (p === "/cache/platform-arch/ref/arch.md" ? CORPUS_MD : undefined),
  );
  assertEquals(diagnostics.filter((d) => d.severity === "error"), []);
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "PLT_0001");
  assertEquals(entries[0].origin, {
    kind: "profile",
    profileId: "platform-arch",
    profileVersion: "1.2.0",
  });
});

Deno.test("loadDeliveredCorpus: missing corpus file is PROFILE-DELIVERS-001 error", async () => {
  const { entries, diagnostics } = await loadDeliveredCorpus(
    [doc({})],
    // deno-lint-ignore require-await
    async () => undefined,
  );
  assertEquals(entries, []);
  assertEquals(diagnostics[0].code, "PROFILE-DELIVERS-001");
  assertEquals(diagnostics[0].severity, "error");
  assertStringIncludes(diagnostics[0].message, "platform-arch@1.2.0");
});

Deno.test("loadDeliveredCorpus: missing docs-only file is PROFILE-DELIVERS-002 warning", async () => {
  const { diagnostics } = await loadDeliveredCorpus(
    [doc({ corpus: false, path: "ref/guide.md", absPath: "/x/guide.md" })],
    // deno-lint-ignore require-await
    async () => undefined,
  );
  assertEquals(diagnostics[0].code, "PROFILE-DELIVERS-002");
  assertEquals(diagnostics[0].severity, "warning");
});

Deno.test("loadDeliveredCorpus: docs-only file is never parsed", async () => {
  const { entries } = await loadDeliveredCorpus(
    [doc({ corpus: false })],
    // deno-lint-ignore require-await
    async () => CORPUS_MD,
  );
  assertEquals(entries, []);
});

Deno.test("loadDeliveredCorpus: corpus parse diagnostics are attributed", async () => {
  const { diagnostics } = await loadDeliveredCorpus(
    [doc({})],
    // malformed trailer → parser emits a diagnostic for this file
    // deno-lint-ignore require-await
    async () => `- [PLT_0002] Broken\n\n  Body.\n\n      Id: NOT_A_ULID\n`,
  );
  for (const d of diagnostics) {
    assertStringIncludes(d.message, "delivered by platform-arch@1.2.0:");
  }
});

Deno.test("buildCorpusIndex: keyed by absPath", () => {
  const d = doc({});
  assertEquals(buildCorpusIndex([d]).get(d.absPath), d);
});
