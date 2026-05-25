// packages/markspec/core/lock/parser_test.ts
import { assertEquals, assertExists } from "@std/assert";
import { parseLockfile } from "./parser.ts";

Deno.test("parseLockfile: round-trips empty lockfile", () => {
  const toml = `
schema = 1

[meta]
markspec-schema = 1
locked-at = "2026-05-25T12:00:00Z"

[generated-cache]
edges-hash = "sha256:e3b0"
edges-count = 0
`;
  const result = parseLockfile(toml);
  assertEquals(result.diagnostics.length, 0);
  assertExists(result.lockfile);
  assertEquals(result.lockfile.schema, 1);
  assertEquals(result.lockfile.meta.lockedAt, "2026-05-25T12:00:00Z");
});

Deno.test("parseLockfile: malformed TOML → MSL-L001", () => {
  const result = parseLockfile("this is not [[[ valid toml");
  assertEquals(result.lockfile, undefined);
  assertEquals(result.diagnostics[0].code, "MSL-L001");
});

Deno.test("parseLockfile: schema > supported → MSL-L002", () => {
  const toml =
    `schema = 99\n\n[meta]\nmarkspec-schema = 1\nlocked-at = "2026-05-25T12:00:00Z"\n\n[generated-cache]\nedges-hash = "sha256:0"\nedges-count = 0\n`;
  const result = parseLockfile(toml);
  assertEquals(result.lockfile, undefined);
  assertEquals(result.diagnostics[0].code, "MSL-L002");
});

Deno.test("parseLockfile: parses References array sorted", () => {
  const toml = `
schema = 1
[meta]
markspec-schema = 1
locked-at = "2026-05-25T12:00:00Z"

[[upstream.reference]]
slug = "ISO-26262-6"
id = "urn:iso:std:iso:26262:-6:ed-2"
resolved = "ed-2"
hash = "sha256:abc"
source = "https://www.iso.org/standard/68383.html"

[generated-cache]
edges-hash = "sha256:0"
edges-count = 0
`;
  const result = parseLockfile(toml);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.lockfile!.upstreams.length, 1);
  const ref = result.lockfile!.upstreams[0];
  assertEquals(ref.kind, "reference");
  if (ref.kind === "reference") {
    assertEquals(ref.slug, "ISO-26262-6");
    assertEquals(ref.hash, "sha256:abc");
  }
});

Deno.test("parseLockfile: [[upstream.profile]] missing 'specifier' → MSL-L001", () => {
  const toml = `
schema = 1
[meta]
markspec-schema = 1
locked-at = "2026-05-25T12:00:00Z"

[[upstream.profile]]
id = "@org/aspice"
# specifier missing
resolved = "1.2.4"
hash = "sha256:def"

[generated-cache]
edges-hash = "sha256:0"
edges-count = 0
`;
  const r = parseLockfile(toml);
  assertEquals(r.lockfile, undefined);
  assertEquals(r.diagnostics[0].code, "MSL-L001");
});

Deno.test("parseLockfile: [[bound-entry.binding]] bad direction → MSL-L001", () => {
  const toml = `
schema = 1
[meta]
markspec-schema = 1
locked-at = "2026-05-25T12:00:00Z"

[[bound-entry]]
display-id = "REQ-1"
ulid = "01HGW2Q8MNP3RSTVWXYZABCDEF"

[[bound-entry.binding]]
external-id = "jira:PROJ-1"
system = "jira"
direction = "sideways"

[generated-cache]
edges-hash = "sha256:0"
edges-count = 0
`;
  const r = parseLockfile(toml);
  assertEquals(r.lockfile, undefined);
  assertEquals(r.diagnostics[0].code, "MSL-L001");
});

Deno.test("parseLockfile: missing [generated-cache] → MSL-L001", () => {
  const toml = `
schema = 1
[meta]
markspec-schema = 1
locked-at = "2026-05-25T12:00:00Z"
`;
  const r = parseLockfile(toml);
  assertEquals(r.lockfile, undefined);
  assertEquals(r.diagnostics[0].code, "MSL-L001");
});
