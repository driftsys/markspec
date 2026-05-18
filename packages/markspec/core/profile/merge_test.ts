/**
 * @module core/profile/merge_test
 *
 * Unit tests for profile chain merging.
 */

import { assertEquals } from "@std/assert";
import { mergeChain } from "./merge.ts";
import { parseManifest } from "./manifest.ts";
import type { LoadedProfile, ProfileChain } from "../model/mod.ts";

/**
 * Build a one-tier chain from inline YAML for tests. Parsing must succeed.
 */
function singleTierChain(yaml: string): ProfileChain {
  const parsed = parseManifest(yaml);
  if (!parsed.manifest) {
    throw new Error(
      "parseManifest failed in test fixture: " +
        parsed.diagnostics.map((d) => d.message).join("; "),
    );
  }
  const tier: LoadedProfile = {
    id: parsed.manifest.id,
    version: parsed.manifest.version,
    specifier: { kind: "local", path: "./fixture" },
    manifest: parsed.manifest,
    sourcePath: "/fixture/markspec.yaml",
    baseDir: "/fixture",
  };
  // Placeholder effective — mergeChain rebuilds it.
  return {
    tiers: [tier],
    effective: {
      attributes: new Map(),
      labels: { value: [], origin: tier.id },
      colors: new Map(),
      types: new Map(),
      documents: { types: new Map(), frontMatter: new Map() },
    },
  };
}

Deno.test("mergeChain: single-tier empty profile produces empty effective profile", () => {
  const chain = singleTierChain(
    `id: "@acme/single"\nversion: 1.0.0\n`,
  );
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const eff = result.effective!;
  assertEquals(eff.labels.value, []);
  assertEquals(eff.attributes.size, 0);
  assertEquals(eff.types.size, 0);
  assertEquals(eff.documents.types.size, 0);
  assertEquals(eff.documents.frontMatter.size, 0);
});

Deno.test("mergeChain: single-tier with universal attribute", () => {
  const chain = singleTierChain(`
id: "@acme/single"
version: 1.0.0
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
`);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const eff = result.effective!;
  assertEquals(eff.attributes.size, 1);
  const statusEntry = eff.attributes.get("Status")!;
  assertEquals(statusEntry.origin, "@acme/single");
  assertEquals(statusEntry.value.name, "Status");
  assertEquals(statusEntry.value.type, "enum");
});

Deno.test("mergeChain: single-tier with a type definition", () => {
  const chain = singleTierChain(`
id: "@acme/single"
version: 1.0.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: warn
      required: [Rationale]
      attributes:
        - name: Rationale
          type: text
`);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const req = result.effective!.types.get("requirement")!;
  assertEquals(req.origin, "@acme/single");
  assertEquals(req.value.extends, "Requirement");
  assertEquals(req.value.displayIdPattern.value, "REQ-{n:04d}");
  assertEquals(req.value.displayIdPattern.origin, "@acme/single");
  assertEquals(req.value.displayIdPatternEnforcement.value, "warn");
  assertEquals(req.value.required.value, ["Rationale"]);
  assertEquals(req.value.attributes.size, 1);
  assertEquals(req.value.attributes.get("Rationale")?.origin, "@acme/single");
});

/**
 * Build a multi-tier chain from an ordered list of YAMLs (root → leaf).
 */
function multiTierChain(yamls: readonly string[]): ProfileChain {
  const tiers: LoadedProfile[] = yamls.map((yaml, i) => {
    const parsed = parseManifest(yaml);
    if (!parsed.manifest) {
      throw new Error(
        `tier ${i} parse failed: ${
          parsed.diagnostics.map((d) => d.message).join("; ")
        }`,
      );
    }
    return {
      id: parsed.manifest.id,
      version: parsed.manifest.version,
      specifier: { kind: "local", path: `./t${i}` },
      manifest: parsed.manifest,
      sourcePath: `/fixture/t${i}/markspec.yaml`,
      baseDir: `/fixture/t${i}`,
    };
  });
  // Stub effective — mergeChain rebuilds it.
  return {
    tiers,
    effective: {
      attributes: new Map(),
      labels: { value: [], origin: tiers[0].id },
      colors: new Map(),
      types: new Map(),
      documents: { types: new Map(), frontMatter: new Map() },
    },
  };
}

Deno.test("mergeChain: additive — child adds universal attribute parent didn't have", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Owner
      type: text
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const eff = result.effective!;
  assertEquals(eff.attributes.size, 2);
  assertEquals(eff.attributes.get("Status")?.origin, "@acme/parent");
  assertEquals(eff.attributes.get("Owner")?.origin, "@acme/child");
});

Deno.test("mergeChain: additive — labels are union, deduplicated", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  labels: [DRAFT, INTERNAL]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  labels: [INTERNAL, PUBLIC]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  // Union without duplicates, parent entries first.
  assertEquals(result.effective!.labels.value, ["DRAFT", "INTERNAL", "PUBLIC"]);
});

