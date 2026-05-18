/**
 * @module core/profile/introspect_test
 */
import { assertEquals, assertExists } from "@std/assert";
import { mergeChain } from "./merge.ts";
import { parseManifest } from "./manifest.ts";
import { buildProfileIntrospection } from "./introspect.ts";
import type { LoadedProfile, ProfileChain } from "../model/mod.ts";

function makeLoaded(yaml: string): LoadedProfile {
  const result = parseManifest(yaml, "<test>");
  if (!result.manifest) throw new Error("parse failed");
  return {
    id: result.manifest.id,
    version: result.manifest.version,
    specifier: { kind: "local", path: "./test" },
    manifest: result.manifest,
    sourcePath: "<test>",
    baseDir: "/tmp",
  };
}

function makeChain(...yamls: string[]): ProfileChain {
  const tiers = yamls.map(makeLoaded);
  // deno-lint-ignore no-explicit-any
  const merge = mergeChain({ tiers, effective: null as any });
  if (!merge.effective) {
    throw new Error(
      `mergeChain failed: ${JSON.stringify(merge.diagnostics)}`,
    );
  }
  return { tiers, effective: merge.effective };
}

Deno.test(
  "buildProfileIntrospection: null chain → empty overview with sentinel tier",
  () => {
    const intro = buildProfileIntrospection(null);
    const overview = intro.overview();
    assertEquals(overview.tiers.length, 1);
    assertEquals(overview.tiers[0].id, "(none)");
    assertEquals(overview.elements.length, 0);
  },
);

Deno.test(
  "buildProfileIntrospection: single-tier types + attrs appear in overview",
  () => {
    const chain = makeChain(`
id: "@test/p"
version: 1.0.0
markspec-schema: "1"
profile:
  attributes:
    - name: Safety-Class
      type: enum
      values: [ASIL-A, QM]
      description: ISO 26262 level
  types:
    software-requirement:
      extends: Requirement
      description: Software-level requirement
      traceability:
        Satisfies:
          target: [{shape: identified}]
          description: Traces to higher-level
`);
    const intro = buildProfileIntrospection(chain);
    const overview = intro.overview();
    assertEquals(overview.tiers.length, 1);

    const typeRef = overview.elements.find(
      (e) => e.kind === "type" && e.name === "software-requirement",
    );
    assertExists(typeRef);
    assertEquals(typeRef.summary, "Software-level requirement");
    assertEquals(typeRef.ref, "type/software-requirement");

    const attrRef = overview.elements.find(
      (e) => e.kind === "attribute" && e.name === "Safety-Class",
    );
    assertExists(attrRef);
    assertEquals(attrRef.summary, "ISO 26262 level");

    const relRef = overview.elements.find(
      (e) => e.kind === "relation" && e.name === "Satisfies",
    );
    assertExists(relRef);
    assertEquals(relRef.summary, "Traces to higher-level");
  },
);

Deno.test(
  "buildProfileIntrospection: label concern + convention appear in overview",
  () => {
    const chain = makeChain(`
id: "@test/p"
version: 1.0.0
markspec-schema: "1"
profile:
  labels:
    asil:
      kind: enum
      description: Safety integrity level
      values:
        ASIL-A: {}
        QM: {}
  conventions:
    modal-keywords:
      casing: iso
      description: ISO verbal forms
`);
    const intro = buildProfileIntrospection(chain);
    const overview = intro.overview();

    const labelRef = overview.elements.find(
      (e) => e.kind === "label-concern" && e.name === "asil",
    );
    assertExists(labelRef);
    assertEquals(labelRef.summary, "Safety integrity level");

    const convRef = overview.elements.find(
      (e) => e.kind === "convention" && e.name === "modal-keywords",
    );
    assertExists(convRef);
    assertEquals(convRef.summary, "ISO verbal forms");
  },
);

Deno.test(
  "buildProfileIntrospection: describe type returns TypeDetail",
  () => {
    const chain = makeChain(`
id: "@test/p"
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    software-requirement:
      extends: Requirement
      description: A software req
      display-id-pattern: "SRS_{n:04d}"
      traceability:
        Satisfies:
          target: [{shape: identified}]
`);
    const intro = buildProfileIntrospection(chain);
    const detail = intro.describe("type", "software-requirement");
    assertExists(detail);
    assertEquals(detail.kind, "type");
    assertEquals(detail.name, "software-requirement");
    assertEquals(detail.description.text, "A software req");
    assertEquals(detail.description.origin, "@test/p");
  },
);

Deno.test(
  "buildProfileIntrospection: describe returns undefined for unknown name",
  () => {
    const chain = makeChain(`
id: "@test/p"
version: 1.0.0
markspec-schema: "1"
`);
    const intro = buildProfileIntrospection(chain);
    assertEquals(intro.describe("type", "nonexistent"), undefined);
  },
);

Deno.test(
  "buildProfileIntrospection: two-tier — child description overrides parent, provenance recorded",
  () => {
    const chain = makeChain(
      `
id: "@test/parent"
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    software-requirement:
      extends: Requirement
      description: Parent description
`,
      `
id: "@test/child"
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    software-requirement:
      extends: Requirement
      description: Child description
`,
    );
    const intro = buildProfileIntrospection(chain);
    const detail = intro.describe("type", "software-requirement");
    assertExists(detail);
    assertEquals(detail.description.text, "Child description");
    assertEquals(detail.description.origin, "@test/child");
  },
);

Deno.test("buildProfileIntrospection: resolve returns matching refs", () => {
  const chain = makeChain(`
id: "@test/p"
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    software-requirement:
      extends: Requirement
      description: A software requirement type
`);
  const intro = buildProfileIntrospection(chain);
  const refs = intro.resolve("software");
  assertEquals(refs.length >= 1, true);
  assertEquals(refs.some((r) => r.name === "software-requirement"), true);
});

Deno.test(
  "buildProfileIntrospection: resolve returns empty for no match",
  () => {
    const chain = makeChain(`
id: "@test/p"
version: 1.0.0
markspec-schema: "1"
`);
    const intro = buildProfileIntrospection(chain);
    const refs = intro.resolve("impossible xyz token");
    assertEquals(refs.length, 0);
  },
);
