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
