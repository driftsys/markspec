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

  Id: SRS_01HGW2Q8MNP3\\
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

  Id: SYS_01HGW2Q8MNP3

- [SRS_BRK_0001] Software requirement

  Body.

  Id: SRS_01HGW2R9QLP4\\
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

  Id: SYS_01HGW2Q8MNP3

- [SYS_BRK_0002] Second system req

  Body.

  Id: SYS_01HGW2R9QLP4

- [SRS_BRK_0001] Software req

  Body.

  Id: SRS_01HGW2S0ABC5\\
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

  Id: SRS_01HGW2Q8MNP3\\
  Derived-from: ISO-26262-6 §9.4
`,
    }),
  });

  const dfLinks = result.links.filter((l) => l.kind === "derived-from");
  assertEquals(dfLinks.length, 1);
  assertEquals(dfLinks[0].from, "SRS_BRK_0001");
  assertEquals(dfLinks[0].to, "ISO-26262-6");
});

Deno.test("compile: Allocates produces allocates link", async () => {
  const result = await compile(["arch.md"], {
    readFile: mockFs({
      "arch.md": `# Architecture

- [SRS_BRK_0001] Target req

  Body.

  Id: SRS_01HGW2Q8MNP3

- [SAD_BRK_0010] Allocation

  Sensor debouncing allocated to braking ECU.

  Id: SAD_01HGW3A2EFG3\\
  Allocates: SRS_BRK_0001\\
  Component: BRK-ECU-SENSOR
`,
    }),
  });

  const allocLinks = result.links.filter((l) => l.kind === "allocates");
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
