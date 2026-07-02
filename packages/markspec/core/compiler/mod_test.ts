/**
 * @module compiler/mod_test
 *
 * Unit tests for the compiler pipeline. Exercises multi-file parsing,
 * entry-graph construction, link extraction, and diagnostic propagation.
 */

import { assertArrayIncludes, assertEquals, assertExists } from "@std/assert";
import { compile } from "./mod.ts";
import { makeDisplayId } from "../model/mod.ts";
import type {
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
} from "../model/mod.ts";
import { parseFile } from "../parser/mod.ts";

const ULID_A = "01HGW2Q8MNP3RSTVWXYZABCDEF";
const ULID_B = "01HGW2Q8MNP3RSTVWXYZABCDEG";
const ULID_C = "01HGW2Q8MNP3RSTVWXYZABCDEH";

/** In-memory file reader builder. */
function reader(files: Record<string, string>): (p: string) => Promise<string> {
  return (path) => {
    const content = files[path];
    if (content === undefined) {
      return Promise.reject(new Error(`file not found: ${path}`));
    }
    return Promise.resolve(content);
  };
}

// ---------------------------------------------------------------------------
// Parsing + entry graph
// ---------------------------------------------------------------------------

Deno.test("compile: extracts entries from a single file", async () => {
  const files = {
    "req.md": `- [REQ-001] Title

  Body.

  Id: ${ULID_A}
`,
  };
  const result = await compile(["req.md"], { readFile: reader(files) });
  assertEquals(result.entries.size, 1);
  const entry = result.entries.get(makeDisplayId("REQ-001"));
  assertExists(entry);
  assertEquals(entry.shape, "Authored");
  assertEquals(entry.id, ULID_A);
});

Deno.test("compile: merges entries across multiple files", async () => {
  const files = {
    "a.md": `- [REQ-001] First

  Body.

  Id: ${ULID_A}
`,
    "b.md": `- [REQ-002] Second

  Body.

  Id: ${ULID_B}
`,
  };
  const result = await compile(["a.md", "b.md"], { readFile: reader(files) });
  assertEquals(result.entries.size, 2);
  assertExists(result.entries.get(makeDisplayId("REQ-001")));
  assertExists(result.entries.get(makeDisplayId("REQ-002")));
});

Deno.test("compile: mixed identified + referenced entries", async () => {
  const files = {
    "requirements.md": `- [REQ-001] Title

  Body.

  Id: ${ULID_A}
`,
    "references.md": `- [ISO-26262-6] Standard

  Id: urn:iso:std:iso:26262:-6:ed-2
`,
  };
  const result = await compile(["requirements.md", "references.md"], {
    readFile: reader(files),
  });
  assertEquals(result.entries.get(makeDisplayId("REQ-001"))?.shape, "Authored");
  assertEquals(
    result.entries.get(makeDisplayId("ISO-26262-6"))?.shape,
    "Reference",
  );
});

Deno.test("compile: missing file emits MSL-E000 error", async () => {
  const result = await compile(["missing.md"], { readFile: reader({}) });
  const err = result.diagnostics.find((d) => d.code === "MSL-E000");
  assertEquals(err?.severity, "error");
});

// ---------------------------------------------------------------------------
// Link extraction
// ---------------------------------------------------------------------------

Deno.test("compile: Supersedes produces a link", async () => {
  const files = {
    "req.md": `- [REQ-001] Original

  Body.

  Id: ${ULID_A}

- [REQ-002] Replacement

  Body.

      Id: ${ULID_B}
      Supersedes: REQ-001
`,
  };
  const result = await compile(["req.md"], { readFile: reader(files) });
  const supersedesLinks = result.links.filter((l) => l.kind === "supersedes");
  assertEquals(supersedesLinks.length, 1);
  assertEquals(supersedesLinks[0].from, "REQ-002");
  assertEquals(supersedesLinks[0].to, "REQ-001");
});

Deno.test("compile: References citation produces a link", async () => {
  const files = {
    "refs.md": `- [ISO-26262-6] Standard

  Id: urn:iso:std:iso:26262:-6:ed-2
`,
    "req.md": `- [REQ-001] Title

  Body.

      Id: ${ULID_A}
      References: ISO-26262-6 §9.4
`,
  };
  const result = await compile(["refs.md", "req.md"], {
    readFile: reader(files),
  });
  const refLinks = result.links.filter((l) => l.kind === "references");
  assertEquals(refLinks.length, 1);
  assertEquals(refLinks[0].from, "REQ-001");
  assertEquals(refLinks[0].to, "ISO-26262-6");
});

