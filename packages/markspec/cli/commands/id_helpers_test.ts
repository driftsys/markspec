/**
 * @module cli/commands/id_helpers_test
 */

import { assertEquals } from "@std/assert";
import { namedIdTemplate } from "./id_helpers.ts";

Deno.test("namedIdTemplate: replaces each named placeholder with <name>", () => {
  assertEquals(namedIdTemplate("SWC_{name}"), "SWC_<name>");
  assertEquals(namedIdTemplate("HWC_{name}"), "HWC_<name>");
  assertEquals(namedIdTemplate("XREQ_{scope}"), "XREQ_<scope>");
});

Deno.test("namedIdTemplate: handles multiple placeholders and keeps literals", () => {
  assertEquals(namedIdTemplate("X_{a}_{b}"), "X_<a>_<b>");
  assertEquals(namedIdTemplate("SWC_{name}-draft"), "SWC_<name>-draft");
});
