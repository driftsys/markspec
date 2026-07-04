// packages/markspec/core/lock/schema_test.ts
import { assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { Ajv } from "ajv";
import { serializeLockfile } from "./serializer.ts";
import type { Lockfile } from "./model.ts";

const LOCK_SCHEMA_URL = new URL(
  "../../../../schemas/lock/v1.json",
  import.meta.url,
);

function richLockfile(): Lockfile {
  return {
    schema: 1,
    meta: {
      markspecSchema: 1,
      lockedAt: "2026-05-29T10:00:00Z",
      toolchain: { minVersion: "0.6" },
    },
    upstreams: [
      {
        kind: "reference",
        slug: "ISO-26262-6",
        id: "urn:iso:std:iso:26262:-6:ed-2",
        resolved: "2",
        hash: "sha256:abc123",
        source: "https://example.com/iso-26262-6.pdf",
        componentScheme: "urn",
      },
      {
        kind: "profile",
        id: "aspice",
        specifier: "npm:@driftsys/aspice@^1.0",
        resolved: "1.0.3",
        hash: "sha256:def456",
        extends: "base",
      },
      {
        kind: "registry",
        id: "main",
        api: "https://registry.markspec.dev/api/v1",
        resolvedManifestHash: "sha256:ghi789",
        markspecSchema: 1,
        version: "1.4.0",
        snapshot: "sha256:beef",
        lockedAt: "2026-07-04T12:00:00Z",
      },
      {
        kind: "dependency",
        id: "product",
        url: "https://github.com/acme/aeb-product",
        intent: "auto",
        resolved: "tag:v2.1.0",
        sha: "3cdde94",
        snapshot: "sha256:cafe",
        lockedAt: "2026-07-04T12:00:00Z",
      },
    ],
    boundEntries: [
      {
        displayId: "STK_0001",
        ulid: "01HGW2Q8MNP3RSTVWXYZABCDEF",
        bindings: [
          {
            externalId: "jira:PROJ-42",
            system: "jira",
            direction: "bidirectional",
            lockedAttributes: new Map([
              ["Title", "sha256:title001"],
              ["Status", "sha256:status001"],
            ]),
          },
        ],
      },
    ],
    edges: [
      {
        sourceUlid: "01J0000000000000000000SRC1",
        relation: "Satisfies",
        targetUlid: "01J0000000000000000000TGT1",
        authoredTarget: "SYS_BRK_0042",
      },
    ],
    generatedCache: {
      edgesHash: "sha256:edges001",
      edgesCount: 5,
    },
  };
}

Deno.test("lock schema: $id is the canonical URL", async () => {
  const schema = JSON.parse(await Deno.readTextFile(LOCK_SCHEMA_URL));
  assertEquals(
    schema.$id,
    "https://driftsys.github.io/markspec/schemas/lock/v1.json",
  );
});

Deno.test("lock schema: a serialized lockfile validates", async () => {
  const schema = JSON.parse(await Deno.readTextFile(LOCK_SCHEMA_URL));
  const toml = serializeLockfile(richLockfile());
  const parsed = parseToml(toml);
  const ajv = new Ajv({ strict: false });
  const validate = ajv.compile(schema);
  const ok = validate(parsed);
  assertEquals(ok, true, JSON.stringify(validate.errors, null, 2));
});