Deno.test("compile: id-list attr value splits into multiple links", async () => {
  // Any id-list attribute the compiler recognizes — Satisfies is on the
  // legacy link-kind list, so it still produces links even though it is
  // profile-declared in the new model.
  const files = {
    "req.md": `- [REQ-PARENT-A] A

  Body.

  Id: ${ULID_A}

- [REQ-PARENT-B] B

  Body.

  Id: ${ULID_B}

- [REQ-CHILD] Child

  Body.

      Id: ${ULID_C}
      Satisfies: REQ-PARENT-A, REQ-PARENT-B
`,
  };
  const result = await compile(["req.md"], { readFile: reader(files) });
  const sat = result.links.filter((l) => l.kind === "satisfies");
  assertEquals(sat.length, 2);
  assertEquals(sat.map((l) => l.to).sort(), ["REQ-PARENT-A", "REQ-PARENT-B"]);
});

Deno.test("compile: multi-value Derived-from splits into one link per target", async () => {
  // Derived-from is locator-bearing ("ID §section") AND 0..N: a comma-separated
  // list must yield one clean link per target, with no trailing comma and the
  // per-value locator dropped.
  const files = {
    "req.md": `- [REQ-PARENT-A] A

  Id: ${ULID_A}

- [REQ-PARENT-B] B

  Id: ${ULID_B}

- [REQ-CHILD] Child

      Id: ${ULID_C}
      Derived-from: REQ-PARENT-A §1.1, REQ-PARENT-B §2.3
`,
  };
  const result = await compile(["req.md"], { readFile: reader(files) });
  const df = result.links.filter((l) => l.kind === "derived-from");
  assertEquals(df.length, 2);
  assertEquals(df.map((l) => l.to).sort(), ["REQ-PARENT-A", "REQ-PARENT-B"]);
  // No target retains the comma separator.
  assertEquals(df.every((l) => !l.to.includes(",")), true);
});

Deno.test("compile: Provides/Requires produce provides/requires links", async () => {
  const files = {
    "components.md": `- [SWC_0001] Order service

      Id: ${ULID_A}
      Type: SoftwareComponent
      Provides: API_0001

- [SWC_0002] Cart service

      Id: ${ULID_B}
      Type: SoftwareComponent
      Requires: API_0001

- [API_0001] Order API

      Id: ${ULID_C}
      Type: SoftwareInterface
`,
  };
  const result = await compile(["components.md"], { readFile: reader(files) });
  const kinds = result.links.map((l) => l.kind);
  assertArrayIncludes(kinds, ["provides", "requires"]);
  const providesLinks = result.links.filter((l) => l.kind === "provides");
  assertEquals(providesLinks.length, 1);
  assertEquals(providesLinks[0].from, "SWC_0001");
  assertEquals(providesLinks[0].to, "API_0001");
  const requiresLinks = result.links.filter((l) => l.kind === "requires");
  assertEquals(requiresLinks.length, 1);
  assertEquals(requiresLinks[0].from, "SWC_0002");
  assertEquals(requiresLinks[0].to, "API_0001");
});

// ---------------------------------------------------------------------------
// Forward / reverse adjacency maps
// ---------------------------------------------------------------------------

Deno.test("compile: forward map carries outgoing links per entry", async () => {
  const files = {
    "req.md": `- [REQ-001] First

  Body.

  Id: ${ULID_A}

- [REQ-002] Second

  Body.

      Id: ${ULID_B}
      Supersedes: REQ-001
`,
  };
  const result = await compile(["req.md"], { readFile: reader(files) });
  const out = result.forward.get(makeDisplayId("REQ-002")) ?? [];
  assertEquals(out.length, 1);
  assertEquals(out[0].kind, "supersedes");
});

Deno.test("compile: reverse map carries incoming links per target", async () => {
  const files = {
    "req.md": `- [REQ-001] First

  Body.

  Id: ${ULID_A}

- [REQ-002] Second

  Body.

      Id: ${ULID_B}
      Supersedes: REQ-001
`,
  };
  const result = await compile(["req.md"], { readFile: reader(files) });
  const incoming = result.reverse.get(makeDisplayId("REQ-001")) ?? [];
  assertEquals(incoming.length, 1);
  assertEquals(incoming[0].from, "REQ-002");
});

