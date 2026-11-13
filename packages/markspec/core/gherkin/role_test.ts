/**
 * @module core/gherkin/role_test
 *
 * Unit tests for `blockRole`: the role of a Gherkin block follows the type of
 * its entry (epic #915).
 */

import { assertEquals } from "@std/assert";
import type { EffectiveProfile, Entry } from "../model/mod.ts";
import { blockRole } from "./role.ts";

const entryOfType = (type: string | undefined): Entry =>
  ({ type, displayId: "REQ_X_0001" }) as unknown as Entry;

Deno.test("blockRole: Requirement → criteria", () => {
  assertEquals(blockRole(entryOfType("Requirement"), null), "criteria");
});

Deno.test("blockRole: Contract descendant → criteria", () => {
  assertEquals(blockRole(entryOfType("SoftwareInterface"), null), "criteria");
});

Deno.test("blockRole: Test → procedure", () => {
  assertEquals(blockRole(entryOfType("Test"), null), "procedure");
});

Deno.test("blockRole: Component → illustration", () => {
  assertEquals(blockRole(entryOfType("Component"), null), "illustration");
});

Deno.test("blockRole: no type → undefined", () => {
  assertEquals(blockRole(entryOfType(undefined), null), undefined);
});

Deno.test("blockRole: profile type extending Requirement → criteria", () => {
  const profile = {
    types: new Map([["Need", {
      value: { name: "Need", extends: "Requirement" },
      origin: "p",
    }]]),
  } as unknown as EffectiveProfile;
  assertEquals(blockRole(entryOfType("Need"), profile), "criteria");
  assertEquals(blockRole(entryOfType("Need"), null), "illustration");
});
