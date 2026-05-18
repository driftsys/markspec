/**
 * @module core/profile/manifest_test
 *
 * Unit tests for markspec.yaml manifest parsing.
 */

import { assertEquals, assertExists } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { parseManifest } from "./manifest.ts";

Deno.test("parseManifest: minimal valid manifest", () => {
  const yaml = `
id: "@acme/profile-minimal"
version: 0.1.0
markspec-schema: "1"
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
  nonsense: {}
`);
  assertEquals(result.manifest, null);
  const msg = result.diagnostics[0].message;
  if (!msg.includes("nonsense")) {
    throw new Error(`expected 'nonsense' in message, got: ${msg}`);
  }
});

Deno.test("parseManifest: universal attributes + labels", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
markspec-schema: "1"
profile:
  labels: [DRAFT, INTERNAL]
  attributes:
    - name: Status
      type: enum
      values: [draft, approved, deprecated]
      required: false
`);
  assertEquals(result.diagnostics.length, 0);
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
markspec-schema: "1"
profile:
  types:
    requirement:
      extends: Requirement
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
      extends: Specification
`);
  assertEquals(result.diagnostics.length, 0);
  const types = result.manifest?.types;
  assertEquals(types?.size, 2);
  const req = types?.get("requirement");
  assertEquals(req?.extends, "Requirement");
  assertEquals(req?.displayIdPattern, "REQ-{n:04d}");
  assertEquals(req?.displayIdPatternEnforcement, "error");
  assertEquals(req?.required, ["Rationale"]);
  assertEquals(req?.attributes[0].name, "Rationale");
  const trace = req?.traceability.get("Derived-from");
  assertEquals(trace?.target, ["stakeholder-requirement"]);
  const std = types?.get("standard");
  assertEquals(std?.extends, "Specification");
  assertEquals(std?.displayIdPatternEnforcement, "off");
});

Deno.test("parseManifest: Specification-extending type with traceability is valid in Tier 2", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    standard:
      extends: Specification
      traceability:
        Something:
          target: [other]
`);
  assertExists(result.manifest);
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
});

Deno.test("parseManifest: documents section parsed", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
markspec-schema: "1"
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
markspec-schema: "1"
extends: "./base"
`);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.extends, { kind: "local", path: "./base" });
});

Deno.test("parseManifest: extends git specifier", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
markspec-schema: "1"
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
extends: "s3://bucket/profile"
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: extends npm scoped specifier parsed", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
markspec-schema: "1"
extends: "npm:@acme/profile@1.0"
`);
  assertEquals(result.diagnostics.length, 0);
  assertExists(result.manifest);
  assertExists(result.manifest.extends);
  assertEquals(result.manifest.extends.kind, "npm");
  if (result.manifest.extends.kind === "npm") {
    assertEquals(result.manifest.extends.scope, "@acme");
    assertEquals(result.manifest.extends.name, "profile");
    assertEquals(result.manifest.extends.range, "1.0");
  }
});

Deno.test("parseManifest: extends npm malformed specifier errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
extends: "npm:@acme/profile"
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: attribute inverse parsed", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    test:
      extends: Requirement
      attributes:
        - name: Verifies
          type: id-list
          inverse:
            name: Verified-by
            category: requirement
`);
  assertEquals(result.diagnostics.length, 0);
  const attr = result.manifest?.types.get("test")?.attributes[0];
  assertEquals(attr?.inverse?.name, "Verified-by");
  assertEquals(attr?.inverse?.category, "requirement");
});

Deno.test("parseManifest: inverse on non-id attribute errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    x:
      extends: Requirement
      attributes:
        - name: Foo
          type: text
          inverse:
            name: Foo-back
            category: bar
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: inverse missing fields errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    x:
      extends: Requirement
      attributes:
        - name: Link
          type: id-list
          inverse:
            name: Back
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: complete fixture parses without diagnostics", async () => {
  const path = fromFileUrl(
    new URL(
      "../../../../tests/fixtures/profiles/phase1/complete.yaml",
      import.meta.url,
    ),
  );
  const yaml = await Deno.readTextFile(path);
  const result = parseManifest(yaml, path);
  assertEquals(result.diagnostics, []);
  const m = result.manifest!;
  assertEquals(m.id, "@acme/profile-complete");
  assertEquals(m.version, "1.2.3");
  assertEquals(m.extends, { kind: "local", path: "./base" });
  assertEquals(m.universalAttributes.length, 1);
  assertEquals(m.types.size, 3);
  assertEquals(m.types.get("test")?.attributes[0].inverse?.name, "Verified-by");
  assertEquals(m.documents.types.length, 2);
  assertEquals(m.documents.frontMatter.length, 1);
});

