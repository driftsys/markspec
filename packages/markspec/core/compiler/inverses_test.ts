import { assertEquals } from "@std/assert";
import { generateInverses } from "./inverses.ts";
import type {
  AttrDecl,
  EffectiveProfile,
  EffectiveShapeScope,
  EffectiveTypeDef,
  Entry,
  ProvenancedMap,
  ProvenancedMapEntry,
} from "../model/mod.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOC = { file: "test.md", line: 1, column: 1 } as const;

function entry(
  overrides: Partial<Entry> & { displayId: string },
): Entry {
  return {
    title: "",
    body: "",
    attributes: [],
    shape: "identified",
    location: LOC,
    source: "markdown",
    typedAttributes: new Map(),
    ...overrides,
  };
}

function pm<V>(
  entries: Record<string, V>,
  origin = "test-profile",
): ProvenancedMap<V> {
  const m = new Map<string, ProvenancedMapEntry<V>>();
  for (const [k, v] of Object.entries(entries)) {
    m.set(k, { value: v, origin });
  }
  return m;
}

function attrDecl(
  overrides: Partial<AttrDecl> & { name: string },
): AttrDecl {
  return {
    type: "id-list",
    required: false,
    cardinality: { lower: 0, upper: Infinity },
    ...overrides,
  };
}

const emptyShapeScope: EffectiveShapeScope = {
  required: { value: [], origin: "test-profile" },
  attributes: new Map(),
  traceability: new Map(),
};

