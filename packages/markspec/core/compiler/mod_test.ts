/**
 * @module compiler/mod_test
 *
 * Unit tests for the compiler pipeline. Exercises multi-file parsing,
 * entry-graph construction, link extraction, and diagnostic propagation.
 */

import { assertEquals, assertExists } from "@std/assert";
import { compile } from "./mod.ts";
import { makeDisplayId } from "../model/mod.ts";

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
