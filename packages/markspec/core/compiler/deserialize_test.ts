import { assertEquals } from "@std/assert";
import { parseFile } from "../parser/mod.ts";
import { serializeEntry } from "./schema.ts";
import { deserializeEntry } from "./deserialize.ts";

const FIXTURE = `# Sample

- [STK_0001] Braking distance

  The system shall stop the vehicle within 40 m from 100 km/h.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Labels: ASIL-B

- [SYS_0001] Threat assessment

  The system shall compute a threat level within 200 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Satisfies: STK_0001
`;

Deno.test("deserializeEntry: JSON wire round-trip preserves the entry", async () => {
  const { entries } = await parseFile(FIXTURE, { file: "/proj/sample.md" });
  for (const entry of entries) {
    const wire = JSON.parse(JSON.stringify(serializeEntry(entry)));
    assertEquals(deserializeEntry(wire), entry);
  }
});

Deno.test("deserializeEntry: origin passes through verbatim", async () => {
  const { entries } = await parseFile(FIXTURE, { file: "/proj/sample.md" });
  const withOrigin = {
    ...entries[0],
    origin: {
      kind: "upstream" as const,
      upstreamId: "product",
      version: "v1.0.0",
    },
  };
  const wire = JSON.parse(JSON.stringify(serializeEntry(withOrigin)));
  assertEquals(deserializeEntry(wire).origin, withOrigin.origin);
});