// ---------------------------------------------------------------------------
// Diagnostic propagation
// ---------------------------------------------------------------------------

Deno.test("compile: validator diagnostics surface in result", async () => {
  const files = {
    "req.md": `- [REQ-001] Title

  Body.
`,
  };
  const result = await compile(["req.md"], { readFile: reader(files) });
  // Missing Id: → MSL-R003.
  const missing = result.diagnostics.find((d) => d.code === "MSL-R003");
  assertEquals(missing?.severity, "error");
});

Deno.test("compile: duplicate Id surfaces MSL-R005", async () => {
  const files = {
    "a.md": `- [REQ-001] First

  Body.

  Id: ${ULID_A}
`,
    "b.md": `- [REQ-002] Second

  Body.

  Id: ${ULID_A}
`,
  };
  const result = await compile(["a.md", "b.md"], { readFile: reader(files) });
  const dup = result.diagnostics.find((d) => d.code === "MSL-R005");
  assertEquals(dup?.severity, "error");
});

// ---------------------------------------------------------------------------
// Documents (front matter)
// ---------------------------------------------------------------------------

Deno.test("compile: captures front-matter document when present", async () => {
  const files = {
    "req.md": `---
document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR
document-type: requirements
---

- [REQ-001] Title

  Body.

  Id: ${ULID_A}
`,
  };
  const result = await compile(["req.md"], { readFile: reader(files) });
  const doc = result.documents.get("req.md");
  assertExists(doc);
  assertEquals(
    doc.attributes["document-id"],
    "01HGW2D0DOCPQ4FGHIJKLMNOPQR",
  );
  assertEquals(doc.attributes["document-type"], "requirements");
});

Deno.test("compile: no front matter → document absent", async () => {
  const files = {
    "req.md": `- [REQ-001] Title

  Body.

  Id: ${ULID_A}
`,
  };
  const result = await compile(["req.md"], { readFile: reader(files) });
  assertEquals(result.documents.has("req.md"), false);
});

// ---------------------------------------------------------------------------
// file.* properties population
// ---------------------------------------------------------------------------

const FIXTURE_MD = `- [REQ-001] Title

  Body.

      Id: ${ULID_A}
`;

Deno.test("compile: properties.file.path set when statFile provided", async () => {
  const files = { "req.md": FIXTURE_MD };
  const fakeMtime = new Date("2026-05-19T10:23:00.000Z");
  const result = await compile(["req.md"], {
    readFile: reader(files),
    statFile: () => Promise.resolve({ mtime: fakeMtime }),
  });
  const entry = result.entries.get(makeDisplayId("REQ-001"));
  assertExists(entry);
  assertEquals(entry.properties?.file?.path, "req.md");
  assertEquals(entry.properties?.file?.mtime, "2026-05-19T10:23:00.000Z");
});

Deno.test("compile: properties.file.path set without statFile; mtime absent", async () => {
  const files = { "req.md": FIXTURE_MD };
  const result = await compile(["req.md"], { readFile: reader(files) });
  const entry = result.entries.get(makeDisplayId("REQ-001"));
  assertExists(entry);
  assertEquals(entry.properties?.file?.path, "req.md");
  assertEquals(entry.properties?.file?.mtime, undefined);
});

Deno.test("compile: statFile returning undefined → mtime absent, no crash", async () => {
  const files = { "req.md": FIXTURE_MD };
  const result = await compile(["req.md"], {
    readFile: reader(files),
    statFile: () => Promise.resolve(undefined),
  });
  const entry = result.entries.get(makeDisplayId("REQ-001"));
  assertExists(entry);
  assertEquals(entry.properties?.file?.path, "req.md");
  assertEquals(entry.properties?.file?.mtime, undefined);
});

// ---------------------------------------------------------------------------
// git.* properties population
// ---------------------------------------------------------------------------

const GIT_FIXTURE_MD = `- [REQ-001] Title

  Body.

      Id: ${ULID_A}
`;

