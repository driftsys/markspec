import { assertEquals } from "@std/assert";
import { resolveRef } from "../decl/mod.ts";
import {
  isPublishedTyplName,
  isRelativeTyplName,
  TYPL_REF_OPS,
  typlPathOf,
} from "./resolve.ts";

Deno.test("resolve: name predicates", () => {
  assertEquals(isRelativeTyplName("$.pedal_position"), true);
  assertEquals(isRelativeTyplName("$pedal"), false);
  assertEquals(isPublishedTyplName("$powertrain.brake"), true);
  assertEquals(isPublishedTyplName("$pedal"), false);
  assertEquals(isPublishedTyplName("$.x"), false);
  assertEquals(typlPathOf("$powertrain.brake"), "powertrain.brake");
});

Deno.test("resolve: relative joins innermost base", () => {
  const scope = { base: "powertrain.brake", parent: { base: "powertrain" } };
  const r = resolveRef("$.pedal_position", scope, TYPL_REF_OPS);
  assertEquals(r, { ok: true, ref: "$powertrain.brake.pedal_position" });
});

Deno.test("resolve: absolute passes through; no base fails", () => {
  const abs = resolveRef("$a.b", undefined, TYPL_REF_OPS);
  assertEquals(abs, { ok: true, ref: "$a.b" });
  const rel = resolveRef("$.x", undefined, TYPL_REF_OPS);
  assertEquals(rel, { ok: false, reason: "no-base-in-scope" });
});
