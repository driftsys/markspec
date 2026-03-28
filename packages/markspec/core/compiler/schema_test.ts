import { assertEquals } from "@std/assert";
import { serializeCompileResult } from "./schema.ts";
import type { CompileResult } from "./mod.ts";
import type { Entry, Link } from "../model/mod.ts";

/** Build a minimal Entry for testing. */
function makeEntry(displayId: string): Entry {
  return {
    displayId,
    title: `Title for ${displayId}`,
    body: "",
    attributes: [],
    id: undefined,
    entryType: displayId.split("_")[0],
    location: { file: "test.md", line: 1, column: 1 },
    source: "markdown",
  };
}

/** Build a minimal Link for testing. */
function makeLink(from: string, to: string): Link {
  return {
    from,
    to,
    kind: "satisfies",
    location: { file: "test.md", line: 1, column: 1 },
  };
}

Deno.test("serializeCompileResult: converts Maps to plain objects", () => {
  const entry = makeEntry("SRS_BRK_0001");
  const entries = new Map([[entry.displayId, entry]]);
  const link = makeLink("SRS_BRK_0001", "SYS_BRK_0042");
  const forward = new Map([["SRS_BRK_0001", [link]]]);
  const reverse = new Map([["SYS_BRK_0042", [link]]]);

  const result: CompileResult = {
    entries,
    links: [link],
    forward,
    reverse,
    diagnostics: [],
  };

  const serialized = serializeCompileResult(result);

  // Entries should be a plain object, not a Map.
  assertEquals(typeof serialized.entries, "object");
  assertEquals(serialized.entries instanceof Map, false);

  // Forward/reverse should be plain objects.
  assertEquals(serialized.forward instanceof Map, false);
  assertEquals(serialized.reverse instanceof Map, false);
});

Deno.test("serializeCompileResult: entries keyed by displayId", () => {
  const entryA = makeEntry("SRS_BRK_0001");
  const entryB = makeEntry("SRS_BRK_0002");
  const entries = new Map([
    [entryA.displayId, entryA],
    [entryB.displayId, entryB],
  ]);

  const result: CompileResult = {
    entries,
    links: [],
    forward: new Map(),
    reverse: new Map(),
    diagnostics: [],
  };

  const serialized = serializeCompileResult(result);

  assertEquals(Object.keys(serialized.entries).sort(), [
    "SRS_BRK_0001",
    "SRS_BRK_0002",
  ]);
  assertEquals(
    (serialized.entries["SRS_BRK_0001"] as Entry).displayId,
    "SRS_BRK_0001",
  );
  assertEquals(
    (serialized.entries["SRS_BRK_0002"] as Entry).displayId,
    "SRS_BRK_0002",
  );
});

Deno.test("serializeCompileResult: links preserved as-is", () => {
  const link = makeLink("SRS_BRK_0001", "SYS_BRK_0042");

  const result: CompileResult = {
    entries: new Map(),
    links: [link],
    forward: new Map(),
    reverse: new Map(),
    diagnostics: [],
  };

  const serialized = serializeCompileResult(result);

  assertEquals(serialized.links.length, 1);
  assertEquals(serialized.links[0], link);
});

Deno.test("serializeCompileResult: round-trip via JSON.parse", () => {
  const entry = makeEntry("SRS_BRK_0001");
  const link = makeLink("SRS_BRK_0001", "SYS_BRK_0042");

  const result: CompileResult = {
    entries: new Map([[entry.displayId, entry]]),
    links: [link],
    forward: new Map([["SRS_BRK_0001", [link]]]),
    reverse: new Map([["SYS_BRK_0042", [link]]]),
    diagnostics: [
      {
        code: "MSL-W001",
        severity: "warning",
        message: "test warning",
        location: undefined,
      },
    ],
  };

  const serialized = serializeCompileResult(result);
  const json = JSON.stringify(serialized);
  const parsed = JSON.parse(json);

  // Verify structural expectations after round-trip.
  assertEquals(typeof parsed.entries, "object");
  assertEquals(parsed.entries["SRS_BRK_0001"].displayId, "SRS_BRK_0001");
  assertEquals(parsed.entries["SRS_BRK_0001"].title, "Title for SRS_BRK_0001");

  assertEquals(Array.isArray(parsed.links), true);
  assertEquals(parsed.links.length, 1);
  assertEquals(parsed.links[0].from, "SRS_BRK_0001");
  assertEquals(parsed.links[0].to, "SYS_BRK_0042");
  assertEquals(parsed.links[0].kind, "satisfies");

  assertEquals(typeof parsed.forward, "object");
  assertEquals(parsed.forward["SRS_BRK_0001"].length, 1);

  assertEquals(typeof parsed.reverse, "object");
  assertEquals(parsed.reverse["SYS_BRK_0042"].length, 1);

  assertEquals(Array.isArray(parsed.diagnostics), true);
  assertEquals(parsed.diagnostics.length, 1);
  assertEquals(parsed.diagnostics[0].code, "MSL-W001");
});
