import { assert, assertEquals } from "@std/assert";
import { uxilDeclaringTypes, validateUxilFamily } from "./uxil_family.ts";
import { parseMarkdown } from "../parser/markdown.ts";
import type {
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
  ProvenancedMapEntry,
} from "../model/mod.ts";

function entriesOf(files: Record<string, string>): Entry[] {
  const out: Entry[] = [];
  for (const [file, md] of Object.entries(files)) {
    const { entries } = parseMarkdown(md, { file });
    out.push(...entries);
  }
  return out;
}

function makeProfile(
  types: Record<string, { pattern: string; declares?: string }>,
): EffectiveProfile {
  const origin = "@test/p";
  const map = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const [name, t] of Object.entries(types)) {
    map.set(name, {
      value: {
        name,
        extends: "Requirement",
        displayIdPattern: { value: t.pattern, origin },
        displayIdPatternEnforcement: { value: "off", origin },
        color: { value: undefined, origin },
        required: { value: [], origin },
        attributes: new Map(),
        traceability: new Map(),
        description: { value: undefined, origin },
        attrDescriptions: new Map(),
        relationDescriptions: new Map(),
        discipline: { value: undefined, origin },
        declares: { value: t.declares, origin },
      },
      origin,
    });
  }
  return {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: map,
    documents: { types: new Map(), frontMatter: new Map() },
    delivers: [],
    kinds: new Map(),
    prose: {
      lexicons: {
        "capitalized-allow": { value: [], origin: "" },
        "sentence-abbrev": { value: [], origin: "" },
      },
    },
    disciplineMode: { value: "none", origin: "inferred" },
  };
}

const CONTRACT_BAD_KIND = `- [UXI_0001] Contract

  \`ux:media.home : widget\` — bad kind.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;

const REQ_WITH_ROOT = `- [REQ_0001] Not a contract

  \`ux:rogue.surface : screen\` — declared in the wrong type.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZB
`;

const REQ_WITH_PROSE_BULLETS = `- [REQ_0002] Ordinary prose

  Config files live in bullets:

  - \`.gitignore\` — repository excludes.
  - \`/usr/bin/env\` — a path, not an element.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZC
`;

Deno.test("family: inert when no type declares ux-surface (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}" }, // no declares
  });
  const entries = entriesOf({
    "a.md": CONTRACT_BAD_KIND + "\n" + REQ_WITH_PROSE_BULLETS,
  });
  assertEquals(validateUxilFamily(entries, profile), []);
  assertEquals(validateUxilFamily(entries, null), []);
});

Deno.test("family: declaring entries validate; prose bullets stay opaque (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}", declares: "ux-surface" },
    "requirement": { pattern: "REQ_{n:4d}" },
  });
  const entries = entriesOf({
    "a.md": CONTRACT_BAD_KIND,
    "b.md": REQ_WITH_PROSE_BULLETS,
  });
  const diags = validateUxilFamily(entries, profile);
  assert(diags.some((d) => d.code === "UXIL-009"));
  // The REQ entry's `.gitignore` / path bullets produce nothing.
  assertEquals(diags.some((d) => d.location?.file === "b.md"), false);
});

Deno.test("family: root declaration outside the declaring type is UXIL-023 (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}", declares: "ux-surface" },
    "requirement": { pattern: "REQ_{n:4d}" },
  });
  const diags = validateUxilFamily(
    entriesOf({ "b.md": REQ_WITH_ROOT }),
    profile,
  );
  const d = diags.find((x) => x.code === "UXIL-023");
  assertEquals(d?.location, { file: "b.md", line: 3, column: 3 });
  assert(d?.message.includes("'REQ_0001'"));
  assert(d?.message.includes("'requirement'"));
});

Deno.test("family: citations validate corpus-wide (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}", declares: "ux-surface" },
    "requirement": { pattern: "REQ_{n:4d}" },
  });
  const contract = `- [UXI_0001] Contract

  \`ux:media.home : screen\` offers:

  - \`/play : activate\` — starts playback.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const citing = `- [REQ_0001] Journey step

  Tap \`ux:media.ghost/play!activate\` to start playback.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZB
`;
  const diags = validateUxilFamily(
    entriesOf({ "a.md": contract, "b.md": citing }),
    profile,
  );
  assert(diags.some((d) => d.code === "UXIL-018"));
});

Deno.test("family: upstream entries are uxil-inert (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}", declares: "ux-surface" },
  });
  const [entry] = entriesOf({ "a.md": CONTRACT_BAD_KIND });
  const upstream: Entry = {
    ...entry,
    origin: { kind: "upstream", upstreamId: "acme/reqs", version: "v1.0" },
  };
  assertEquals(validateUxilFamily([upstream], profile), []);
});

Deno.test("family: explicit Type: gates in a non-pattern entry (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}", declares: "ux-surface" },
  });
  const md = `- [CUSTOM_1] Contract by explicit type

  \`ux:media.home : widget\` — bad kind.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
      Type: ux-contract
`;
  const diags = validateUxilFamily(entriesOf({ "a.md": md }), profile);
  assert(diags.some((d) => d.code === "UXIL-009"));
});

Deno.test("uxilDeclaringTypes: names types carrying declares (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}", declares: "ux-surface" },
    "requirement": { pattern: "REQ_{n:4d}" },
  });
  assertEquals([...uxilDeclaringTypes(profile)], ["ux-contract"]);
  assertEquals(uxilDeclaringTypes(null).size, 0);
});
