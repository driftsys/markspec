import { assertEquals } from "@std/assert";
import type { ResolvedUpstreams, ResolveUpstreamsOptions } from "./resolve.ts";
import {
  resolveBoundEntries,
  resolveProfileChain,
  resolveReferences,
  resolveRegistries,
} from "./resolve.ts";
import { parseMapping } from "../sync/mod.ts";
import { makeDisplayId } from "../model/mod.ts";
import type {
  Attribute,
  Entry,
  ProfileChain,
  ProfileSpecifier,
} from "../model/mod.ts";

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
    readFile: () => Promise.resolve({ error: "stub" }),
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

// ---------------------------------------------------------------------------
// resolveProfileChain tests (Task 16)
// ---------------------------------------------------------------------------

/**
 * Build a minimal LoadedProfile-shaped object. The Reference + RegistryFn
 * tests only need id, version, specifier, sourcePath, baseDir; the
 * `manifest` field is opaque to the resolver and can be left as a sparse
 * cast. `as never` on the manifest is bounded — only the resolver's
 * narrow access path is asserted by the tests.
 */
function mkTier(
  id: string,
  version: string,
  specifier: ProfileSpecifier,
  sourcePath = `/fake/${id}/markspec.yaml`,
) {
  return {
    id,
    version,
    specifier,
    manifest: {} as never,
    sourcePath,
    baseDir: `/fake/${id}`,
  };
}

Deno.test(
  "resolveProfileChain: each tier becomes a profile upstream with extends pointing at parent id",
  async () => {
    const chain = {
      tiers: [
        mkTier("@markspec/default", "0.5.3", { kind: "builtin" }),
        mkTier(
          "@org/aspice",
          "1.2.4",
          { kind: "npm", scope: "@org", name: "aspice", range: "^1.2" },
          "/fake/aspice/markspec.yaml",
        ),
      ],
      effective: {} as never,
    } as unknown as ProfileChain;

    const readFile = (path: string) => {
      if (path === "/fake/@markspec/default/markspec.yaml") {
        return Promise.resolve(
          new TextEncoder().encode(
            "id: '@markspec/default'\nversion: 0.5.3\n",
          ),
        );
      }
      if (path === "/fake/aspice/markspec.yaml") {
        return Promise.resolve(
          new TextEncoder().encode("id: '@org/aspice'\nversion: 1.2.4\n"),
        );
      }
      return Promise.resolve({ error: `unexpected path ${path}` });
    };

    const result = await resolveProfileChain(chain, readFile);
    assertEquals(result.length, 2);
    assertEquals(result[0].upstream.id, "@markspec/default");
    assertEquals(result[0].upstream.specifier, "builtin");
    assertEquals(result[0].upstream.resolved, "0.5.3");
    assertEquals(result[0].upstream.extends, undefined); // root has no parent
    assertEquals(typeof result[0].upstream.hash, "string");
    assertEquals(result[1].upstream.id, "@org/aspice");
    assertEquals(result[1].upstream.specifier, "npm:@org/aspice@^1.2");
    assertEquals(result[1].upstream.extends, "@markspec/default");
  },
);

Deno.test("resolveProfileChain: empty chain returns []", async () => {
  const result = await resolveProfileChain(
    [],
    () => Promise.resolve({ error: "stub" }),
  );
  assertEquals(result.length, 0);
});

Deno.test(
  "resolveProfileChain: readFile failure emits MSL-L102 warning, identity-only",
  async () => {
    const chain = {
      tiers: [mkTier("@markspec/default", "0.5.3", { kind: "builtin" })],
      effective: {} as never,
    } as unknown as ProfileChain;
    const readFile = () => Promise.resolve({ error: "ENOENT" });
    const result = await resolveProfileChain(chain, readFile);
    assertEquals(result.length, 1);
    assertEquals(
      result[0].diagnostics.some((d) => d.code === "MSL-L102"),
      true,
    );
  },
);

// ---------------------------------------------------------------------------
// resolveRegistries tests (Task 16)
// ---------------------------------------------------------------------------

Deno.test(
  "resolveRegistries: each parent URL becomes a registry upstream when manifest fetch succeeds",
  async () => {
    const config = {
      name: "p",
      version: "0",
      labels: [],
      parents: ["https://reg.example/"],
      parentFallback: "",
      captionConventions: {},
    };
    const result = await resolveRegistries(
      config,
      () => Promise.resolve(new TextEncoder().encode('{"markspec-schema":1}')),
    );
    assertEquals(result.length, 1);
    assertEquals(result[0].upstream.api, "https://reg.example/");
    assertEquals(typeof result[0].upstream.resolvedManifestHash, "string");
    assertEquals(result[0].upstream.markspecSchema, 1);
  },
);

Deno.test("resolveRegistries: fetch failure emits MSL-L101", async () => {
  const config = {
    name: "p",
    version: "0",
    labels: [],
    parents: ["https://broken/"],
    parentFallback: "",
    captionConventions: {},
  };
  const result = await resolveRegistries(
    config,
    () => Promise.resolve({ error: "503" }),
  );
  assertEquals(result[0].diagnostics.some((d) => d.code === "MSL-L101"), true);
});

Deno.test(
  "resolveRegistries: parentFallback is included when not already in parents",
  async () => {
    const config = {
      name: "p",
      version: "0",
      labels: [],
      parents: ["https://a/"],
      parentFallback: "https://b/",
      captionConventions: {},
    };
    const result = await resolveRegistries(
      config,
      () => Promise.resolve(new TextEncoder().encode("{}")),
    );
    assertEquals(result.length, 2);
  },
);

