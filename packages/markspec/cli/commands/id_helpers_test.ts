/**
 * @module cli/commands/id_helpers_test
 */

import { assertEquals } from "@std/assert";
import { namedIdTemplate } from "./id_helpers.ts";

Deno.test("namedIdTemplate: replaces each named placeholder with its upper-cased identifier", () => {
  // Slug-valid (no angle brackets) so the scaffold survives `markspec check`.
  assertEquals(namedIdTemplate("SWC_{name}"), "SWC_NAME");
  assertEquals(namedIdTemplate("HWC_{name}"), "HWC_NAME");
  assertEquals(namedIdTemplate("XREQ_{scope}"), "XREQ_SCOPE");
});

Deno.test("namedIdTemplate: handles multiple placeholders and keeps literals", () => {
  assertEquals(namedIdTemplate("X_{a}_{b}"), "X_A_B");
  assertEquals(namedIdTemplate("SWC_{name}-draft"), "SWC_NAME-draft");
});
