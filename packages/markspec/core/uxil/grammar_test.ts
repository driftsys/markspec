import { assertEquals } from "@std/assert";
import { parseUxRef } from "./grammar.ts";

Deno.test("parseUxRef: full ref with scheme, state, element, key, verb", () => {
  const { ref, diagnostics } = parseUxRef(
    "ux:media.home@ready/play:{id}!activate",
  );
  assertEquals(diagnostics, []);
  assertEquals(ref?.hasScheme, true);
  assertEquals(ref?.surface, ["media", "home"]);
  assertEquals(ref?.state, "ready");
  assertEquals(ref?.element, "play");
  assertEquals(ref?.key, { kind: "template", name: "id" });
  assertEquals(ref?.verb, "activate");
});

Deno.test("parseUxRef: scheme-less wire form parses identically (wire-compat)", () => {
  const withScheme = parseUxRef("ux:media.home/play");
  const wire = parseUxRef("media.home/play");
  assertEquals(wire.diagnostics, []);
  assertEquals(withScheme.diagnostics, []);
  // Identical modulo hasScheme.
  assertEquals(wire.ref?.surface, withScheme.ref?.surface);
  assertEquals(wire.ref?.element, withScheme.ref?.element);
  assertEquals(withScheme.ref?.hasScheme, true);
  assertEquals(wire.ref?.hasScheme, false);
});

Deno.test("parseUxRef: reserved authority is UXIL-003", () => {
  const { diagnostics } = parseUxRef("ux://app/media.home");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-003"]);
});

Deno.test("parseUxRef: reserved query char is UXIL-002", () => {
  const { diagnostics } = parseUxRef("media.home?x");
  assertEquals(diagnostics.some((d) => d.code === "UXIL-002"), true);
});