// ---------------------------------------------------------------------------
// resolveBoundEntries tests (Task 17)
// ---------------------------------------------------------------------------

/**
 * Build a minimal Authored entry with External-id bindings. Populates
 * `rawAttributes` because the implementation reads from it; the typed
 * map is left empty (the resolver doesn't consult it).
 */
function mkBoundEntry(displayId: string, externalIds: string[]): Entry {
  return {
    displayId: makeDisplayId(displayId),
    title: displayId,
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Title", value: "Brake pedal sensor debounce" },
      ...externalIds.map((eid) => ({ key: "External-id", value: eid })),
    ],
    typedAttributes: new Map() as never,
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    location: { file: "reqs.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  };
}

const JIRA_MAPPING_YAML = `
schema: 1
system: jira
direction: inbound
identity:
  external-id-scheme: jira
attributes:
  - markspec: Title
    external: summary
cache:
  ttl: 15m
`;

Deno.test(
  "resolveBoundEntries: entry with External-id produces bound entry + locked attrs",
  async () => {
    const mapping = parseMapping(JIRA_MAPPING_YAML, "jira.yaml").mapping!;
    const e = mkBoundEntry("REQ-107", ["jira:PROJ-1423"]);
    const result = await resolveBoundEntries([e], [mapping]);
    assertEquals(result.length, 1);
    assertEquals(result[0].boundEntry.bindings.length, 1);
    const b = result[0].boundEntry.bindings[0];
    assertEquals(b.externalId, "jira:PROJ-1423");
    assertEquals(b.system, "jira");
    assertEquals(b.lockedAttributes.has("Title"), true);
  },
);

Deno.test(
  "resolveBoundEntries: External-id with no matching mapping → MSL-S021",
  async () => {
    const e = mkBoundEntry("REQ-203", ["foo:1234"]);
    const result = await resolveBoundEntries([e], []);
    assertEquals(result.length, 1);
    assertEquals(result[0].diagnostics[0].code, "MSL-S021");
  },
);

Deno.test("resolveBoundEntries: entry without External-id is skipped", async () => {
  const e = mkBoundEntry("REQ-100", []);
  const result = await resolveBoundEntries([e], []);
  assertEquals(result.length, 0);
});

Deno.test(
  "resolveBoundEntries: locked-attribute hash is sha256 of the entry value bytes",
  async () => {
    const mapping = parseMapping(JIRA_MAPPING_YAML, "jira.yaml").mapping!;
    const e = mkBoundEntry("REQ-200", ["jira:PROJ-9000"]);
    const result = await resolveBoundEntries([e], [mapping]);
    const titleHash = result[0].boundEntry.bindings[0].lockedAttributes.get(
      "Title",
    );
    // Hash of the entry's Title attribute value "Brake pedal sensor debounce".
    // Compute via the sibling sha256 helper for the exact expected digest.
    const { sha256String } = await import("./hash.ts");
    const expected = await sha256String("Brake pedal sensor debounce");
    assertEquals(titleHash, expected);
  },
);

// ---------------------------------------------------------------------------
// resolveUpstreams composition tests (Task 18)
// ---------------------------------------------------------------------------

import { resolveUpstreams } from "./resolve.ts";

Deno.test(
  "resolveUpstreams: composes all sub-resolvers + canonical edge hash",
  async () => {
    const config = {
      name: "p",
      version: "0",
      labels: [],
      parents: [],
      parentFallback: "",
      captionConventions: {},
    };
    const result = await resolveUpstreams({
      entries: [],
      profileChain: [],
      config,
      mappings: [],
      fetchUrl: () => Promise.resolve({ error: "no fetch needed" }),
      readFile: () => Promise.resolve({ error: "no read needed" }),
      now: () => new Date("2026-05-25T12:00:00Z"),
    });
    assertEquals(result.references.length, 0);
    assertEquals(result.profiles.length, 0);
    assertEquals(result.registries.length, 0);
    assertEquals(result.boundEntries.length, 0);
    assertEquals(result.canonicalEdgeCount, 0);
    // hash of empty edge list (canonical JSON "[]" → known SHA-256)
    assertEquals(
      result.canonicalEdgeHash,
      "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    );
    assertEquals(result.lockedAt, "2026-05-25T12:00:00.000Z");
    assertEquals(result.diagnostics.length, 0);
  },
);

Deno.test(
  "resolveUpstreams: extractEdgeQuads pulls trace links from authored attributes",
  async () => {
    const { extractEdgeQuads } = await import("./resolve.ts");
    const entry: Entry = {
      displayId: makeDisplayId("REQ-1"),
      title: "t",
      body: "",
      rawAttributes: [
        { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
        { key: "Satisfies", value: "STK-1, STK-2" },
        { key: "Verified-by", value: "TST-1" },
      ],
      typedAttributes: new Map() as never,
      id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
      shape: "Authored",
      location: { file: "x.md", line: 1, column: 1 },
      source: { kind: "markdown" },
      bodyTokens: [],
    };
    const edges = extractEdgeQuads([entry]);
    assertEquals(edges.length, 3);
    // Each edge is sourced from REQ-1; all are local-provenance.
    assertEquals(
      edges.every(
        (e: { source: string; provenance: string }) => e.source === "REQ-1",
      ),
      true,
    );
    assertEquals(
      edges.every(
        (e: { source: string; provenance: string }) => e.provenance === "local",
      ),
      true,
    );
  },
);