Deno.test("parseManifest: enum attribute with empty values errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  attributes:
    - name: Mode
      type: enum
      values: []
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: whitespace-only id errors", () => {
  const result = parseManifest(`
id: "   "
version: 1.0.0
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: inverse with empty name errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    x:
      extends: Requirement
      attributes:
        - name: Link
          type: id-list
          inverse:
            name: ""
            category: foo
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: unknown key on attribute errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  attributes:
    - name: X
      type: text
      garbage: yo
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: unknown key on inverse errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    x:
      extends: Requirement
      attributes:
        - name: Link
          type: id-list
          inverse:
            name: Back
            category: foo
            bogus: 1
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: unknown key on trace rule errors", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
profile:
  types:
    req:
      extends: Requirement
      traceability:
        Bad:
          target: [stakeholder-req]
          garbage: 1
`);
  assertEquals(result.manifest, null);
  assertEquals(result.diagnostics[0].code, "PROFILE-LOAD-003");
});

Deno.test("parseManifest: extends git+file:// specifier", () => {
  const result = parseManifest(`
id: "@acme/x"
version: 1.0.0
markspec-schema: "1"
extends: "git+file:///tmp/foo.git#v1.0"
`);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.manifest?.extends, {
    kind: "git",
    repo: "file:///tmp/foo.git",
    subpath: undefined,
    tag: "v1.0",
  });
});

Deno.test("parseManifest: profile.colors maps semantic names to palette hues", () => {
  const yaml = `
id: test
version: 1.0.0
profile:
  colors:
    primary: blue
    accent: red
  attributes: []
  labels: []
  types: {}
  documents: { types: [], frontMatter: [] }
`;
  const result = parseManifest(yaml, "test.yaml");
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
  assertExists(result.manifest);
  assertEquals(result.manifest.colors.get("primary"), "blue");
  assertEquals(result.manifest.colors.get("accent"), "red");
});

Deno.test("parseManifest: unknown palette hue emits MSL-PROFILE-COLOR-002", () => {
  const yaml = `
id: test
version: 1.0.0
profile:
  colors:
    primary: indigo
  attributes: []
  labels: []
  types: {}
  documents: { types: [], frontMatter: [] }
`;
  const result = parseManifest(yaml, "test.yaml");
  const err = result.diagnostics.find((d) =>
    d.code === "MSL-PROFILE-COLOR-002"
  );
  assertExists(err);
  assertEquals(err.severity, "error");
});

Deno.test("parseManifest: invalid semantic name emits MSL-PROFILE-COLOR-004", () => {
  const yaml = `
id: test
version: 1.0.0
profile:
  colors:
    "Primary": blue
  attributes: []
  labels: []
  types: {}
  documents: { types: [], frontMatter: [] }
`;
  const result = parseManifest(yaml, "test.yaml");
  const err = result.diagnostics.find((d) =>
    d.code === "MSL-PROFILE-COLOR-004"
  );
  assertExists(err);
  assertEquals(err.severity, "error");
});

Deno.test("parseManifest: per-type color: is parsed", () => {
  const yaml = `
id: test
version: 1.0.0
profile:
  colors:
    primary: blue
  attributes: []
  labels: []
  types:
    requirement:
      extends: Requirement
      color: primary
  documents: { types: [], frontMatter: [] }
`;
  const result = parseManifest(yaml, "test.yaml");
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error").length,
    0,
  );
  assertExists(result.manifest);
  const reqType = result.manifest.types.get("requirement");
  assertExists(reqType);
  assertEquals(reqType.color, "primary");
});

Deno.test("parseManifest: Specification-extending type with color loads cleanly in Tier 2 (no MSL-PROFILE-COLOR-001)", () => {
  const yaml = `
id: test
version: 1.0.0
profile:
  colors:
    primary: blue
  attributes: []
  labels: []
  types:
    standard:
      extends: Specification
      color: primary
  documents: { types: [], frontMatter: [] }
`;
  const result = parseManifest(yaml, "test.yaml");
  // MSL-PROFILE-COLOR-001 (color on referenced type) was removed in Tier 2.
  const color001 = result.diagnostics.find((d) =>
    d.code === "MSL-PROFILE-COLOR-001"
  );
  assertEquals(color001, undefined);
  assertExists(result.manifest);
});

// ─── Change 1: markspec-schema: field ────────────────────────────────────────

Deno.test("parseManifest: markspec-schema '1' is accepted silently", () => {
  const yaml = `
id: test
version: 1.0.0
markspec-schema: "1"
`;
  const result = parseManifest(yaml);
  assertEquals(result.manifest?.id, "test");
  assertEquals(result.diagnostics.length, 0);
});

Deno.test("parseManifest: absent markspec-schema emits PROFILE-SCHEMA-002 warning", () => {
  const yaml = `
id: test
version: 1.0.0
`;
  const result = parseManifest(yaml);
  assertExists(result.manifest);
  const warn = result.diagnostics.find((d) => d.code === "PROFILE-SCHEMA-002");
  assertExists(warn);
  assertEquals(warn.severity, "warning");
});

