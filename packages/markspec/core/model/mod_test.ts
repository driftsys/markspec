/**
 * @module core/model/mod_test
 *
 * Unit tests for the {@linkcode BodyToken} discriminated union (ADR-016).
 */

import { assertEquals } from "@std/assert";
import type { BodyToken, BodyTokenKind, Entry } from "./mod.ts";
import { makeDisplayId } from "./mod.ts";

Deno.test("BodyToken: discriminated union exhaustiveness", () => {
  const modal: BodyToken = {
    kind: "modal",
    text: "shall",
    case: "lower",
    location: { file: "x.md", line: 1, column: 1 },
  };
  function kindOf(t: BodyToken): BodyTokenKind {
    switch (t.kind) {
      case "modal":
      case "ears-trigger":
      case "gherkin-section":
      case "gherkin-step":
      case "entity-ref":
      case "inline-code":
        return t.kind;
    }
  }
  assertEquals(kindOf(modal), "modal");
});

Deno.test("Entry type accepts optional derivedDiscipline field", () => {
  const entry: Entry = {
    displayId: makeDisplayId("REQ_0001"),
    title: "Test entry",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
    derivedDiscipline: "software",
  };
  if (entry.derivedDiscipline !== "software") throw new Error("unreachable");
});

Deno.test("Entry type allows derivedDiscipline to be omitted (optional field)", () => {
  // Pre-Phase-4 entries (e.g. parser-emitted) don't carry derivedDiscipline.
  // The optional shape matches the existing bodyAst?: precedent.
  const entry: Entry = {
    displayId: makeDisplayId("REQ_0002"),
    title: "Test entry without discipline",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  };
  if (entry.derivedDiscipline !== undefined) throw new Error("unreachable");
});
