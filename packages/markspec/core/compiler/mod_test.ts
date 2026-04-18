/**
 * @module compiler/mod_test
 *
 * Unit tests for the compiler and traceability graph.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { compile } from "./mod.ts";

/** Mock file system for testing. */
function mockFs(files: Record<string, string>) {
  return (path: string): Promise<string> => {
    const content = files[path];
    if (content == null) return Promise.reject(new Error(`not found: ${path}`));
    return Promise.resolve(content);
  };
}

// ---------------------------------------------------------------------------
// Basic compilation
// ---------------------------------------------------------------------------

Deno.test("compile: single entry with no links", async () => {
  const result = await compile(["req.md"], {
    readFile: mockFs({
      "req.md": `# Test

- [SRS_BRK_0001] Sensor debouncing

  Body text.

  Id: SRS_00000000000000000000000001\\
  Labels: ASIL-B
`,
    }),
  });

  assertEquals(result.entries.size, 1);
  assertEquals(result.entries.has("SRS_BRK_0001"), true);
  assertEquals(result.links.length, 0);
});

// ---------------------------------------------------------------------------
// Traceability links
// ---------------------------------------------------------------------------

Deno.test("compile: Satisfies produces forward and reverse links", async () => {
  const result = await compile(["req.md"], {
    readFile: mockFs({
      "req.md": `# Test

- [SYS_BRK_0042] System requirement

  Body.

  Id: SYS_00000000000000000000000001

- [SRS_BRK_0001] Software requirement

  Body.

  Id: SRS_00000000000000000000000002\\
  Satisfies: SYS_BRK_0042
`,
    }),
  });

  assertEquals(result.links.length, 1);
  assertEquals(result.links[0].from, "SRS_BRK_0001");
  assertEquals(result.links[0].to, "SYS_BRK_0042");
  assertEquals(result.links[0].kind, "satisfies");

  // Forward: SRS_BRK_0001 has one outgoing link
  const fwd = result.forward.get("SRS_BRK_0001");
  assertEquals(fwd?.length, 1);

  // Reverse: SYS_BRK_0042 has one incoming link
  const rev = result.reverse.get("SYS_BRK_0042");
  assertEquals(rev?.length, 1);
  assertEquals(rev?.[0].from, "SRS_BRK_0001");
});

Deno.test("compile: multi-value Satisfies produces multiple links", async () => {
  const result = await compile(["req.md"], {
    readFile: mockFs({
      "req.md": `# Test

- [SYS_BRK_0001] First system req

  Body.

  Id: SYS_00000000000000000000000001

- [SYS_BRK_0002] Second system req

  Body.

  Id: SYS_01HGW2R9QLP4

- [SRS_BRK_0001] Software req

  Body.

  Id: SRS_00000000000000000000000003\\
  Satisfies: SYS_BRK_0001, SYS_BRK_0002
`,
    }),
  });

  assertEquals(result.links.length, 2);
  assertEquals(result.links[0].to, "SYS_BRK_0001");
  assertEquals(result.links[1].to, "SYS_BRK_0002");
});

Deno.test("compile: Derived-from extracts ID part only", async () => {
  const result = await compile(["req.md"], {
    readFile: mockFs({
      "req.md": `# Test

- [ISO-26262-6] ISO 26262 Part 6

  Road vehicles.

  Document: ISO 26262-6:2018

- [SRS_BRK_0001] Software req

  Body.

  Id: SRS_00000000000000000000000001\\
  Derived-from: ISO-26262-6 §9.4
`,
    }),
  });

  const dfLinks = result.links.filter((l) => l.kind === "derived-from");
  assertEquals(dfLinks.length, 1);
  assertEquals(dfLinks[0].from, "SRS_BRK_0001");
  assertEquals(dfLinks[0].to, "ISO-26262-6");
});

Deno.test("compile: Allocated-to produces allocated-to link", async () => {
  const result = await compile(["arch.md"], {
    readFile: mockFs({
      "arch.md": `# Architecture

- [SRS_BRK_0001] Target req

  Body.

  Id: SRS_00000000000000000000000001

- [SAD_BRK_0010] Allocation

  Sensor debouncing allocated to braking ECU.

  Id: SAD_0000000000000000000000000010\\
  Allocated-to: SRS_BRK_0001\\
  Component: BRK-ECU-SENSOR
`,
    }),
  });

  const allocLinks = result.links.filter((l) => l.kind === "allocated-to");
  assertEquals(allocLinks.length, 1);
  assertEquals(allocLinks[0].from, "SAD_BRK_0010");
  assertEquals(allocLinks[0].to, "SRS_BRK_0001");
});

