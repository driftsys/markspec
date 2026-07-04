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

// A references document (basename `references.md`) with a slug display ID
// and no `Id:` trailer produces a Reference-shaped entry whose `id` is an
// own key with value `undefined` — the field-presence case that
// `JSON.stringify` would otherwise erase from the wire form.
const REFERENCE_FIXTURE = `# References

- [iso-26262] ISO 26262 Road vehicles — Functional safety

  Part 6: product development at the software level.
`;

Deno.test("deserializeEntry: round-trip preserves a Reference-shaped entry", async () => {
  const { entries } = await parseFile(REFERENCE_FIXTURE, {
    file: "/proj/references.md",
  });
  assertEquals(entries.length, 1);
  assertEquals(entries[0].shape, "Reference");
  const wire = JSON.parse(JSON.stringify(serializeEntry(entries[0])));
  assertEquals(deserializeEntry(wire), entries[0]);
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