Deno.test("mergeChain: additive — child adds a new type", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      extends: Requirement
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    test:
      extends: Requirement
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const types = result.effective!.types;
  assertEquals(types.size, 2);
  assertEquals(types.get("requirement")?.origin, "@acme/parent");
  assertEquals(types.get("test")?.origin, "@acme/child");
});

Deno.test("mergeChain: additive — child adds attribute to an existing type", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      extends: Requirement
      attributes:
        - name: Rationale
          type: text
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      extends: Requirement
      attributes:
        - name: Owner
          type: text
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const req = result.effective!.types.get("requirement")!.value;
  assertEquals(req.attributes.size, 2);
  assertEquals(req.attributes.get("Rationale")?.origin, "@acme/parent");
  assertEquals(req.attributes.get("Owner")?.origin, "@acme/child");
});

Deno.test("mergeChain: additive — child adds traceability rule to existing type", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      extends: Requirement
      traceability:
        Derived-from:
          target: [{shape: identified}]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      extends: Requirement
      traceability:
        Allocates-to:
          target: [{shape: identified}]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const req = result.effective!.types.get("requirement")!.value;
  assertEquals(req.traceability.size, 2);
  assertEquals(req.traceability.get("Derived-from")?.origin, "@acme/parent");
  assertEquals(req.traceability.get("Allocates-to")?.origin, "@acme/child");
});

Deno.test("mergeChain: tighten — child narrows cardinality 0..N → 1..N", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Tags
      type: tag-list
      cardinality: 0..N
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Tags
      type: tag-list
      cardinality: 1..N
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const tags = result.effective!.attributes.get("Tags")!;
  assertEquals(tags.value.cardinality, { lower: 1, upper: Infinity });
  assertEquals(tags.origin, "@acme/child");
});

Deno.test("mergeChain: relax — child widens cardinality emits PROFILE-MERGE-010", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Tags
      type: tag-list
      cardinality: 1..N
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Tags
      type: tag-list
      cardinality: 0..N
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-010");
  const msg = result.diagnostics[0].message;
  if (!msg.includes("Tags") || !msg.includes("cardinality")) {
    throw new Error(`diagnostic message missing context: ${msg}`);
  }
});

Deno.test("mergeChain: tighten — child narrows enum values", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved, deprecated, withdrawn]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const status = result.effective!.attributes.get("Status")!;
  assertEquals(status.value.values, ["draft", "approved"]);
});

Deno.test("mergeChain: relax — child adds enum value not in parent emits PROFILE-MERGE-010", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Status
      type: enum
      values: [draft, approved, new-value]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-010");
});

Deno.test("mergeChain: tighten — child sets required:true", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Rationale
      type: text
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Rationale
      type: text
      required: true
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const rationale = result.effective!.attributes.get("Rationale")!;
  assertEquals(rationale.value.required, true);
});

Deno.test("mergeChain: relax — child sets required:false when parent had true emits PROFILE-MERGE-010", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Rationale
      type: text
      required: true
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Rationale
      type: text
      required: false
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-010");
});

Deno.test("mergeChain: type mismatch — child changes attr type emits PROFILE-MERGE-011", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Count
      type: integer
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Count
      type: text
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-011");
});

Deno.test("mergeChain: type extends mismatch across tiers emits PROFILE-MERGE-012", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    thing:
      extends: Requirement
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    thing:
      extends: Test
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-012");
  const msg = result.diagnostics[0].message;
  if (!msg.includes("extends")) {
    throw new Error(`expected 'extends' in message, got: ${msg}`);
  }
});

Deno.test("mergeChain: display-id-pattern differs between tiers emits PROFILE-MERGE-010", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:06d}"
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-010");
  const msg = result.diagnostics[0].message;
  if (!msg.includes("display-id-pattern")) {
    throw new Error(`expected 'display-id-pattern' in message, got: ${msg}`);
  }
});

Deno.test("mergeChain: child may set display-id-pattern when parent had none", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      extends: Requirement
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const req = result.effective!.types.get("requirement")!.value;
  assertEquals(req.displayIdPattern.value, "REQ-{n:04d}");
  assertEquals(req.displayIdPattern.origin, "@acme/child");
});

Deno.test("mergeChain: enforcement tightens off → warn → error", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: warn
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: error
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const req = result.effective!.types.get("requirement")!.value;
  assertEquals(req.displayIdPatternEnforcement.value, "error");
});

Deno.test("mergeChain: enforcement loosening error → warn emits PROFILE-MERGE-010", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: error
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: warn
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-010");
});

Deno.test("mergeChain: traceability target narrows valid subset", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      extends: Requirement
      traceability:
        Derived-from:
          target: [stakeholder-req, system-req]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      extends: Requirement
      traceability:
        Derived-from:
          target: [stakeholder-req]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const trace = result.effective!.types.get("requirement")!.value
    .traceability.get("Derived-from")!;
  assertEquals(trace.value.target, ["stakeholder-req"]);
  assertEquals(trace.origin, "@acme/child");
});

