import { assertEquals } from "@std/assert";
import type { ResolvedUpstreams, ResolveUpstreamsOptions } from "./resolve.ts";
import { resolveReferences } from "./resolve.ts";
import { makeDisplayId } from "../model/mod.ts";
import type { Attribute, Entry } from "../model/mod.ts";

Deno.test("ResolveUpstreamsOptions: type compiles with empty inputs", () => {
  const opts: ResolveUpstreamsOptions = {
    entries: [],
    profileChain: [],
    config: {
      name: "x",
      version: "0.0.0",
      labels: [],
      parents: [],
      parentFallback: "",
      captionConventions: {},
    },
    mappings: [],
    fetchUrl: () => Promise.resolve({ error: "stub" }),
  };
  assertEquals(opts.entries.length, 0);

  // Smoke-check the resolved-upstreams shape is constructible.
  const resolved: ResolvedUpstreams = {
    references: [],
    profiles: [],
    registries: [],
    boundEntries: [],
    canonicalEdgeHash: "sha256:0",
    canonicalEdgeCount: 0,
    lockedAt: "2026-05-25T12:00:00Z",
    diagnostics: [],
  };
  assertEquals(resolved.canonicalEdgeCount, 0);
});

/**
 * Build a minimal Reference entry. Populates `rawAttributes` (which the
 * implementation reads via `attrValue`); `typedAttributes` is left empty
 * because the implementation never consults it. The empty-map `as never`
 * cast satisfies the `TypedAttributes` slot in the Entry shape.
 */
function mkRef(displayId: string, id: string, refUrl?: string): Entry {
  const rawAttributes: Attribute[] = [{ key: "Id", value: id }];
  if (refUrl !== undefined) {
    rawAttributes.push({ key: "Reference-url", value: refUrl });
  }
  return {
    displayId: makeDisplayId(displayId),
    title: displayId,
    body: "",
    rawAttributes,
    typedAttributes: new Map() as never,
    id,
    shape: "Reference",
    location: { file: "refs.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  };
}

Deno.test("resolveReferences: Reference with Reference-url is fetched and hashed", async () => {
  const ref = mkRef(
    "ISO-26262-6",
    "urn:iso:std:iso:26262:-6:ed-2",
    "file:///fixtures/iso.txt",
  );
  const fetched = new TextEncoder().encode("fixture bytes");
  const result = await resolveReferences([ref], (url: string) => {
    if (url === "file:///fixtures/iso.txt") return Promise.resolve(fetched);
    return Promise.resolve({ error: "not found" });
  });
  assertEquals(result.length, 1);
  assertEquals(result[0].upstream.slug, "ISO-26262-6");
  assertEquals(typeof result[0].upstream.hash, "string");
  assertEquals(result[0].upstream.source, "file:///fixtures/iso.txt");
});

Deno.test("resolveReferences: Reference without Reference-url is identity-only + MSL-L010", async () => {
  const ref = mkRef("serde", "pkg:cargo/serde@1.0.0");
  const result = await resolveReferences(
    [ref],
    () => Promise.resolve({ error: "x" }),
  );
  assertEquals(result[0].upstream.hash, undefined);
  assertEquals(result[0].diagnostics[0].code, "MSL-L010");
});

Deno.test("resolveReferences: fetch failure emits MSL-L101 warning, identity-only", async () => {
  const ref = mkRef(
    "RFC-2119",
    "https://www.rfc-editor.org/rfc/rfc2119",
    "file:///missing",
  );
  const result = await resolveReferences(
    [ref],
    () => Promise.resolve({ error: "no such file" }),
  );
  assertEquals(result[0].upstream.hash, undefined);
  assertEquals(result[0].diagnostics.some((d) => d.code === "MSL-L101"), true);
});

Deno.test("resolveReferences: dedupe by slug", async () => {
  const a = mkRef("ISO-26262-6", "urn:iso:std:iso:26262:-6:ed-2", "file:///a");
  const b = mkRef("ISO-26262-6", "urn:iso:std:iso:26262:-6:ed-2", "file:///a");
  const result = await resolveReferences(
    [a, b],
    () => Promise.resolve(new TextEncoder().encode("x")),
  );
  assertEquals(result.length, 1);
});
