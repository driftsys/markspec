/**
 * @module core/profile/manifest_test
 *
 * Unit tests for markspec.yaml manifest parsing.
 */

import { assertEquals } from "@std/assert";
import { parseManifest } from "./manifest.ts";

Deno.test("parseManifest: minimal valid manifest", () => {
  const yaml = `
id: "@acme/profile-minimal"
version: 0.1.0
`;
  const result = parseManifest(yaml);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.id, "@acme/profile-minimal");
  assertEquals(result.manifest?.version, "0.1.0");
  assertEquals(result.manifest?.types.size, 0);
  assertEquals(result.manifest?.universalAttributes.length, 0);
});

Deno.test("parseManifest: empty string fails with PROFILE-LOAD-003", () => {
  const result = parseManifest("");
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: scalar root fails with PROFILE-LOAD-003", () => {
  const result = parseManifest(`42`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: missing id and version", () => {
  const result = parseManifest(`description: Nope`);
  assertEquals(result.manifest, null);
  const codes = result.diagnostics.map((d) => d.code);
  assertEquals(codes, ["PROFILE-LOAD-003", "PROFILE-LOAD-003"]);
});

Deno.test("parseManifest: malformed YAML fails with PROFILE-LOAD-002", () => {
  const result = parseManifest(`id: "@acme/x\n  version:`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-002");
});

Deno.test("parseManifest: unknown top-level key errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
bogus: whatever
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
  // message mentions the offending key
  const msg = result.diagnostics[0].message;
  if (!msg.includes("bogus")) {
    throw new Error(`expected 'bogus' in message, got: ${msg}`);
  }
});

Deno.test("parseManifest: profile section accepts only recognized keys", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  required: []
  nonsense: {}
`);
  assertEquals(result.manifest, null);
  const msg = result.diagnostics[0].message;
  if (!msg.includes("nonsense")) {
    throw new Error(`expected 'nonsense' in message, got: ${msg}`);
  }
});

Deno.test("parseManifest: universal attributes + required + labels", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  required: [Status]
  labels: [DRAFT, INTERNAL]
  attributes:
    - name: Status
      type: enum
      values: [draft, approved, deprecated]
      required: false
`);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.universalRequired, ["Status"]);
  assertEquals(result.manifest?.labels, ["DRAFT", "INTERNAL"]);
  assertEquals(result.manifest?.universalAttributes.length, 1);
  const attr = result.manifest?.universalAttributes[0];
  assertEquals(attr?.name, "Status");
  assertEquals(attr?.type, "enum");
  assertEquals(attr?.values, ["draft", "approved", "deprecated"]);
  assertEquals(attr?.required, false);
});

Deno.test("parseManifest: attribute with invalid value type errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  attributes:
    - name: Weird
      type: bogus
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: enum attribute without values errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  attributes:
    - name: Mode
      type: enum
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: shape scopes parsed", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  identified:
    required: [Rationale]
    attributes:
      - name: Rationale
        type: text
  referenced:
    attributes:
      - name: Description
        type: text
`);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.identified.required, ["Rationale"]);
  assertEquals(result.manifest?.identified.attributes.length, 1);
  assertEquals(result.manifest?.identified.attributes[0].name, "Rationale");
  assertEquals(result.manifest?.referenced.attributes.length, 1);
  assertEquals(result.manifest?.referenced.attributes[0].name, "Description");
});

Deno.test("parseManifest: referenced.traceability is not a recognized key", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  referenced:
    traceability:
      Something: {target: []}
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: identified.traceability parsed", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  identified:
    traceability:
      Derived-from:
        target: [{shape: identified}]
        cardinality: 0..N
        required: false
`);
  assertEquals(result.diagnostics.length, 0);
  const trace = result.manifest?.identified.traceability;
  assertEquals(trace?.size, 1);
  const rule = trace?.get("Derived-from");
  assertEquals(rule?.target.length, 1);
  assertEquals(rule?.target[0], { shape: "identified" });
  assertEquals(rule?.required, false);
  assertEquals(rule?.cardinality?.lower, 0);
  assertEquals(rule?.cardinality?.upper, Infinity);
});

Deno.test("parseManifest: traceability rejects bad shape matcher", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  identified:
    traceability:
      Bad:
        target: [{shape: nonsense}]
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: traceability target is required", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  identified:
    traceability:
      MissingTarget:
        required: true
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: types map parsed", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    requirement:
      shape: identified
      display-id-pattern: "REQ-{n:04d}"
      display-id-pattern-enforcement: error
      required: [Rationale]
      attributes:
        - name: Rationale
          type: text
      traceability:
        Derived-from:
          target: [stakeholder-requirement]
          cardinality: 1..N
          required: true
    standard:
      shape: referenced
`);
  assertEquals(result.diagnostics.length, 0);
  const types = result.manifest?.types;
  assertEquals(types?.size, 2);
  const req = types?.get("requirement");
  assertEquals(req?.shape, "identified");
  assertEquals(req?.displayIdPattern, "REQ-{n:04d}");
  assertEquals(req?.displayIdPatternEnforcement, "error");
  assertEquals(req?.required, ["Rationale"]);
  assertEquals(req?.attributes[0].name, "Rationale");
  const trace = req?.traceability.get("Derived-from");
  assertEquals(trace?.target, ["stakeholder-requirement"]);
  const std = types?.get("standard");
  assertEquals(std?.shape, "referenced");
  assertEquals(std?.displayIdPatternEnforcement, "off");
});

Deno.test("parseManifest: type must declare shape", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    requirement:
      attributes: []
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: type with bad shape errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    thing:
      shape: sideways
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: referenced type with traceability errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    standard:
      shape: referenced
      traceability:
        Something:
          target: [other]
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: documents section parsed", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  documents:
    types:
      - id: requirements-doc
        contains: [requirement]
        description: Requirements specifications
    frontMatter:
      - name: document-version
        type: text
`);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.documents.types.length, 1);
  assertEquals(result.manifest?.documents.types[0].id, "requirements-doc");
  assertEquals(result.manifest?.documents.types[0].contains, ["requirement"]);
  assertEquals(result.manifest?.documents.frontMatter.length, 1);
  assertEquals(
    result.manifest?.documents.frontMatter[0].name,
    "document-version",
  );
});

Deno.test("parseManifest: document type missing id errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  documents:
    types:
      - contains: [requirement]
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: extends local path", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
extends: "./base"
`);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.extends, { kind: "local", path: "./base" });
});

Deno.test("parseManifest: extends git specifier", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
extends: "git+https://github.com/acme/repo.git/aspice#aspice/v1.0.0"
`);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.extends, {
    kind: "git",
    repo: "https://github.com/acme/repo.git",
    subpath: "aspice",
    tag: "aspice/v1.0.0",
  });
});

Deno.test("parseManifest: extends git without tag errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
extends: "git+https://github.com/acme/repo.git"
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: extends unrecognized scheme errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
extends: "npm:@acme/profile@1.0"
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});
