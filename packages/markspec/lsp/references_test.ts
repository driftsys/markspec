/**
 * @module lsp/references_test
 *
 * Unit tests for {@linkcode findReferencingEntries} — walks a set of
 * entries and returns those whose trace attribute values include the
 * target display ID.
 */

import { assertEquals } from "@std/assert";
import type { Entry } from "../core/model/mod.ts";
import { findReferencingEntries } from "./references.ts";

function makeEntry(
  displayId: string,
  attrs: Array<[string, string]>,
  line = 1,
): Entry {
  return {
    displayId,
    title: displayId,
    body: "",
    rawAttributes: attrs.map(([key, value]) => ({ key, value })),
    typedAttributes: new Map(),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    shape: "Authored",
    location: { file: "t.md", line, column: 1 },
    source: "markdown",
  };
}

Deno.test("findReferencingEntries: returns entries whose Satisfies points at target", () => {
  const entries = [
    makeEntry("REQ-001", [["Id", "01"]], 1),
    makeEntry("REQ-002", [["Id", "02"], ["Satisfies", "REQ-001"]], 5),
    makeEntry("REQ-003", [["Id", "03"]], 10),
  ];
  const refs = findReferencingEntries(entries, "REQ-001");
  assertEquals(refs.length, 1);
  assertEquals(refs[0].displayId, "REQ-002");
});

Deno.test("findReferencingEntries: matches id-list (multi-value) attributes", () => {
  const entries = [
    makeEntry("REQ-001", [["Id", "01"]]),
    makeEntry("REQ-002", [
      ["Id", "02"],
      ["Derived-from", "REQ-001, REQ-003"],
    ]),
  ];
  const refs = findReferencingEntries(entries, "REQ-001");
  assertEquals(refs.length, 1);
  assertEquals(refs[0].displayId, "REQ-002");
});

Deno.test("findReferencingEntries: multi-line repeatable trace attribute", () => {
  const entries = [
    makeEntry("REQ-001", [["Id", "01"]]),
    makeEntry("TST-001", [
      ["Id", "tst"],
      ["Verifies", "REQ-001"],
      ["Verifies", "REQ-002"],
    ]),
  ];
  const refs = findReferencingEntries(entries, "REQ-001");
  assertEquals(refs.length, 1);
  assertEquals(refs[0].displayId, "TST-001");
});

Deno.test("findReferencingEntries: substring match on a partial token is rejected", () => {
  const entries = [
    makeEntry("REQ-001", [["Id", "01"]]),
    // 'REQ-0010' shouldn't match 'REQ-001' as a substring.
    makeEntry("REQ-0010", [["Id", "10"], ["Satisfies", "REQ-001-extra"]]),
  ];
  const refs = findReferencingEntries(entries, "REQ-001");
  assertEquals(refs.length, 0);
});

Deno.test("findReferencingEntries: does NOT match against Id attribute (declaration site)", () => {
  const entries = [
    makeEntry("REQ-001", [["Id", "01HGW2Q8MNP3REQ001"]]),
    makeEntry("REQ-002", [["Id", "02"], ["Satisfies", "REQ-001"]]),
  ];
  const refs = findReferencingEntries(entries, "REQ-001");
  // Only REQ-002 references REQ-001 via Satisfies; REQ-001 itself (with
  // matching displayId) is not counted as a referencing entry.
  assertEquals(refs.length, 1);
  assertEquals(refs[0].displayId, "REQ-002");
});

Deno.test("findReferencingEntries: matches profile-declared trace attributes too", () => {
  // 'Mitigates' is a profile-declared trace attribute. The function
  // walks every attribute except Id, so it matches regardless of
  // whether the key is in a known core list.
  const entries = [
    makeEntry("RSK-001", [["Id", "rsk"]]),
    makeEntry("MIT-001", [["Id", "mit"], ["Mitigates", "RSK-001"]]),
  ];
  const refs = findReferencingEntries(entries, "RSK-001");
  assertEquals(refs.length, 1);
  assertEquals(refs[0].displayId, "MIT-001");
});

Deno.test("findReferencingEntries: returns empty when no entries reference the target", () => {
  const entries = [
    makeEntry("REQ-001", [["Id", "01"]]),
    makeEntry("REQ-002", [["Id", "02"]]),
  ];
  const refs = findReferencingEntries(entries, "REQ-001");
  assertEquals(refs, []);
});