function makeProfile(
  typeAttrs: Record<string, Record<string, AttrDecl>> = {},
  universalAttrs: Record<string, AttrDecl> = {},
  identifiedAttrs: Record<string, AttrDecl> = {},
): EffectiveProfile {
  const types = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const [typeName, attrs] of Object.entries(typeAttrs)) {
    types.set(typeName, {
      value: {
        name: typeName,
        shape: "identified",
        displayIdPattern: { value: undefined, origin: "test-profile" },
        displayIdPatternEnforcement: { value: "off", origin: "test-profile" },
        required: { value: [], origin: "test-profile" },
        attributes: pm(attrs),
        traceability: new Map(),
      },
      origin: "test-profile",
    });
  }
  return {
    required: { value: [], origin: "test-profile" },
    attributes: pm(universalAttrs),
    labels: { value: [], origin: "test-profile" },
    identified: {
      ...emptyShapeScope,
      attributes: pm(identifiedAttrs),
    },
    referenced: emptyShapeScope,
    types,
    documents: { types: new Map(), frontMatter: new Map() },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("generateInverses: basic inverse — Verifies → Verified-by", () => {
  const profile = makeProfile({
    test: {
      Verifies: attrDecl({
        name: "Verifies",
        type: "id-list",
        inverse: { name: "Verified-by", category: "requirement" },
      }),
    },
    requirement: {},
  });

  const req = entry({
    displayId: "REQ_001",
    id: "01AAAAAAAAAAAAAAAAAAAAAAAAA",
    type: "requirement",
    typedAttributes: new Map(),
  });
  const tst = entry({
    displayId: "TST_001",
    id: "01BBBBBBBBBBBBBBBBBBBBBBBBB",
    type: "test",
    typedAttributes: new Map([
      ["Verifies", ["01AAAAAAAAAAAAAAAAAAAAAAAAA"]],
    ]),
  });

  const result = generateInverses([req, tst], profile);

  assertEquals(result.diagnostics.length, 0);
  const updatedReq = result.entries.find((e) => e.displayId === "REQ_001")!;
  assertEquals(
    updatedReq.typedAttributes?.get("Verified-by"),
    ["01BBBBBBBBBBBBBBBBBBBBBBBBB"],
  );
});

Deno.test("generateInverses: category filter — skips non-matching target type", () => {
  const profile = makeProfile({
    test: {
      Verifies: attrDecl({
        name: "Verifies",
        type: "id-list",
        inverse: { name: "Verified-by", category: "requirement" },
      }),
    },
    specification: {},
  });

  const spec = entry({
    displayId: "SPEC_001",
    id: "01CCCCCCCCCCCCCCCCCCCCCCCC1",
    type: "specification", // not "requirement"
    typedAttributes: new Map(),
  });
  const tst = entry({
    displayId: "TST_002",
    id: "01DDDDDDDDDDDDDDDDDDDDDDD",
    type: "test",
    typedAttributes: new Map([
      ["Verifies", ["01CCCCCCCCCCCCCCCCCCCCCCCC1"]],
    ]),
  });

  const result = generateInverses([spec, tst], profile);
  assertEquals(result.diagnostics.length, 0);
  const updatedSpec = result.entries.find((e) => e.displayId === "SPEC_001")!;
  // Inverse should NOT be added — category mismatch
  assertEquals(updatedSpec.typedAttributes?.has("Verified-by"), false);
});

Deno.test("generateInverses: multiple sources aggregate into id-list", () => {
  const profile = makeProfile({
    test: {
      Verifies: attrDecl({
        name: "Verifies",
        type: "id-list",
        inverse: { name: "Verified-by", category: "requirement" },
      }),
    },
    requirement: {},
  });

  const req = entry({
    displayId: "REQ_002",
    id: "01EEEEEEEEEEEEEEEEEEEEEEEE1",
    type: "requirement",
    typedAttributes: new Map(),
  });
  const tst1 = entry({
    displayId: "TST_003",
    id: "01FFFFFFFFFFFFFFFFFFFFFFFFFF",
    type: "test",
    typedAttributes: new Map([
      ["Verifies", ["01EEEEEEEEEEEEEEEEEEEEEEEE1"]],
    ]),
  });
  const tst2 = entry({
    displayId: "TST_004",
    id: "01GGGGGGGGGGGGGGGGGGGGGGGG1",
    type: "test",
    typedAttributes: new Map([
      ["Verifies", ["01EEEEEEEEEEEEEEEEEEEEEEEE1"]],
    ]),
  });

  const result = generateInverses([req, tst1, tst2], profile);
  assertEquals(result.diagnostics.length, 0);
  const updatedReq = result.entries.find((e) => e.displayId === "REQ_002")!;
  const verifiedBy = updatedReq.typedAttributes?.get("Verified-by");
  assertEquals(verifiedBy?.length, 2);
  assertEquals(verifiedBy?.includes("01FFFFFFFFFFFFFFFFFFFFFFFFFF"), true);
  assertEquals(verifiedBy?.includes("01GGGGGGGGGGGGGGGGGGGGGGGG1"), true);
});

Deno.test("generateInverses: no inverse declarations → entries unchanged", () => {
  const profile = makeProfile({
    requirement: {
      Labels: attrDecl({ name: "Labels", type: "tag-list" }),
    },
  });

  const req = entry({
    displayId: "REQ_003",
    id: "01HHHHHHHHHHHHHHHHHHHHHHHH1",
    type: "requirement",
    typedAttributes: new Map([["Labels", ["ASIL-B"]]]),
  });

  const result = generateInverses([req], profile);
  assertEquals(result.diagnostics.length, 0);
  assertEquals(result.entries[0], req);
});

Deno.test("generateInverses: referenced entries are skipped as sources", () => {
  const profile = makeProfile({
    test: {
      Verifies: attrDecl({
        name: "Verifies",
        type: "id-list",
        inverse: { name: "Verified-by", category: "requirement" },
      }),
    },
    requirement: {},
  });

  const req = entry({
    displayId: "REQ_004",
    id: "01JJJJJJJJJJJJJJJJJJJJJJJJ1",
    type: "requirement",
    typedAttributes: new Map(),
  });
  const ref = entry({
    displayId: "ISO-26262",
    id: "urn:iso:std:iso:26262",
    type: "test",
    shape: "referenced",
    typedAttributes: new Map([
      ["Verifies", ["01JJJJJJJJJJJJJJJJJJJJJJJJ1"]],
    ]),
  });

  const result = generateInverses([req, ref], profile);
  assertEquals(result.diagnostics.length, 0);
  const updatedReq = result.entries.find((e) => e.displayId === "REQ_004")!;
  assertEquals(updatedReq.typedAttributes?.has("Verified-by"), false);
});

Deno.test("generateInverses: clean run produces empty diagnostics", () => {
  const profile = makeProfile();
  const result = generateInverses([], profile);
  assertEquals(result.diagnostics, []);
  assertEquals(result.entries, []);
});

Deno.test("generateInverses: MSL-L005 when authored inverse disagrees with generated", () => {
  const profile = makeProfile({
    test: {
      Verifies: attrDecl({
        name: "Verifies",
        type: "id-list",
        inverse: { name: "Verified-by", category: "requirement" },
      }),
    },
    requirement: {},
  });

  const req = entry({
    displayId: "REQ_005",
    id: "01KKKKKKKKKKKKKKKKKKKKKKKK1",
    type: "requirement",
    typedAttributes: new Map([
      // Author wrote a wrong value
      ["Verified-by", ["01ZZZZZZZZZZZZZZZZZZZZZZZZ1"]],
    ]),
  });
  const tst = entry({
    displayId: "TST_005",
    id: "01LLLLLLLLLLLLLLLLLLLLLLLL1",
    type: "test",
    typedAttributes: new Map([
      ["Verifies", ["01KKKKKKKKKKKKKKKKKKKKKKKK1"]],
    ]),
  });

  const result = generateInverses([req, tst], profile);
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MSL-L005");
  assertEquals(result.diagnostics[0].severity, "warning");

  // Union: both authored and generated values present
  const updatedReq = result.entries.find((e) => e.displayId === "REQ_005")!;
  const verifiedBy = updatedReq.typedAttributes?.get("Verified-by")!;
  assertEquals(verifiedBy.length, 2);
  assertEquals(verifiedBy.includes("01ZZZZZZZZZZZZZZZZZZZZZZZZ1"), true);
  assertEquals(verifiedBy.includes("01LLLLLLLLLLLLLLLLLLLLLLLL1"), true);
});

Deno.test("generateInverses: no MSL-L005 when authored matches generated exactly", () => {
  const profile = makeProfile({
    test: {
      Verifies: attrDecl({
        name: "Verifies",
        type: "id-list",
        inverse: { name: "Verified-by", category: "requirement" },
      }),
    },
    requirement: {},
  });

  const req = entry({
    displayId: "REQ_006",
    id: "01MMMMMMMMMMMMMMMMMMMMMMMM1",
    type: "requirement",
    typedAttributes: new Map([
      ["Verified-by", ["01NNNNNNNNNNNNNNNNNNNNNNNN1"]],
    ]),
  });
  const tst = entry({
    displayId: "TST_006",
    id: "01NNNNNNNNNNNNNNNNNNNNNNNN1",
    type: "test",
    typedAttributes: new Map([
      ["Verifies", ["01MMMMMMMMMMMMMMMMMMMMMMMM1"]],
    ]),
  });

  const result = generateInverses([req, tst], profile);
  assertEquals(result.diagnostics.length, 0);
});

Deno.test("generateInverses: inverse from universal-scope attribute", () => {
  const profile = makeProfile(
    { requirement: {} },
    {
      Satisfies: attrDecl({
        name: "Satisfies",
        type: "id-list",
        inverse: { name: "Satisfied-by", category: "requirement" },
      }),
    },
  );

  const parent = entry({
    displayId: "REQ_P",
    id: "01PPPPPPPPPPPPPPPPPPPPPPPP1",
    type: "requirement",
    typedAttributes: new Map(),
  });
  const child = entry({
    displayId: "REQ_C",
    id: "01QQQQQQQQQQQQQQQQQQQQQQQQ1",
    type: "requirement",
    typedAttributes: new Map([
      ["Satisfies", ["01PPPPPPPPPPPPPPPPPPPPPPPP1"]],
    ]),
  });

  const result = generateInverses([parent, child], profile);
  assertEquals(result.diagnostics.length, 0);
  const updatedParent = result.entries.find((e) => e.displayId === "REQ_P")!;
  assertEquals(
    updatedParent.typedAttributes?.get("Satisfied-by"),
    ["01QQQQQQQQQQQQQQQQQQQQQQQQ1"],
  );
});

Deno.test("generateInverses: inverse from identified-shape-scope attribute", () => {
  const profile = makeProfile(
    { requirement: {} },
    {},
    {
      Satisfies: attrDecl({
        name: "Satisfies",
        type: "id-list",
        inverse: { name: "Satisfied-by", category: "requirement" },
      }),
    },
  );

  const parent = entry({
    displayId: "REQ_IS1",
    id: "01RRRRRRRRRRRRRRRRRRRRRRRR1",
    type: "requirement",
    typedAttributes: new Map(),
  });
  const child = entry({
    displayId: "REQ_IS2",
    id: "01SSSSSSSSSSSSSSSSSSSSSSSS1",
    type: "requirement",
    typedAttributes: new Map([
      ["Satisfies", ["01RRRRRRRRRRRRRRRRRRRRRRRR1"]],
    ]),
  });

  const result = generateInverses([parent, child], profile);
  assertEquals(result.diagnostics.length, 0);
  const updatedParent = result.entries.find((e) => e.displayId === "REQ_IS1")!;
  assertEquals(
    updatedParent.typedAttributes?.get("Satisfied-by"),
    ["01SSSSSSSSSSSSSSSSSSSSSSSS1"],
  );
});
