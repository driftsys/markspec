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

// ---------------------------------------------------------------------------
// meta.toolchain (slice B — see spec 2026-05-27-markspec-lock-toolchain-minversion)
// ---------------------------------------------------------------------------

Deno.test("parseLockfile: [meta.toolchain] with min-version parses", () => {
  const toml = `schema = 1

[meta]
markspec-schema = 1
locked-at = "2026-05-27T12:00:00Z"

[meta.toolchain]
min-version = "0.6"

[generated-cache]
edges-hash = "sha256:abc"
edges-count = 0
`;
  const { lockfile, diagnostics } = parseLockfile(toml);
  assertEquals(diagnostics.length, 0);
  assertEquals(lockfile?.meta.toolchain, { minVersion: "0.6" });
});

Deno.test("parseLockfile: no [meta.toolchain] section → toolchain undefined", () => {
  const toml = `schema = 1

[meta]
markspec-schema = 1
locked-at = "2026-05-27T12:00:00Z"

[generated-cache]
edges-hash = "sha256:abc"
edges-count = 0
`;
  const { lockfile, diagnostics } = parseLockfile(toml);
  assertEquals(diagnostics.length, 0);
  assertEquals(lockfile?.meta.toolchain, undefined);
});

Deno.test("parseLockfile: empty [meta.toolchain] section → toolchain undefined", () => {
  const toml = `schema = 1

[meta]
markspec-schema = 1
locked-at = "2026-05-27T12:00:00Z"

[meta.toolchain]

[generated-cache]
edges-hash = "sha256:abc"
edges-count = 0
`;
  const { lockfile, diagnostics } = parseLockfile(toml);
  assertEquals(diagnostics.length, 0);
  assertEquals(lockfile?.meta.toolchain, undefined);
});

Deno.test("parseLockfile: malformed min-version → MSL-L030", () => {
  const cases: readonly string[] = [
    "0.6.1", // three components
    "v0.6", // v prefix
    "0.06", // leading zero
    "0", // single component
    "", // empty
    ">=0.6", // operator embedded
    "0.6.x", // non-numeric
  ];
  for (const bad of cases) {
    const toml = `schema = 1

[meta]
markspec-schema = 1
locked-at = "2026-05-27T12:00:00Z"

[meta.toolchain]
min-version = ${JSON.stringify(bad)}

[generated-cache]
edges-hash = "sha256:abc"
edges-count = 0
`;
    const { lockfile, diagnostics } = parseLockfile(toml);
    assertEquals(
      lockfile,
      undefined,
      `unexpected parse success for ${JSON.stringify(bad)}`,
    );
    assertEquals(
      diagnostics.length,
      1,
      `expected exactly one diagnostic for ${JSON.stringify(bad)}`,
    );
    assertEquals(
      diagnostics[0].code,
      "MSL-L030",
      `wrong code for ${JSON.stringify(bad)}`,
    );
  }
});

Deno.test("parseLockfile: min-version as TOML number → MSL-L031", () => {
  // TOML parses `0.6` (unquoted) as a float, not a string. The parser
  // must reject this with MSL-L031 since min-version must be a string.
  const toml = `schema = 1

[meta]
markspec-schema = 1
locked-at = "2026-05-27T12:00:00Z"

[meta.toolchain]
min-version = 0.6

[generated-cache]
edges-hash = "sha256:abc"
edges-count = 0
`;
  const { lockfile, diagnostics } = parseLockfile(toml);
  assertEquals(lockfile, undefined);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "MSL-L031");
});

Deno.test("parseLockfile: meta.toolchain as scalar → MSL-L032", () => {
  // If the user writes `toolchain = "0.6"` directly under [meta] rather
  // than `[meta.toolchain]` as a table, the value is a string, not a
  // table. The parser must reject with MSL-L032.
  const toml = `schema = 1

[meta]
markspec-schema = 1
locked-at = "2026-05-27T12:00:00Z"
toolchain = "0.6"

[generated-cache]
edges-hash = "sha256:abc"
edges-count = 0
`;
  const { lockfile, diagnostics } = parseLockfile(toml);
  assertEquals(lockfile, undefined);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "MSL-L032");
});
