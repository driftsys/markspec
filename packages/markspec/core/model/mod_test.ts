/**
 * @module core/model/mod_test
 *
 * Unit tests for the {@linkcode BodyToken} discriminated union (ADR-016).
 */

import { assertEquals } from "@std/assert";
import type { BodyToken, BodyTokenKind } from "./mod.ts";

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