Deno.test("parseManifest: unknown markspec-schema emits PROFILE-SCHEMA-001 error", () => {
  const yaml = `
id: test
version: 1.0.0
markspec-schema: "2"
`;
  const result = parseManifest(yaml);
  const err = result.diagnostics.find((d) => d.code === "PROFILE-SCHEMA-001");
  assertExists(err);
  assertEquals(err.severity, "error");
  assertEquals(result.manifest, null);
});

// ─── Change 2: PROFILE-TYPE-005 rename ───────────────────────────────────────

Deno.test("parseManifest: unknown per-type key emits PROFILE-TYPE-005 not PROFILE-LOAD-003", () => {
  const yaml = `
id: test
version: 1.0.0
markspec-schema: "1"
profile:
  attributes: []
  labels: []
  types:
    req:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
      unknown-per-type-key: bad
  documents: { types: [], frontMatter: [] }
`;
  const result = parseManifest(yaml);
  const type005 = result.diagnostics.find((d) => d.code === "PROFILE-TYPE-005");
  assertExists(type005);
  assertEquals(type005.severity, "error");
  const load003 = result.diagnostics.find((d) =>
    d.code === "PROFILE-LOAD-003" && d.message.includes("unknown-per-type-key")
  );
  assertEquals(load003, undefined);
});

// ─── Tier 2: extends: replaces shape:, scope sections removed ────────────────

Deno.test("parseManifest (Tier 2): missing extends: in type emits PROFILE-TYPE-001", () => {
  const yaml = `
id: test
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    req:
      display-id-pattern: "REQ-{n:04d}"
`;
  const result = parseManifest(yaml);
  const d = result.diagnostics.find((d) => d.code === "PROFILE-TYPE-001");
  assertExists(d);
  assertEquals(d.severity, "error");
  assertEquals(result.manifest, null);
});

Deno.test("parseManifest (Tier 2): extends: pointing to unknown core type emits PROFILE-TYPE-002", () => {
  const yaml = `
id: test
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    req:
      extends: NotAType
      display-id-pattern: "REQ-{n:04d}"
`;
  const result = parseManifest(yaml);
  const d = result.diagnostics.find((d) => d.code === "PROFILE-TYPE-002");
  assertExists(d);
  assertEquals(d.severity, "error");
  assertEquals(result.manifest, null);
});

Deno.test("parseManifest (Tier 2): extends: with valid core type is accepted", () => {
  const yaml = `
id: test
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    req:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`;
  const result = parseManifest(yaml);
  assertEquals(result.diagnostics.filter((d) => d.severity === "error"), []);
  assertExists(result.manifest);
  const req = result.manifest!.types.get("req");
  assertExists(req);
  assertEquals(req.extends, "Requirement");
});

Deno.test("parseManifest (Tier 2): identified: at profile root is unknown key", () => {
  const yaml = `
id: test
version: 1.0.0
markspec-schema: "1"
profile:
  identified:
    attributes: []
`;
  const result = parseManifest(yaml);
  const d = result.diagnostics.find(
    (d) => d.code === "PROFILE-LOAD-003" && d.message.includes("'identified'"),
  );
  assertExists(d);
  assertEquals(d.severity, "error");
});

Deno.test("parseManifest (Tier 2): referenced: at profile root is unknown key", () => {
  const yaml = `
id: test
version: 1.0.0
markspec-schema: "1"
profile:
  referenced:
    attributes: []
`;
  const result = parseManifest(yaml);
  const d = result.diagnostics.find(
    (d) => d.code === "PROFILE-LOAD-003" && d.message.includes("'referenced'"),
  );
  assertExists(d);
  assertEquals(d.severity, "error");
});

Deno.test("parseManifest (Tier 2): required: at profile root is unknown key", () => {
  const yaml = `
id: test
version: 1.0.0
markspec-schema: "1"
profile:
  required: [Status]
`;
  const result = parseManifest(yaml);
  const d = result.diagnostics.find(
    (d) => d.code === "PROFILE-LOAD-003" && d.message.includes("'required'"),
  );
  assertExists(d);
  assertEquals(d.severity, "error");
});

Deno.test("parseManifest (Tier 2): shape: in type def is unknown key (PROFILE-TYPE-005)", () => {
  const yaml = `
id: test
version: 1.0.0
markspec-schema: "1"
profile:
  types:
    req:
      extends: Requirement
      shape: Authored
`;
  const result = parseManifest(yaml);
  const d = result.diagnostics.find((d) => d.code === "PROFILE-TYPE-005");
  assertExists(d);
  assertEquals(d.severity, "error");
});
