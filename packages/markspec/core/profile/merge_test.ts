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
      required: { value: [], origin: tier.id },
      attributes: new Map(),
      labels: { value: [], origin: tier.id },
      identified: {
        required: { value: [], origin: tier.id },
        attributes: new Map(),
        traceability: new Map(),
      },
      referenced: {
        required: { value: [], origin: tier.id },
        attributes: new Map(),
        traceability: new Map(),
      },
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
  assertEquals(eff.required.value, []);
  assertEquals(eff.required.origin, "@acme/single");
  assertEquals(eff.labels.value, []);
  assertEquals(eff.attributes.size, 0);
  assertEquals(eff.types.size, 0);
  assertEquals(eff.identified.attributes.size, 0);
  assertEquals(eff.identified.traceability.size, 0);
  assertEquals(eff.referenced.attributes.size, 0);
  assertEquals(eff.documents.types.size, 0);
  assertEquals(eff.documents.frontMatter.size, 0);
});

Deno.test("mergeChain: single-tier with universal attribute", () => {
  const chain = singleTierChain(`
id: "@acme/single"
version: 1.0.0
profile:
  required: [Status]
  attributes:
    - name: Status
      type: enum
      values: [draft, approved]
`);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const eff = result.effective!;
  assertEquals(eff.required.value, ["Status"]);
  assertEquals(eff.required.origin, "@acme/single");
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
      shape: identified
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
  assertEquals(req.value.shape, "identified");
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
      required: { value: [], origin: tiers[0].id },
      attributes: new Map(),
      labels: { value: [], origin: tiers[0].id },
      identified: {
        required: { value: [], origin: tiers[0].id },
        attributes: new Map(),
        traceability: new Map(),
      },
      referenced: {
        required: { value: [], origin: tiers[0].id },
        attributes: new Map(),
        traceability: new Map(),
      },
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

Deno.test("mergeChain: additive — required is union", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  required: [Status]
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
  required: [Owner]
  attributes:
    - name: Owner
      type: text
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const eff = result.effective!;
  // Order: parent entries come first, child's additions appended.
  assertEquals(eff.required.value, ["Status", "Owner"]);
  // required.origin points at the leaf child since it last modified the list.
  assertEquals(eff.required.origin, "@acme/child");
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
      shape: identified
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    test:
      shape: identified
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
      shape: identified
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
      shape: identified
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
      shape: identified
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
      shape: identified
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

Deno.test("mergeChain: relax — child widens cardinality emits PROFILE-MERGE-001", () => {
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
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-001");
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

Deno.test("mergeChain: relax — child adds enum value not in parent emits PROFILE-MERGE-001", () => {
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
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-001");
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

Deno.test("mergeChain: relax — child sets required:false when parent had true", () => {
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
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-001");
});

Deno.test("mergeChain: type mismatch — child changes attr type emits PROFILE-MERGE-001", () => {
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
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-001");
});

Deno.test("mergeChain: type shape mismatch across tiers emits PROFILE-MERGE-001", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    thing:
      shape: identified
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    thing:
      shape: referenced
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-001");
  const msg = result.diagnostics[0].message;
  if (!msg.includes("shape")) {
    throw new Error(`expected 'shape' in message, got: ${msg}`);
  }
});

Deno.test("mergeChain: display-id-pattern differs between tiers emits PROFILE-MERGE-001", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:06d}"
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-001");
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
      shape: identified
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    requirement:
      shape: identified
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
      shape: identified
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
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: error
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const req = result.effective!.types.get("requirement")!.value;
  assertEquals(req.displayIdPatternEnforcement.value, "error");
});

Deno.test("mergeChain: enforcement loosening error → warn emits PROFILE-MERGE-001", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
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
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: warn
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-001");
});

Deno.test("mergeChain: traceability target narrows valid subset", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
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
      shape: identified
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
      shape: identified
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
      shape: identified
      traceability:
        Derived-from:
          target: [stakeholder-req, system-req]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.effective, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-MERGE-002");
});

Deno.test("mergeChain: child narrows shape matcher to specific type is allowed", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  identified:
    traceability:
      Derived-from:
        target: [{shape: identified}]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  identified:
    traceability:
      Derived-from:
        target: [stakeholder-req]
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  const trace = result.effective!.identified.traceability
    .get("Derived-from")!;
  assertEquals(trace.value.target, ["stakeholder-req"]);
});

Deno.test("mergeChain: child adds shape matcher not in parent emits PROFILE-MERGE-002", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  identified:
    traceability:
      Derived-from:
        target: [{shape: identified}]
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  identified:
    traceability:
      Derived-from:
        target: [{shape: identified}, {shape: referenced}]
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
      shape: identified
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
      shape: identified
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