// ---------------------------------------------------------------------------
// Diagnostics pass through
// ---------------------------------------------------------------------------

Deno.test("compile: validation diagnostics included", async () => {
  const result = await compile(["req.md"], {
    readFile: mockFs({
      "req.md": `# Test

- [SRS_BRK_0001] Missing Id entry

  Body text.

  Labels: ASIL-B
`,
    }),
  });

  const errors = result.diagnostics.filter((d) => d.severity === "error");
  assertEquals(errors.length > 0, true);
  assertStringIncludes(errors[0].message, "missing Id");
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

Deno.test("compile: file-not-found produces diagnostic", async () => {
  const result = await compile(["missing.md"], {
    readFile: mockFs({}),
  });

  assertEquals(result.entries.size, 0);
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  assertEquals(errors.length, 1);
  assertStringIncludes(errors[0].message, "missing.md");
});

// ---------------------------------------------------------------------------
// Phase 5a — new link kinds (Realizes, Verifies, Tests, Depends-on, Part-of,
// Generated-from, Supersedes)
// ---------------------------------------------------------------------------

Deno.test("compile: Realizes produces realizes link", async () => {
  const result = await compile(["elements.md"], {
    readFile: mockFs({
      "elements.md": `# Elements

- [SRS_BRK_0001] Software requirement

  Body.

  Id: SRS_00000000000000000000000001

- [braking_core::controller] Controller unit

  Body.

  Element-id: 01HGW3D6QRST7JKMNPQRSTVWXY\\
  Realizes: SRS_BRK_0001
`,
    }),
  });
  const realizes = result.links.filter((l) => l.kind === "realizes");
  assertEquals(realizes.length, 1);
  assertEquals(realizes[0].from, "braking_core::controller");
  assertEquals(realizes[0].to, "SRS_BRK_0001");
});

Deno.test("compile: Verifies on test produces verifies link", async () => {
  const result = await compile(["tests.md"], {
    readFile: mockFs({
      "tests.md": `# Tests

- [SRS_BRK_0001] Software requirement

  Body.

  Id: SRS_00000000000000000000000001

- [SWT_BRK_0107] Debounce unit test

  Body.

  Test-id: 01HGW3R9Q2P4ABCDEFGHJKMNPQ\\
  Verifies: SRS_BRK_0001
`,
    }),
  });
  const verifies = result.links.filter((l) => l.kind === "verifies");
  assertEquals(verifies.length, 1);
  assertEquals(verifies[0].from, "SWT_BRK_0107");
  assertEquals(verifies[0].to, "SRS_BRK_0001");
});

Deno.test("compile: Tests on test produces tests link", async () => {
  const result = await compile(["tests.md"], {
    readFile: mockFs({
      "tests.md": `# Tests

- [braking::unit] Unit

  Body.

  Element-id: 01HGW3D6QRST7JKMNPQRSTVWXY

- [SWT_BRK_0107] Unit test

  Body.

  Test-id: 01HGW3R9Q2P4ABCDEFGHJKMNPQ\\
  Tests: braking::unit
`,
    }),
  });
  const tests = result.links.filter((l) => l.kind === "tests");
  assertEquals(tests.length, 1);
  assertEquals(tests[0].to, "braking::unit");
});

Deno.test("compile: Depends-on on element produces depends-on link", async () => {
  const result = await compile(["elements.md"], {
    readFile: mockFs({
      "elements.md": `# Elements

- [braking::lib] Library

  Body.

  Element-id: 01HGW3D6QRST7JKMNPQRSTVWXY

- [braking::main] Main

  Body.

  Element-id: 01HGW3D6QRST7JKMNPQRSTVWX2\\
  Depends-on: braking::lib
`,
    }),
  });
  const depends = result.links.filter((l) => l.kind === "depends-on");
  assertEquals(depends.length, 1);
  assertEquals(depends[0].to, "braking::lib");
});

Deno.test("compile: Part-of on element produces part-of link", async () => {
  const result = await compile(["elements.md"], {
    readFile: mockFs({
      "elements.md": `# Elements

- [braking_core] Parent

  Body.

  Element-id: 01HGW3D6QRST7JKMNPQRSTVWXY

- [braking_core::child] Child

  Body.

  Element-id: 01HGW3D6QRST7JKMNPQRSTVWX2\\
  Part-of: braking_core
`,
    }),
  });
  const partOf = result.links.filter((l) => l.kind === "part-of");
  assertEquals(partOf.length, 1);
  assertEquals(partOf[0].to, "braking_core");
});

Deno.test("compile: Supersedes produces supersedes link (same-family)", async () => {
  const result = await compile(["req.md"], {
    readFile: mockFs({
      "req.md": `# Requirements

- [SRS_BRK_0001] Old

  Body.

  Id: SRS_00000000000000000000000001

- [SRS_BRK_0002] New

  Body.

  Id: SRS_00000000000000000000000002\\
  Supersedes: SRS_BRK_0001
`,
    }),
  });
  const supers = result.links.filter((l) => l.kind === "supersedes");
  assertEquals(supers.length, 1);
  assertEquals(supers[0].from, "SRS_BRK_0002");
  assertEquals(supers[0].to, "SRS_BRK_0001");
});

Deno.test("compile: multiple Verifies produces multiple links", async () => {
  const result = await compile(["tests.md"], {
    readFile: mockFs({
      "tests.md": `# Tests

- [SRS_BRK_0001] SW req 1

  Body.

  Id: SRS_00000000000000000000000001

- [SRS_BRK_0002] SW req 2

  Body.

  Id: SRS_00000000000000000000000002

- [SIT_BRK_0001] Integration test

  Body.

  Test-id: 01HGW3R9Q2P4ABCDEFGHJKMNPQ\\
  Verifies: SRS_BRK_0001, SRS_BRK_0002
`,
    }),
  });
  const verifies = result.links.filter((l) => l.kind === "verifies");
  assertEquals(verifies.length, 2);
  assertEquals(verifies.map((l) => l.to).sort(), [
    "SRS_BRK_0001",
    "SRS_BRK_0002",
  ]);
});

// ---------------------------------------------------------------------------
// Phase 5b — front matter exposed via CompileResult.documents
// ---------------------------------------------------------------------------

Deno.test("compile: front matter is extracted into CompileResult.documents", async () => {
  const result = await compile(["req.md"], {
    readFile: mockFs({
      "req.md": `---
document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR
document-type: requirements
status: approved
---

# Title

- [SRS_BRK_0001] Entry

  Body.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    }),
  });
  assertEquals(result.documents?.size, 1);
  const doc = result.documents?.get("req.md");
  assertEquals(doc?.attributes["document-id"], "01HGW2D0DOCPQ4FGHIJKLMNOPQR");
  assertEquals(doc?.attributes["document-type"], "requirements");
  assertEquals(doc?.attributes.status, "approved");
});

Deno.test("compile: file without front matter produces no Document entry", async () => {
  const result = await compile(["req.md"], {
    readFile: mockFs({
      "req.md": `# Title

- [SRS_BRK_0001] Entry

  Body.

  Id: SRS_00000000000000000000000001
`,
    }),
  });
  assertEquals(result.documents?.size, 0);
});

Deno.test("compile: forbidden front-matter key surfaces MSL-D001", async () => {
  const result = await compile(["req.md"], {
    readFile: mockFs({
      "req.md": `---
document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR
title: Should be rejected
---

# Title

- [SRS_BRK_0001] Entry

  Body.

  Spec-id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    }),
  });
  const d001 = result.diagnostics.find((d) => d.code === "MSL-D001");
  assertEquals(d001 != null, true);
});

Deno.test("compile: front matter separates body for entry parsing", async () => {
  // The --- in front matter should not be mistaken for a horizontal rule
  // in the entry-extraction pass.
  const result = await compile(["req.md"], {
    readFile: mockFs({
      "req.md": `---
document-id: 01HGW2D0DOCPQ4FGHIJKLMNOPQR
---

# Title

- [SRS_BRK_0001] Entry

  Body.

  Id: SRS_00000000000000000000000001
`,
    }),
  });
  assertEquals(result.entries.size, 1);
  assertEquals(result.entries.has("SRS_BRK_0001"), true);
});