Deno.test("compile: properties.git populated from gitFile callback", async () => {
  const files = { "req.md": GIT_FIXTURE_MD };
  const result = await compile(["req.md"], {
    readFile: reader(files),
    gitFile: () =>
      Promise.resolve({
        createdAt: "2026-01-02T08:00:00.000Z",
        modifiedAt: "2026-05-19T10:23:00.000Z",
        revision: "abc1234",
      }),
  });
  const entry = result.entries.get(makeDisplayId("REQ-001"));
  assertExists(entry);
  assertEquals(entry.properties?.git?.createdAt, "2026-01-02T08:00:00.000Z");
  assertEquals(entry.properties?.git?.modifiedAt, "2026-05-19T10:23:00.000Z");
  assertEquals(entry.properties?.git?.revision, "abc1234");
  // contributors are off by default — PII-adjacent (ADR-006).
  assertEquals(entry.properties?.git?.contributors, undefined);
});

Deno.test("compile: properties.git absent when no gitFile provided", async () => {
  const files = { "req.md": GIT_FIXTURE_MD };
  const result = await compile(["req.md"], { readFile: reader(files) });
  const entry = result.entries.get(makeDisplayId("REQ-001"));
  assertExists(entry);
  assertEquals(entry.properties?.git, undefined);
});

Deno.test("compile: gitFile returning undefined → git absent, no crash", async () => {
  const files = { "req.md": GIT_FIXTURE_MD };
  const result = await compile(["req.md"], {
    readFile: reader(files),
    gitFile: () => Promise.resolve(undefined),
  });
  const entry = result.entries.get(makeDisplayId("REQ-001"));
  assertExists(entry);
  assertEquals(entry.properties?.git, undefined);
  // file.* still populated — git absence must not disturb other properties.
  assertEquals(entry.properties?.file?.path, "req.md");
});

Deno.test("compile: withContributors true → contributors deduped and sorted", async () => {
  const files = { "req.md": GIT_FIXTURE_MD };
  const result = await compile(["req.md"], {
    readFile: reader(files),
    withContributors: true,
    gitFile: () =>
      Promise.resolve({
        createdAt: "2026-01-02T08:00:00.000Z",
        modifiedAt: "2026-05-19T10:23:00.000Z",
        revision: "abc1234",
        contributors: ["Zoe", "Ada", "Zoe", "Ada", "Bo"],
      }),
  });
  const entry = result.entries.get(makeDisplayId("REQ-001"));
  assertExists(entry);
  assertEquals(entry.properties?.git?.contributors, ["Ada", "Bo", "Zoe"]);
});

Deno.test("compile: withContributors false strips contributors from callback", async () => {
  const files = { "req.md": GIT_FIXTURE_MD };
  const result = await compile(["req.md"], {
    readFile: reader(files),
    gitFile: () =>
      Promise.resolve({
        createdAt: "2026-01-02T08:00:00.000Z",
        modifiedAt: "2026-05-19T10:23:00.000Z",
        revision: "abc1234",
        contributors: ["Ada", "Bo"],
      }),
  });
  const entry = result.entries.get(makeDisplayId("REQ-001"));
  assertExists(entry);
  assertEquals(entry.properties?.git?.contributors, undefined);
  // Non-PII git fields are still populated.
  assertEquals(entry.properties?.git?.revision, "abc1234");
});

// ---------------------------------------------------------------------------
// Profile-aware diagnostics (MSL-R010 suppression)
// ---------------------------------------------------------------------------