Deno.test("mergeChain: traceability target adds type not in parent emits PROFILE-MERGE-002", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      extends: Requirement
      traceability:
        Derived-from:
          target: [stakeholder-req]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      extends: Requirement
      traceability:
        Derived-from:
          target: [stakeholder-req, system-req]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-002");
});

Deno.test("mergeChain: traceability cardinality tightens like attribute cardinality", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      extends: Requirement
      traceability:
        Derived-from:
          target: [stakeholder-req]
          cardinality: 0..N
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      extends: Requirement
      traceability:
        Derived-from:
          target: [stakeholder-req]
          cardinality: 1..N
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const trace = result.effective!.types.get("requirement")!.value
    .traceability.get("Derived-from")!;
  assertEquals(trace.value.cardinality, { lower: 1, upper: Infinity });
});

// ---------------------------------------------------------------------------
// Profile colors — map merge + per-type color reference validation
// ---------------------------------------------------------------------------

Deno.test("mergeChain: colors map is unioned across tiers, child overrides parent", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  colors:
    primary: blue
    accent: red
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  colors:
    accent: purple
    muted: grey
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const colors = result.effective!.colors;
  assertEquals(colors.get("primary")?.value, "blue");
  assertEquals(colors.get("primary")?.origin, "@acme/parent");
  assertEquals(colors.get("accent")?.value, "purple"); // child wins
  assertEquals(colors.get("accent")?.origin, "@acme/child");
  assertEquals(colors.get("accent")?.overrides, ["@acme/parent"]);
  assertEquals(colors.get("muted")?.value, "grey");
  assertEquals(colors.get("muted")?.origin, "@acme/child");
});

Deno.test("mergeChain: single-tier — type with declared color resolves cleanly", () => {
  const chain = singleTierChain(`
id: "@acme/single"
version: 1.0.0
profile:
  colors:
    primary: blue
  types:
    requirement:
      extends: Requirement
      color: primary
`);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const t = result.effective!.types.get("requirement")!;
  assertEquals(t.value.color.value, "primary");
  assertEquals(t.value.color.origin, "@acme/single");
});

Deno.test("mergeChain: type with unknown color emits MSL-PROFILE-COLOR-003", () => {
  const chain = singleTierChain(`
id: "@acme/leaf"
version: 1.0.0
profile:
  colors:
    primary: blue
  types:
    requirement:
      extends: Requirement
      color: missing
`);
  const result = mergeChain(chain);
  const err = result.diagnostics.find(
    (d) => d.code === "MSL-PROFILE-COLOR-003",
  );
  assertEquals(err?.severity, "error");
  // Effective is null because the diagnostic is an error.
  assertEquals(result.effective, null);
});

Deno.test("mergeChain: child type may reference a color declared in parent's colors map", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  colors:
    primary: blue
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      extends: Requirement
      color: primary
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const t = result.effective!.types.get("requirement")!;
  assertEquals(t.value.color.value, "primary");
  assertEquals(t.value.color.origin, "@acme/child");
});

Deno.test("mergeChain: parent type may reference a color declared by a child tier", () => {
  // Regression test: validation must run after the full chain folds, otherwise
  // a parent that defines a type with color: name where the child supplies
  // name in its colors: map fails spuriously with MSL-PROFILE-COLOR-003.
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      extends: Requirement
      color: primary
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  colors:
    primary: blue
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const t = result.effective!.types.get("requirement")!;
  assertEquals(t.value.color.value, "primary");
  assertEquals(result.effective!.colors.get("primary")?.value, "blue");
});

Deno.test("mergeChain: child overrides parent's type color, only the latest is validated", () => {
  // Parent declares the color "old" but does not bind it; child redefines the
  // type with a valid "new" color and that's what's validated.
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  colors:
    new: blue
  types:
    requirement:
      extends: Requirement
      color: new
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      extends: Requirement
      color: new
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const t = result.effective!.types.get("requirement")!;
  assertEquals(t.value.color.value, "new");
  assertEquals(t.value.color.origin, "@acme/child");
});

// ─── Tier 2: MERGE code reclassification ─────────────────────────────────────

Deno.test("mergeChain (Tier 2): cardinality relaxation emits PROFILE-MERGE-010", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Status
      type: enum
      required: true
      cardinality: "1..1"
      values: [Open, Closed]
  types:
    req:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Status
      type: enum
      cardinality: "0..1"
      values: [Open]
  types:
    req:
      extends: Requirement
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-010");
});

Deno.test("mergeChain (Tier 2): attribute type mismatch emits PROFILE-MERGE-011", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  attributes:
    - name: Ref
      type: id
  types:
    req:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  attributes:
    - name: Ref
      type: text
  types:
    req:
      extends: Requirement
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-011");
});

Deno.test("mergeChain (Tier 2): conflicting extends: targets emits PROFILE-MERGE-012", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    req:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    req:
      extends: Test
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-012");
});