/** Minimal profile declaring a single custom `Foo` text attribute. */
function profileWithFoo(): EffectiveProfile {
  return {
    attributes: new Map([[
      "Foo",
      {
        value: {
          name: "Foo",
          type: "text" as const,
          required: false,
          cardinality: { lower: 0, upper: 1 },
        },
        origin: "@test/p",
      },
    ]]),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: new Map(),
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

Deno.test("compile: suppresses MSL-R010 for profile-declared attributes", async () => {
  const files = {
    "req.md": `- [REQ-001] Title

  Body.

  Id: ${ULID_A}
  Foo: hello
`,
  };
  const result = await compile(["req.md"], {
    readFile: reader(files),
    profile: profileWithFoo(),
  });
  const r010 = result.diagnostics.find((d) => d.code === "MSL-R010");
  assertEquals(
    r010,
    undefined,
    `expected no MSL-R010 for profile-declared 'Foo', got: ${r010?.message}`,
  );
});

Deno.test("compile: still flags MSL-R010 for undeclared attributes", async () => {
  const files = {
    "req.md": `- [REQ-001] Title

  Body.

  Id: ${ULID_A}
  Bogus: nope
`,
  };
  const result = await compile(["req.md"], {
    readFile: reader(files),
    profile: profileWithFoo(),
  });
  const r010 = result.diagnostics.find((d) => d.code === "MSL-R010");
  assertExists(r010, "expected MSL-R010 for undeclared 'Bogus'");
});

// ---------------------------------------------------------------------------
// source.* properties population
// ---------------------------------------------------------------------------

Deno.test(
  "compile: properties.source.type set to 'markdown' for md entries",
  async () => {
    const files = { "req.md": FIXTURE_MD };
    const result = await compile(["req.md"], { readFile: reader(files) });
    const entry = result.entries.get(makeDisplayId("REQ-001"));
    assertExists(entry);
    assertEquals(entry.properties?.source?.type, "markdown");
    assertEquals(entry.properties?.source?.adapter, undefined);
  },
);

// ---------------------------------------------------------------------------
// Phase 4: Discipline classification
// ---------------------------------------------------------------------------

Deno.test("compile: every returned entry has derivedDiscipline set", async () => {
  const files: Record<string, string> = {
    "/r.md": `
- [REQ_0001] Test

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [SWC_0001] SW

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
      Type: SoftwareComponent
`,
  };
  const result = await compile(["/r.md"], { readFile: reader(files) });
  // Every entry has a well-formed derivedDiscipline.
  const ALLOWED = new Set(["system", "software", "hardware", "mixed"]);
  for (const entry of result.entries.values()) {
    if (!ALLOWED.has(entry.derivedDiscipline ?? "")) {
      throw new Error(
        `entry ${entry.displayId} has unexpected derivedDiscipline=${entry.derivedDiscipline}`,
      );
    }
  }
  // SWC_0001 has Type: SoftwareComponent → channel 3 → 'software'.
  const swc = result.entries.get(makeDisplayId("SWC_0001"));
  if (!swc) throw new Error("SWC_0001 missing from compile output");
  if (swc.derivedDiscipline !== "software") {
    throw new Error(
      `expected SWC_0001 derivedDiscipline=software, got ${swc.derivedDiscipline}`,
    );
  }
});

Deno.test(
  "compile: properties.source determinism — two runs over identical input produce byte-identical output",
  async () => {
    const md =
      `- [STK_0001] Title\n\n  The system shall do something.\n\n      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF\n`;
    const files = { "t.md": md };
    const result1 = await compile(["t.md"], { readFile: reader(files) });
    const result2 = await compile(["t.md"], { readFile: reader(files) });
    const entry1 = result1.entries.get(makeDisplayId("STK_0001"));
    const entry2 = result2.entries.get(makeDisplayId("STK_0001"));
    assertExists(entry1);
    assertExists(entry2);
    // Stable JSON projection — if any field contains a wall-clock timestamp
    // or run-specific token, this assertion fails.
    assertEquals(
      JSON.stringify(entry1.properties?.source),
      JSON.stringify(entry2.properties?.source),
    );
  },
);

// ---------------------------------------------------------------------------
// typeRegistry
// ---------------------------------------------------------------------------

Deno.test("compile: typeRegistry is present and empty for entries without typl", async () => {
  const files = {
    "req.md": `- [REQ-001] Title

  Body.

      Id: ${ULID_A}
`,
  };
  const result = await compile(["req.md"], { readFile: reader(files) });
  // Registry must be present (no undefined)
  assertEquals(typeof result.typeRegistry, "object");
  assertEquals(result.typeRegistry.bindings instanceof Map, true);
  assertEquals(result.typeRegistry.typedefs instanceof Map, true);
  assertEquals(result.typeRegistry.bindings.size, 0);
  assertEquals(result.typeRegistry.typedefs.size, 0);
});

Deno.test("compile: typeRegistry collects $Name bindings from typl fences", async () => {
  const files = {
    "req.md": `- [REQ-001] Speed signal

  Body.

  \`\`\`typl
  $Speed : signal float[0..300]
  \`\`\`

      Id: ${ULID_A}
`,
  };
  const result = await compile(["req.md"], { readFile: reader(files) });
  assertEquals(result.typeRegistry.bindings.size, 1);
  const speedDecls = result.typeRegistry.bindings.get("$Speed");
  assertEquals(Array.isArray(speedDecls), true);
  assertEquals(speedDecls?.length, 1);
  assertEquals(speedDecls?.[0].binding.kind, "signal");
});

// ---------------------------------------------------------------------------
// Phase 4: Profile-extended registry classification
// ---------------------------------------------------------------------------

function syntheticProfile(): EffectiveProfile {
  const td: EffectiveTypeDef = {
    name: "SoftwareRequirement",
    extends: "Requirement",
    displayIdPattern: { value: "SWR_{NNNN}", origin: "p" },
    displayIdPatternEnforcement: { value: "off", origin: "p" },
    color: { value: undefined, origin: "p" },
    required: { value: [], origin: "p" },
    attributes: new Map(),
    traceability: new Map(),
    description: { value: undefined, origin: "p" },
    attrDescriptions: new Map(),
    relationDescriptions: new Map(),
    discipline: { value: "software", origin: "p" },
  };
  // deno-lint-ignore no-explicit-any
  const types = new Map() as any;
  types.set("SoftwareRequirement", { value: td, origin: "p" });
  return {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types,
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

Deno.test("compile: profile-extended registry classifies SoftwareRequirement entries", async () => {
  const files: Record<string, string> = {
    "/r.md": `
- [SWR_0001] SW requirement

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: SoftwareRequirement
`,
  };
  const result = await compile(["/r.md"], {
    readFile: reader(files),
    profile: syntheticProfile(),
  });
  const swr = result.entries.get(makeDisplayId("SWR_0001"));
  if (!swr) throw new Error("SWR_0001 missing from compile output");
  assertEquals(swr.derivedDiscipline, "software");
});

// ---------------------------------------------------------------------------
// Corpus injection (ADR-030): CompileOptions.corpusEntries
// ---------------------------------------------------------------------------

const CORPUS_ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

/** Build one origin-stamped corpus entry the way `loadDeliveredCorpus`
 * does: parse a delivered-document fixture, then stamp `origin`. */
async function corpusEntries(): Promise<Entry[]> {
  const md = `- [PLT_0001] Platform core service

  The platform core service shall expose the vehicle state bus.

      Id: ${CORPUS_ULID}
`;
  const { entries } = await parseFile(md, {
    file: "/cache/platform-arch/reference/platform.md",
  });
  return entries.map((e) => ({
    ...e,
    origin: {
      kind: "profile" as const,
      profileId: "platform-arch",
      profileVersion: "1.2.0",
    },
  }));
}

Deno.test("compile: corpusEntries resolves a project Satisfies: target with no MSL-L006", async () => {
  const files = {
    "/repo/reqs.md": `- [STK_0001] Vehicle state access

  The system shall read the vehicle state from the platform core service.

      Id: ${ULID_A}
      Satisfies: PLT_0001
`,
  };
  const result = await compile(["/repo/reqs.md"], {
    readFile: reader(files),
    corpusEntries: await corpusEntries(),
  });

  const corpusEntry = result.entries.get(makeDisplayId("PLT_0001"));
  assertExists(corpusEntry);
  assertEquals(corpusEntry.origin?.profileId, "platform-arch");

  const forward = result.forward.get(makeDisplayId("STK_0001")) ?? [];
  assertEquals(
    forward.some((l) => l.to === makeDisplayId("PLT_0001")),
    true,
  );

  assertEquals(result.diagnostics.filter((d) => d.code === "MSL-L006"), []);
});

Deno.test("compile: project entry colliding with a corpus display ID → exactly one MSL-R014, no MSL-R006", async () => {
  const files = {
    "/repo/collide.md": `- [PLT_0001] My own platform entry

  Colliding body.

      Id: 01ARZ3NDEKTSV4RRFFQ69G5FC0
`,
  };
  const result = await compile(["/repo/collide.md"], {
    readFile: reader(files),
    corpusEntries: await corpusEntries(),
  });

  const r014 = result.diagnostics.filter((d) => d.code === "MSL-R014");
  assertEquals(r014.length, 1);
  assertEquals(r014[0].location?.file, "/repo/collide.md");

  assertEquals(result.diagnostics.filter((d) => d.code === "MSL-R006"), []);
});
